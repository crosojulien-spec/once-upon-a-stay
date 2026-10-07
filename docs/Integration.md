# Research integration

## Intended product flow

The approved [process guide](Canopia%20process%20and%20research%20agents.docx) places both optional agents after discovery has been matched with Hotel DNA and before briefs are generated. Context enrichment refines an existing idea; local discovery builds practical local options and combines them with hotel services. Contributions are brought together for brief generation, human review and delivery to the hotel. Hotel teams then choose what they can carry out, without a required hotel approval or guest preselection step.

## Current experiment

The workflow currently implemented in Research lab operates around a saved brief. It preserves a useful baseline and allows either extension to fail or abstain without losing the brief. Moving research before brief generation and adapting inputs and composition to that flow remain implementation work. The following steps describe the existing experiment.

1. Complete a fictional conversation, or load a recorded example.
2. Select and save the baseline brief.
3. Run one or both extension previews against that baseline.
4. Inspect findings and sources, edit proposals and record a retain/reject decision with a reason.
5. Select the runs to combine and create a new brief version.

The current composer appends accepted proposals and evidence to the baseline text deterministically. It does not call an LLM or rewrite the original. The new version is labelled as a research preview and keeps baseline/run lineage. Building and evaluating a richer brief-composition prompt is a possible hackathon task.

## Files and boundaries

| File | Responsibility |
|---|---|
| `shared/research.ts` | Input/output types, runtime output validation and evidence relationships |
| `extensions/context-enrichment/index.ts` | Person-context adapter; currently abstains without verified identity, otherwise returns not-implemented |
| `extensions/local-discovery/index.ts` | Local discovery adapter; currently returns not-implemented |
| `extensions/simulation.ts` | Explicit invented fixtures, no search or model call |
| `server/research.ts` | Authenticated workflow, persistence, decisions and composition |
| `client/ResearchWorkspace.tsx` | Baseline, evidence, proposal editing and selection |

Implement `ResearchAdapter.run(input, signal)` and return a `ResearchOutput`. The server validates results before storage. No agent framework is required by this interface. Adding one is an implementation choice for the team.

Inputs include stay dates and party context, frozen hotel DNA, messages, source-linked facts and the selected brief's text/revision. Email, authentication tokens and credentials are excluded. `declaredInterests` currently carries Canopia's retained facts: the adapter must select relevant declared interests, not assume every fact is an interest or every generated interpretation is verified.

Every finding links to a source and an actual guest message. Every proposal links to findings, required capabilities and checks still needed. Human decisions belong to individual proposals. Local details distinguish external price/basis, timing, travel, booking, inclusions, cancellation, availability, hotel additions/costs/markup and final guest price. Unknown values stay null or explicit; do not invent them.

The `identity` input currently starts unverified. There is no public-identity verification UI. Before enabling real context enrichment, define a reviewable verified-subject input with the team and keep it distinct from the fictional example identity. Do not bypass this by searching the example names.

## HTTP entry points

All endpoints below require the operator session; mutating calls also require the configured application Origin. IDs are scoped to a stay.

| Method and path | Body or result |
|---|---|
| `POST /api/examples/:exampleId` | Import one of the three allowlisted recorded cases with fresh local IDs |
| `GET /api/stays/:id/research` | Saved runs, frozen inputs, evidence and decisions |
| `POST /api/stays/:id/research` | `{ "module": "local-discovery", "mode": "simulation" }`; the other module is `context-enrichment` |
| `PUT /api/stays/:id/research/:runId/decision` | `revision`, `proposalId`, `choice` (`retained` or `rejected`), `editedDescription`, `reason` |
| `POST /api/stays/:id/research/compose` | `{ "runIds": ["..."] }`; returns the new brief |

`mode=live` currently calls only the unimplemented adapters; it makes no external request. The context identity gate therefore returns an abstention. Errors remain visible; an unavailable provider must not silently become a fabricated success.

Runs combined in one brief must use the same baseline ID and revision. A baseline edit requires new runs. Pending decisions, all-rejected results, repeated composition, foreign-stay run IDs, refusal and revocation block composition. Existing source briefs remain untouched. Runs are deleted with their stay. These constraints apply on the server as well as in the UI.

Future fetchers must enforce allowed network destinations, avoid private/local addresses and unsafe redirects, bound time and cost, handle inaccessible/stale pages, and treat source content as evidence rather than instructions. Schema validation alone does not establish factual truth, identity or current availability.
