export type Handoff = 'concierge' | 'reception';
export type ConciergeStatus = 'present' | 'absent' | 'unknown';
export type StayStatus = 'draft' | 'invited' | 'in_progress' | 'completed' | 'stopped';
export type BriefStatus = 'none' | 'generating' | 'ready' | 'failed';
export interface Source {
  title: string;
  url: string;
  checkedAt: string;
  status: 'public' | 'historical' | 'reported' | 'operator';
}
export interface Hotel {
  id: string;
  name: string;
  city: string;
  country: string;
  dna: string;
  version: number;
  conciergeStatus: ConciergeStatus;
  reviewed: boolean;
  sources: Source[];
  operationallyConfirmed: boolean;
  documents: HotelDocument[];
}
export interface HotelDocument {
  id: string;
  name: string;
  text: string;
}
export interface Fact {
  label: string;
  value: string;
  sourceMessageId: string;
  sourceQuote: string;
}
export interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: string;
}
export const discoveryDomains = [
  'people_and_purpose',
  'plans_and_pace',
  'food_and_drink',
  'snacks',
  'dietary_requirements',
  'sleep_and_comfort',
  'routines',
  'interests',
  'scents_and_flowers',
  'interaction',
  'personal_touches',
] as const;
export type DiscoveryDomain = (typeof discoveryDomains)[number];
export interface DiscoveryCoverage {
  status: 'unexplored' | 'open' | 'understood' | 'unknown' | 'indifferent' | 'declined' | 'not_relevant';
  detail: string;
  sourceMessageIds: string[];
}
// Internal interpretation, not guest-verified facts. Optional additions preserve old stays.
export interface DiscoveryState {
  coverage?: Record<DiscoveryDomain, DiscoveryCoverage>;
  closing?: {
    basis: 'continue' | 'sufficient' | 'guest_finished' | 'guest_short_on_time' | 'guest_disengaging';
    reason: string;
    sourceMessageIds: string[];
  };
  threads: {
    person: string;
    topic: string;
    status: 'open' | 'understood' | 'unknown' | 'indifferent' | 'declined';
    detail: string;
    sourceMessageIds: string[];
  }[];
  nextMove:
    'answer' | 'clarify' | 'deepen' | 'include' | 'bridge' | 'closing_invitation' | 'close' | 'withdraw';
  focus: string;
}
export interface Stay {
  id: string;
  hotelId: string;
  hotelName: string;
  guestName: string;
  email: string;
  arrival: string;
  departure: string;
  partySize: number;
  reservationNotes: string;
  handoff: Handoff;
  demo: boolean;
  status: StayStatus;
  briefStatus: BriefStatus;
  dnaVersion: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revoked: boolean;
  facts: Fact[];
  discovery?: DiscoveryState;
  chatError: string | null;
  briefError: string | null;
  readyToFinish: boolean;
  selectedBriefId: string | null;
  revision: number;
}
export interface Brief {
  id: string;
  stayId: string;
  version: number;
  text: string;
  generatedText: string;
  kind: 'normal' | 'minimal';
  source: 'openai' | 'simulation' | 'minimal-record' | 'historical' | 'recorded-example' | 'research-preview';
  research?: { baselineId: string; baselineRevision: number; runIds: string[]; simulated: boolean };
  provenance?: { exampleId: string; recordedOn: string; originalBriefId: string };
  dnaVersion: number;
  promptVersion: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface Invitation {
  id: string;
  stayId: string;
  status: 'preview' | 'sending' | 'sent' | 'failed' | 'unknown';
  subject: string;
  body: string;
  recipient: string;
  createdAt: string;
  error: string | null;
}
export interface StayDetail {
  stay: Stay;
  messages: Message[];
  briefs: Brief[];
  invitations: Invitation[];
}
export interface GuestView {
  hotelName: string;
  guestName: string;
  arrival: string;
  departure: string;
  partySize: number;
  status: StayStatus;
  messages: Message[];
  readyToFinish: boolean;
  chatError: string | null;
  demo: boolean;
  aiMode: string;
  busy: boolean;
}
export interface RuntimeInfo {
  aiMode: 'disabled' | 'simulation' | 'openai';
  aiConfigured: boolean;
  emailMode: 'preview' | 'smtp';
  emailEnabled: boolean;
  realStaysEnabled: boolean;
  database: 'local-postgres' | 'postgres';
  model: string | null;
  aiBudget?: AiBudgetStatus | null;
}
export interface AiBudgetStatus {
  limitUsd: number;
  accountedUsd: number;
  remainingUsd: number;
  uncertainCalls: number;
  blocked: boolean;
}
export interface ChatResult {
  reply: string;
  readyToFinish: boolean;
  stopRequested: boolean;
  facts: Fact[];
  discovery?: DiscoveryState;
}
export interface GenerationInput {
  stay: Stay;
  hotel: Hotel;
  messages: Message[];
}
export interface AiProvider {
  name: 'simulation' | 'openai' | 'disabled';
  model: string;
  budget?: () => Promise<AiBudgetStatus>;
  chat(input: GenerationInput, signal?: AbortSignal): Promise<ChatResult>;
  brief(input: GenerationInput, signal?: AbortSignal): Promise<string>;
}
// Legacy Canopia contract. The hackathon implementation uses shared/research.ts.
// No live research agent is implemented.
export interface ResearchExtensionProposal {
  stayId: string;
  dnaVersion: number;
  declaredInterests: { text: string; sourceMessageId: string }[];
  findings: { text: string; sourceUrl: string; observedAt: string; uncertainty: string }[];
  proposedExperiences: { description: string; requiredCapabilities: string[]; confirmations: string[] }[];
  humanSelection: 'pending' | 'retained' | 'rejected';
}
