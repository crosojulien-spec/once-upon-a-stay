# Local experience discovery

Use guest discovery, Hotel DNA, destination, stay dates and constraints to find concrete local activities, exhibitions, tours or venues. Build two or three sourced options or packs by combining those experiences with relevant hotel services before briefs are generated. Reception or concierge should have enough practical information to organise and book them. The [approved process guide](../Canopia%20process%20and%20research%20agents.docx) illustrates the flow. The current Research lab runs after a saved brief for comparison; adapting that placement remains implementation work.

For one city and fixed dates, collect the exact venue/location, relevant slot, duration, travel requirements, language/accessibility constraints, booking URL or contact, price/currency/basis, inclusions and cancellation terms. Record the source and check time. Advertised availability and supplier-confirmed availability are different states; unknowns remain visible.

Build in `extensions/local-discovery/index.ts`. Start with a small set of accessible venue or listing sources and the Prague case if useful. The current adapter returns not-implemented; simulated previews contain invented placeholders only. Real date filtering, retrieval, logistics and evidence checking remain hackathon work.

Compose an option with documented hotel capabilities, naming who would arrange each part and what must be confirmed. Keep external prices separate from hotel costs, markup and the final guest price. The hotel chooses the package and final price. No suitable reliable option becomes a concierge research task, not an invented recommendation.

Original reference: [Local discovery source.docx](Local%20discovery%20source.docx). Its old Git snapshot is historical; use [the current integration guide](../Integration.md).
