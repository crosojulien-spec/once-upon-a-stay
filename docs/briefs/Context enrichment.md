# Context enrichment

Start with an interest voluntarily declared in the Canopia conversation. Research relevant public information about a verified test subject, then propose a small number of useful hotel-reviewed adaptations or experiences. The experiment should show what that evidence adds to conversation plus DNA alone.

An illustrative running case could connect a declared running interest with verified public evidence of usual distance, then suggest a suitable local route. This is a concept, not a claim that the fictional running example has an online activity profile.

Inputs: declared cue and guest-message reference, stay context, verified subject identifiers/public URLs, frozen hotel DNA and fixed baseline brief. Outputs: finding, source/check date, identity uncertainty, proposed action, capabilities needed, remaining checks and human decision.

Build in `extensions/context-enrichment/index.ts`. The current adapter abstains when identity is unverified and otherwise returns not-implemented. Define the test subjects and accessible sources before connecting a provider. A same-name match is insufficient. No reliable finding is a valid outcome. The team must evaluate relevance, avoid unrelated or sensitive profiling, and keep the original brief when evidence adds nothing.

Compare the original and enriched briefs with fixed inputs. Show accepted and discarded proposals, not just the amount of information found. Product adoption and conditions for real-guest use remain open.

Original reference: [Context enrichment source.docx](Context%20enrichment%20source.docx). Its old repository links are historical; use [the current integration guide](../Integration.md).
