import type { ResearchAdapter } from '../../shared/research.ts';

// Hackathon implementation point. No person lookup or network request runs here.
export const contextEnrichment: ResearchAdapter = {
  async run(input) {
    return {
      status: input.identity.status === 'verified' ? 'not-implemented' : 'abstained',
      explanation:
        input.identity.status === 'verified'
          ? 'The context-enrichment adapter is ready for implementation at the hackathon.'
          : 'No verified test identity. Keep the conversation-based brief; do not search fictional names.',
      sources: [],
      findings: [],
      proposals: [],
    };
  },
};
