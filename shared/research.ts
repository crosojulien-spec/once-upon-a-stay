import { z } from 'zod';
import type { Brief, Hotel, Message, Stay, Fact } from './types.ts';

export const moduleSchema = z.enum(['context-enrichment', 'local-discovery']);
export type ResearchModule = z.infer<typeof moduleSchema>;
export interface ResearchInput {
  stay: Pick<
    Stay,
    | 'id'
    | 'hotelId'
    | 'guestName'
    | 'arrival'
    | 'departure'
    | 'partySize'
    | 'reservationNotes'
    | 'handoff'
    | 'demo'
  >;
  hotel: Hotel;
  messages: Message[];
  declaredInterests: Fact[];
  baseline: Pick<Brief, 'id' | 'revision' | 'text' | 'promptVersion' | 'model'>;
  identity: { status: 'unverified' | 'verified'; publicUrls: string[] };
}
const httpsUrl = z
  .string()
  .url()
  .refine((s) => s.startsWith('https://'), 'Use an HTTPS source URL.');
export const outputSchema = z
  .object({
    status: z.enum(['completed', 'no-results', 'abstained', 'not-implemented', 'failed']),
    explanation: z.string().min(1).max(2000),
    sources: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          url: httpsUrl,
          checkedAt: z.iso.datetime(),
          publishedAt: z.string().nullable(),
          kind: z.enum(['public', 'simulated']),
        }),
      )
      .max(20),
    findings: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().min(1).max(2000),
          sourceIds: z.array(z.string()).min(1),
          messageIds: z.array(z.string()).min(1),
          uncertainty: z.string().min(1),
        }),
      )
      .max(20),
    proposals: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1).max(200),
          description: z.string().min(1).max(3000),
          findingIds: z.array(z.string()).min(1),
          requiredCapabilities: z.array(z.string()).min(1),
          confirmations: z.array(z.string()).min(1),
          localDetails: z
            .object({
              location: z.string(),
              startAt: z.string().nullable(),
              endAt: z.string().nullable(),
              timezone: z.string(),
              durationMinutes: z.number().positive().nullable(),
              travelMinutes: z.number().nonnegative().nullable(),
              bookingUrl: httpsUrl.nullable(),
              availability: z.enum(['unknown', 'advertised', 'confirmed']),
              externalPrice: z
                .object({
                  amount: z.number().nonnegative(),
                  currency: z.string().length(3),
                  basis: z.enum(['person', 'group']),
                })
                .nullable(),
              inclusions: z.string(),
              cancellation: z.string(),
              hotelAdditions: z.array(z.string()),
              hotelCosts: z.number().nonnegative().nullable(),
              hotelMarkup: z.number().nonnegative().nullable(),
              finalGuestPrice: z.number().nonnegative().nullable(),
            })
            .optional(),
        }),
      )
      .max(10),
  })
  .strict();
export type ResearchOutput = z.infer<typeof outputSchema>;
export interface ResearchAdapter {
  run(input: ResearchInput, signal?: AbortSignal): Promise<ResearchOutput>;
}
export interface ResearchDecision {
  proposalId: string;
  choice: 'pending' | 'retained' | 'rejected';
  editedDescription: string;
  reason: string;
}
export interface ResearchRun {
  id: string;
  stayId: string;
  module: ResearchModule;
  mode: 'simulation' | 'live';
  createdAt: string;
  revision: number;
  input: ResearchInput;
  output: ResearchOutput;
  decisions: ResearchDecision[];
  composedBriefId?: string;
}

export function validateResearchOutput(value: unknown, input: ResearchInput, mode: ResearchRun['mode']) {
  const out = outputSchema.parse(value);
  const unique = (items: { id: string }[]) => {
    if (new Set(items.map((x) => x.id)).size !== items.length) throw new Error('Duplicate research IDs.');
  };
  unique(out.sources);
  unique(out.findings);
  unique(out.proposals);
  const sources = new Set(out.sources.map((x) => x.id));
  const findings = new Set(out.findings.map((x) => x.id));
  const messages = new Set(input.messages.filter((x) => x.role === 'user').map((x) => x.id));
  if (
    out.findings.some(
      (x) => x.sourceIds.some((s) => !sources.has(s)) || x.messageIds.some((m) => !messages.has(m)),
    )
  )
    throw new Error('Research evidence refers to a missing source or guest message.');
  if (out.proposals.some((x) => x.findingIds.some((f) => !findings.has(f))))
    throw new Error('Proposal evidence is missing.');
  if (
    mode === 'live' &&
    out.sources.some((x) => x.kind !== 'public' || new URL(x.url).hostname.endsWith('.invalid'))
  )
    throw new Error('Simulated evidence cannot be used as live research.');
  if (out.status !== 'completed' && (out.findings.length || out.proposals.length))
    throw new Error('An empty outcome cannot contain proposals.');
  return out;
}
