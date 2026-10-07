import type { ResearchInput, ResearchModule, ResearchOutput } from '../shared/research.ts';

// Plumbing fixture only: not an AI result, recommendation or factual listing.
export function simulateResearch(module: ResearchModule, input: ResearchInput): ResearchOutput {
  const message = input.messages.find((m) => m.role === 'user');
  if (!message)
    return {
      status: 'no-results',
      explanation: 'No guest message to anchor a simulation.',
      sources: [],
      findings: [],
      proposals: [],
    };
  const local = module === 'local-discovery';
  return {
    status: 'completed',
    explanation:
      'SIMULATED wiring example. No web search, identity verification, AI call, booking or hotel approval took place. This fixture demonstrates review controls only.',
    sources: [
      {
        id: 'fixture-source',
        title: 'SIMULATED source; no real page',
        url: 'https://example.invalid/hackathon-fixture',
        checkedAt: new Date().toISOString(),
        publishedAt: null,
        kind: 'simulated',
      },
    ],
    findings: [
      {
        id: 'fixture-finding',
        text: local
          ? `SIMULATED local option in ${input.hotel.city}. Replace this with sourced results matching the guest's actual interests and stay dates.`
          : 'SIMULATED additional detail related to a declared interest. This is not a fact about the fictional guest.',
        sourceIds: ['fixture-source'],
        messageIds: [message.id],
        uncertainty: 'Entirely synthetic. The source and finding do not exist outside this fixture.',
      },
    ],
    proposals: [
      {
        id: 'fixture-proposal',
        title: local ? 'SIMULATED local experience' : 'SIMULATED personal touch',
        description: local
          ? 'A placeholder visit for staff to assess, with optional hotel transport or dining. Replace it with a relevant, dated activity.'
          : 'A placeholder personal touch for staff review. Replace it with an idea grounded in a verified public finding and hotel capabilities.',
        findingIds: ['fixture-finding'],
        requiredCapabilities: ['Staff review and an appropriate documented hotel capability'],
        confirmations: [
          'Replace all fixture evidence before any real use',
          'Confirm suitability, feasibility and price with the hotel',
        ],
        ...(local
          ? {
              localDetails: {
                location: input.hotel.city,
                startAt: null,
                endAt: null,
                timezone: 'Unknown — confirm for the selected location',
                durationMinutes: null,
                travelMinutes: null,
                bookingUrl: null,
                availability: 'unknown' as const,
                externalPrice: null,
                inclusions: 'Unknown',
                cancellation: 'Unknown',
                hotelAdditions: ['Optional transport or dining, subject to hotel review'],
                hotelCosts: null,
                hotelMarkup: null,
                finalGuestPrice: null,
              },
            }
          : {}),
      },
    ],
  };
}
