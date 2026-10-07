# Setup and connections

## Local demo

Install Node.js 24.18 or newer in the 24.x line, then run `npm ci` and `npm run demo` from the repository root. Open http://127.0.0.1:4320. Create a local operator account with your own email identifier and password; no email is sent. Load any of the three recorded cases from the home page.

No environment file, API account, remote database or email service is needed. The demo forces scripted AI, disables email and remote PostgreSQL, and uses `.local/demo`. Existing Canopia data is never opened. Start only one process per data folder. Stopping the server preserves the demo data. To begin another development dataset, use `npm run dev` with a new local data-directory setting; never use this mechanism to replenish an authorised paid allowance.

## Development

`npm run dev` starts the Vite/Express development app with live AI disabled by default. It uses `.local/development` on port 4320. Copy `.env.example` to `.env` only when changing configuration. Keep the two data folders and their installation keys separate; do not move a database without its key. All are ignored by Git.

`npm run build` typechecks and builds the frontend. `npm start` runs the TypeScript server using installed development dependencies. To serve the compiled frontend, set `CANOPIA_SERVE_BUILD=true` before `npm start`. This is a local persistent Node application, not a static website or a serverless deployment package.

## Tests

`npm run check` runs TypeScript, server/data tests, the build, formatting and repository consistency checks. Browser checks require `npx playwright install chromium`; on Linux install the browser's OS libraries with `npx playwright install --with-deps chromium`. On Windows an installed Edge or Chrome is used when available. `PLAYWRIGHT_EXECUTABLE_PATH` may select another compatible local executable.

Run `npm run build` before `npm run test:e2e`. Browser tests start their own server on port 4321 and create a fresh `.local/e2e-*` database. Close another process using that port first. Test screenshots stay in `.local/screenshots`; no screenshot from a private installation is committed automatically.

## Optional live connections

No live connection or new expense was enabled during preparation. The inherited conversation/brief adapter supports the pinned Luna model and a persistent allowance capped at USD 5. Its historical rate constants are conservative accounting inputs, not a current price guarantee. Model access, rates and the hackathon budget must be confirmed before enabling paid calls. Julien's original Canopia allowance is not transferable or reset here.

For a later explicitly authorised trial, the configuration fields are `CANOPIA_AI_MODE=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-6-luna`, `CANOPIA_ALLOW_AI_CALLS=true` and an agreed `CANOPIA_AI_BUDGET_USD`. The default is zero and disabled. Never paste a key into Git, a chat, a browser bundle or a test fixture. This preparation has not run live AI through the new repository.

The research adapters have no source-provider credentials or network implementation. Select the required service at the event and document its environment variables alongside the relevant adapter. Set bounded deadlines and request budgets, preserve source/check timestamps, and treat fetched text as untrusted data.

SMTP and remote PostgreSQL paths are inherited but disabled and unverified here. Local guest links work only on the computer running the server. Repository sharing is not application hosting. Deployment, production provisioning, real guest retention/deletion policy and sending remain separate decisions.
