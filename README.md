# Once Upon a Stay

**A Canopia workbench for testing what research adds to a hotel stay.**

Canopia turns a guest's pre-arrival conversation into a practical hotel brief, guided by the hotel's identity, capabilities and limits. This private hackathon repository provides the working application, six hotel DNA profiles and three recorded fictional cases. The team can build either of two research extensions, or both, and compare the result with the original brief.

The hotel keeps the final decision. No booking, purchase or guest offer is automated.

Start with the [two-page process guide](docs/Canopia%20process%20and%20research%20agents.docx): before/after flows for both agents and five illustrative examples. The intended flow is guest discovery, Hotel DNA matching, optional enrichment, brief generation, human review and delivery to the hotel. Hotel teams then choose what they can carry out.

The current Research lab is an experiment built around a saved brief. Moving the agents before brief generation, as shown in the process guide, remains implementation work. See [Integration](docs/Integration.md) for this distinction.

## Start in ten minutes

Use Node.js **24.18+** and npm. From the repository root:

```sh
npm ci
npm run demo
```

Open **http://127.0.0.1:4320**, create your own local operator account, and choose **Load Prague example**. The recorded conversation, frozen hotel DNA and baseline brief load without an AI call. The family and running examples are available beside it.

Open **Research lab**, preview either extension, inspect its evidence, enter a reason and retain or reject each proposal. **Create brief with selected research** adds retained proposals to a new version. The original remains available under **Brief & review**. You can also create a fictional stay and try the scripted conversation.

`npm run demo` forces simulation, disables external AI/email/database connections and uses its own `.local/demo` folder. It does not need an `.env` file. Never run two servers against the same data folder. Stop with Ctrl+C. See [setup](docs/Setup.md) for development, tests and optional connections.

## What is ready and what is still to build

| Area | Current state |
|---|---|
| Canopia application | Local operator account, six hotel profiles, fictional stays, conversations, editable/versioned briefs and text export |
| Recorded examples | Three real AI outputs from fictional Canopia tests on 6 October; loaded without new generation; known weaknesses documented |
| Research workflow | Saved baseline, evidence contract, simulated previews, per-proposal review, multiple-extension composition and version preservation |
| Context enrichment | Adapter interface and identity gate; **no live person research** |
| Local discovery | Adapter interface and booking/cost fields; **no live local search** |
| Connections | No API key, spending, real email, hosting or live guest data configured |

Simulated research is deliberately labelled and uses `example.invalid` sources. It proves the wiring only. Recorded AI examples are different: they preserve prior outputs, not successful hotel delivery. The new brief currently appends reviewed proposals deterministically; an AI rewrite/composition strategy is work for the team to evaluate.

## Choose your work

| Track | Read | Implement |
|---|---|---|
| Understand Canopia | [Product](docs/Product.md) and [the three cases](examples/README.md) | Existing core in `client/`, `server/`, `shared/` |
| Context enrichment | [Track brief](docs/briefs/Context%20enrichment.md) | `extensions/context-enrichment/index.ts` |
| Local discovery | [Track brief](docs/briefs/Local%20discovery.md) | `extensions/local-discovery/index.ts` |
| Connect either track | [Integration contract](docs/Integration.md) | `shared/research.ts`, `server/research.ts`, `client/ResearchWorkspace.tsx` |
| Judge the result | [Evaluation](docs/Evaluation.md) | Keep inputs fixed and explain every retained change |

Both extensions can run independently from the same saved brief. Select runs from the same baseline to combine them. A withdrawal or revoked stay blocks new research and composition.

## Check your work

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Windows tests can use installed Edge or Chrome. Linux/macOS use Playwright Chromium. The browser tests start an isolated server and database on port 4321. They do not use real AI. [Verification](docs/Verification.md) records what was actually checked for this handoff.

## Origin and collaboration

The selected baseline is [Canopia commit 4b843bb](https://github.com/crosojulien-spec/canopia/tree/4b843bb52b96c43155a2991d04dd868d1a895ca4). This repository is independent; the original project, its private databases and its trial budget are untouched. [Provenance](docs/Provenance.md) distinguishes inherited work from hackathon preparation. BlooM and the GTM agent are not dependencies.

Read [contribution guidance](CONTRIBUTING.md) before changing shared interfaces. Repository access is private. No open-source license or public publication decision is included. Confirm the event's prior-work rules, team access, test subjects, source services and any spending allowance before live research.
