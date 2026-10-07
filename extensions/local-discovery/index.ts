import type { ResearchAdapter } from '../../shared/research.ts';

// Hackathon implementation point. Add a source adapter and pass results through output validation.
export const localDiscovery: ResearchAdapter = {
  async run() {
    return {
      status: 'not-implemented',
      explanation:
        'Local discovery is not connected to live sources yet. Select a city, dates and source provider at the hackathon.',
      sources: [],
      findings: [],
      proposals: [],
    };
  },
};
