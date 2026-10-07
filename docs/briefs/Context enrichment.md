# Context enrichment

Start with an idea already developed from the guest conversation and Hotel DNA. Research a relevant detail about a reliably identified test subject to refine that idea before briefs are generated. The [approved process guide](../Canopia%20process%20and%20research%20agents.docx) includes running, reading and photography examples. The current Research lab runs after a saved brief for comparison; adapting that placement remains implementation work.

An illustrative running case could connect a declared running interest with verified public evidence of usual distance, then suggest a suitable local route. This is a concept, not a claim that the fictional running example has an online activity profile.

Inputs: declared cue and guest-message reference, stay context, verified subject identifiers/public URLs, frozen hotel DNA and fixed baseline brief. Outputs: finding, source/check date, identity uncertainty, proposed action, capabilities needed, remaining checks and human decision.

Build in `extensions/context-enrichment/index.ts`. The current adapter abstains when identity is unverified and otherwise returns not-implemented. Define the test subjects and accessible sources before connecting a provider. A same-name match is insufficient. No reliable finding is a valid outcome. The team must evaluate relevance, avoid unrelated or sensitive profiling, and keep the original brief when evidence adds nothing.

Compare the original and enriched briefs with fixed inputs. Show accepted and discarded proposals, not just the amount of information found. Product adoption and conditions for real-guest use remain open.

Original reference: [Context enrichment source.docx](Context%20enrichment%20source.docx). Its old repository links are historical; use [the current integration guide](../Integration.md).
