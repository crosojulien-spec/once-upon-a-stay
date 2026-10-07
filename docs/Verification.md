# Verification of the prepared repository

Checked on 7 October 2026 on Windows with Node.js 24.18.0. The original Canopia repository remained clean at `4b843bb`; its database, configuration and allowance were not used.

| Check | Observed result |
|---|---|
| Fresh dependency installation | `npm ci --ignore-scripts --no-audit --no-fund` installed 196 packages from the lockfile in the new directory |
| TypeScript | Passed |
| Server and data tests | 25 passed, including inherited core checks and seven research/example tests |
| Production frontend build | Passed; Vite compiled 1,914 modules |
| Source formatting | Passed |
| Repository consistency | 88 files, 10 JSON files, 34 relative links and three coherent examples checked |
| README startup command | npm run demo served the app on port 4320 with scripted AI and email disabled |
| Browser journeys | Two passed using an isolated Edge context and fresh database |
| Visual inspection | Research workspace inspected on desktop and 390px mobile screenshots; no horizontal overflow in the browser checks |

The browser tests cover the existing operator/guest workflow, editing, version preservation, export response, withdrawal, DNA editing and mobile layout. The new research journey loads a recorded case, runs both simulated tracks, retains one proposal, rejects the other, creates a new brief, restores the original baseline and checks the unverified-identity abstention. A targeted rerun passed after adding protection against composing with unsaved proposal edits.

Research/data checks include fresh import IDs and message references, frozen DNA, authentication/origin protection, foreign-stay IDs, missing evidence references, simulated/live separation, pending/rejected decisions, concurrent edit conflicts, baseline edits, combined composition, repeated composition, withdrawal, revocation and deletion cleanup.

The initial sandboxed build was blocked by Windows access to parent directories; the same build succeeded under the approved local execution context. This was an execution-environment restriction, not a source-code fix.

Repository checks validate JSON, relative Markdown links, example-to-transcript consistency, DNA IDs/versions and likely credential patterns. Public hotel contacts are part of dated source profiles; no private guest database or credential was imported. One French card-message quotation in the family example has an explicitly documented English reading translation.

## Limits

No live AI or web research was performed from this repository. No emails, bookings, payments, hotel approvals or deployment were exercised. Live research adapters remain unimplemented. Recorded AI outputs retain known weaknesses; simulation cannot validate relevance or factual accuracy. Remote PostgreSQL/SMTP and production hosting remain untested.

The included GitHub Actions workflow repeats the repository and browser checks on Linux. Local Windows results do not by themselves prove its remote result. Review the Actions run attached to the pushed commit. This is a development handoff, not a production or security certification.
