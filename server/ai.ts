import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import type { AiProvider, ChatResult, GenerationInput } from '../shared/types.ts';
import type { Config } from './config.ts';
import { AppError, assert } from './security.ts';
import { AiBudget, approvedModel } from './ai-budget.ts';
import { discoverySchema, discoveryReady, groundedDiscovery, closureIssues } from './discovery.ts';

export const conversationPromptVersion = 'conversation-v5.1';
export const briefPromptVersion = 'brief-v4.2';
export const conversationSupportFiles = [
  'prompts/discovery-output-v1.1.txt',
  'prompts/discovery-examples-v1.1.txt',
];

const resultSchema = z.object({
  reply: z.string().min(1).max(3000),
  stopRequested: z.boolean(),
  discovery: discoverySchema,
  facts: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        sourceMessageId: z.string(),
        sourceQuote: z.string(),
      }),
    )
    .max(60),
});

function turnFormat(input: GenerationInput) {
  const format = zodTextFormat(resultSchema, 'canopia_turn');
  const schema = format.schema as Record<string, unknown>;
  const ids = input.messages.filter((message) => message.role === 'user').map((message) => message.id);
  // Constrain copying at generation time; grounding below remains a second check.
  // One shared enum avoids repeating long IDs for every coverage domain.
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    if (object.properties && typeof object.properties === 'object') {
      const properties = object.properties as Record<string, unknown>;
      if ('sourceMessageId' in properties) properties.sourceMessageId = { $ref: '#/$defs/guest_source_id' };
      if ('sourceMessageIds' in properties)
        properties.sourceMessageIds = {
          type: 'array',
          items: { $ref: '#/$defs/guest_source_id' },
          maxItems: 4,
        };
    }
    Object.values(object).forEach(visit);
  };
  visit(schema);
  schema.$defs = {
    ...((schema.$defs ?? {}) as Record<string, unknown>),
    guest_source_id: { type: 'string', enum: ids.length ? ids : ['__no_guest_message__'] },
  };
  return format;
}
export function makeProvider(config: Config, budget?: AiBudget, suppliedClient?: OpenAI): AiProvider {
  if (config.aiMode === 'simulation') return new SimulationProvider();
  if (config.aiMode !== 'openai' || !config.apiKey || !config.model || !config.allowAiCalls)
    return {
      name: 'disabled',
      model: 'unconfigured',
      async chat() {
        throw new AppError(
          503,
          'The AI connection is not enabled. Your message is saved. Please try again when the operator has connected it.',
        );
      },
      async brief() {
        throw new AppError(503, 'Connect and enable the AI provider to generate a brief.');
      },
    };
  assert(
    budget && config.model === approvedModel,
    503,
    'The approved model and persistent trial budget must be configured before AI calls.',
  );
  const limiter = budget!;
  const client = suppliedClient || new OpenAI({ apiKey: config.apiKey, maxRetries: 0, timeout: 60_000 });
  async function response(
    params: ResponseCreateParamsNonStreaming,
    purpose: 'chat' | 'brief',
    signal?: AbortSignal,
  ) {
    try {
      if (signal?.aborted) throw new AppError(503, 'The request was cancelled before generation.');
      const count = await client.responses.inputTokens.count(
        {
          model: params.model,
          input: params.input,
          instructions: params.instructions,
          text: params.text,
          reasoning: params.reasoning,
        },
        { signal },
      );
      if (signal?.aborted) throw new AppError(503, 'The request was cancelled before generation.');
      const id = await limiter.reserve(config.model!, count.input_tokens, params.max_output_tokens!, purpose);
      // Reserve before dispatch. Any unknown outcome deliberately keeps that
      // reservation; automatic retries are disabled on the SDK client.
      const result = await client.responses.create(
        { ...params, service_tier: 'default', store: false },
        { signal },
      );
      await limiter.settle(id, result.usage, result._request_id, result.service_tier);
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof OpenAI.APIError) {
        const code =
          typeof error.code === 'string' && /^[a-z_]{1,80}$/.test(error.code) ? error.code : 'unknown';
        console.warn(`OpenAI ${purpose} request failed: HTTP ${error.status || 'unknown'}, code ${code}`);
        if (error.status === 429)
          throw new AppError(
            503,
            'The API account has reached a credit, budget or rate limit. Your message is saved; ask the operator to check the connection.',
          );
        if (error.status === 401 || error.status === 403)
          throw new AppError(
            503,
            'The API account could not authorise this model. Your message is saved; ask the operator to check the connection.',
          );
      }
      throw new AppError(
        502,
        'The AI response could not be completed. Your message is saved. Please retry or ask the operator.',
      );
    }
  }
  const inputData = (input: GenerationInput) =>
    JSON.stringify({
      reservation: {
        guestName: input.stay.guestName,
        arrival: input.stay.arrival,
        departure: input.stay.departure,
        partySize: input.stay.partySize,
        notes: input.stay.reservationNotes,
        handoff: input.stay.handoff,
      },
      hotelDNA: input.hotel,
      transcript: input.messages,
      retainedFacts: input.stay.facts,
      previousDiscovery: input.stay.discovery ?? null,
    });
  return {
    name: 'openai',
    model: config.model,
    budget: () => limiter.status(),
    async chat(input, signal) {
      const instructions = (
        await Promise.all(
          [`prompts/${conversationPromptVersion}.txt`, ...conversationSupportFiles].map((path) =>
            readFile(path, 'utf8'),
          ),
        )
      ).join('\n\n');
      let correction = '';
      // One bounded repair of premature host-led closure. Both generations use
      // the same ledger; no SDK retry, silent fallback or fabricated guest reply.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await response(
          {
            model: config.model!,
            store: false,
            max_output_tokens: 7000,
            reasoning: { effort: 'medium' },
            instructions: instructions + correction,
            input: inputData(input),
            text: { format: turnFormat(input) },
          },
          'chat',
          signal,
        );
        if (result.status !== 'completed' || !result.output_text)
          throw new AppError(
            502,
            'The AI response could not be read. Your message is saved; retry when ready.',
          );
        let output: ChatResult;
        try {
          const parsed = resultSchema.parse(JSON.parse(result.output_text));
          const discovery = groundedDiscovery(parsed.discovery, input.messages);
          const stopRequested = parsed.stopRequested || discovery.nextMove === 'withdraw';
          output = {
            ...parsed,
            discovery: stopRequested ? { ...discovery, nextMove: 'withdraw', focus: '' } : discovery,
            stopRequested,
            readyToFinish: !stopRequested && discoveryReady(discovery),
          };
        } catch {
          throw new AppError(
            502,
            'The AI reply format was incomplete. Your message is saved; retry when ready.',
          );
        }
        const issues = output.discovery && !output.stopRequested ? closureIssues(output.discovery) : [];
        if (issues.length) {
          if (attempt === 1)
            throw new AppError(
              502,
              'The host could not resolve incomplete discovery. Your message is saved; please retry.',
            );
          correction =
            '\n\nAPPLICATION CHECK: Your previous draft proposed ending with unresolved discovery: ' +
            issues.join(' ') +
            '\nReturn a replacement for this same turn. Continue with one useful natural question unless the guest has actually asked to finish. Do not fabricate coverage or guest impatience. The rejected draft was not shown to the guest.';
          continue;
        }
        output.facts = output.facts.filter(
          (f) =>
            f.sourceQuote.length > 0 &&
            input.messages.some(
              (m) => m.role === 'user' && m.id === f.sourceMessageId && m.content.includes(f.sourceQuote),
            ),
        );
        return output;
      }
      throw new AppError(502, 'Discovery could not be completed.');
    },
    async brief(input, signal) {
      const result = await response(
        {
          model: config.model!,
          store: false,
          max_output_tokens: 7000,
          reasoning: { effort: 'medium' },
          instructions: await readFile(`prompts/${briefPromptVersion}.txt`, 'utf8'),
          input: inputData(input),
        },
        'brief',
        signal,
      );
      const text = result.output_text?.trim();
      if (
        result.status !== 'completed' ||
        !text ||
        !['A)', 'B)', 'C)', 'D)', 'E)', 'F)'].every((h) => text.includes(h))
      )
        throw new AppError(502, 'The brief was incomplete. No existing version has been replaced.');
      return text;
    },
  };
}

// Explicitly labelled rehearsal. No model, no external call, no field-quality claim.
export class SimulationProvider implements AiProvider {
  name = 'simulation' as const;
  model = 'scripted-local-rehearsal';
  async chat(input: GenerationInput): Promise<ChatResult> {
    const users = input.messages.filter((m) => m.role === 'user');
    const latest = users.at(-1);
    const stop = Boolean(
      latest &&
      /(?:stop (?:here|this|asking)|do not (?:use|personalize)|don.t (?:use|trust)|human instead|no personali[sz]ation)/i.test(
        latest.content,
      ),
    );
    const replies = [
      `Hello ${input.stay.guestName.split(' ')[0]}. This optional conversation helps the team at ${input.hotel.name} prepare your stay. What brings you here, and what would make this time feel worthwhile?`,
      'Thank you. Is there one part of that you would especially like the hotel team to understand?',
      'Is there anything practical about your comfort, food or the way you like to interact with the team that would help us prepare?',
      'Before we finish, is there anything you would like to add or correct? You can also finish with what you have shared.',
    ];
    return {
      reply: stop
        ? 'Understood. We will stop here. The team will receive a minimal record clearly stating that you do not want personalization.'
        : replies[Math.min(users.length, 3)],
      readyToFinish: users.length >= 3,
      stopRequested: stop,
      facts: users
        .filter((m) => m !== latest || !stop)
        .map((m, i) => ({
          label: `Shared preference ${i + 1}`,
          value: m.content,
          sourceMessageId: m.id,
          sourceQuote: m.content,
        })),
    };
  }
  async brief(input: GenerationInput) {
    const facts =
      input.stay.facts.map((f) => `- ${f.value}`).join('\n') || 'No explicit preferences recorded.';
    return `SIMULATED REHEARSAL — not an AI-generated or hotel-validated brief\n\nA) BASIC INFO\nGuest: ${input.stay.guestName}\nHotel: ${input.hotel.name}\nDates: ${input.stay.arrival} to ${input.stay.departure}\nParty: ${input.stay.partySize}\n\nB) COORDINATION\nHandoff: ${input.stay.handoff}. Hotel team to confirm feasibility.\n\nC) GUEST PROFILE\nCollected statements, for operator review:\n${facts}\n\nExperience suggestions\nNot generated in this scripted rehearsal. Connect the AI provider to evaluate composition against the hotel DNA.\n\nD) RECEPTION\nReview the collected preferences and confirm relevant preparation with the appropriate teams.\n\nE) ROOM PREPARATION\nNo unconfirmed setup instructions. Review explicitly shared comfort preferences.\n\nF) ${input.stay.handoff === 'concierge' ? 'CONCIERGE' : 'RECEPTION — EXPERIENCE SUPPORT'}\nNo activities, partners or reservations selected. Any future proposal needs hotel confirmation.`;
  }
}

export const withdrawalNotice =
  'PERSONALIZATION DECLINED — THE GUEST HAS ASKED NOT TO HAVE THEIR INFORMATION USED FOR PERSONALIZATION.\nCollected information below is a minimal record only. Do not use it to prepare personalized attentions, experiences or outreach. Any change requires a new explicit instruction from the guest through a human contact.';
export function minimalBrief(input: GenerationInput) {
  const facts =
    input.messages
      .filter((m) => m.role === 'user')
      .map((m) => `- Guest statement (verbatim): ${m.content}`)
      .join('\n') || 'No guest statements collected.';
  return `${withdrawalNotice}\n\nA) BASIC INFO\nGuest: ${input.stay.guestName}\nHotel: ${input.hotel.name}\nDates: ${input.stay.arrival} to ${input.stay.departure}\nParty: ${input.stay.partySize}\n\nB) COORDINATION\n${input.stay.handoff === 'concierge' ? 'Concierge' : 'Reception'}: respect the guest\u2019s request. No personalization.\n\nC) COLLECTED INFORMATION — DO NOT ACT ON IT\n${facts}\n\nD) RECEPTION\nThe guest stopped the conversation and does not want the information used for personalization. Offer a human channel if requested.\n\nE) ROOM PREPARATION\nNo personalized preparation instructions.\n\nF) ${input.stay.handoff === 'concierge' ? 'CONCIERGE' : 'RECEPTION — EXPERIENCE SUPPORT'}\nNo experience suggestions or research requests. Respect the guest\u2019s expressed wish.`;
}
