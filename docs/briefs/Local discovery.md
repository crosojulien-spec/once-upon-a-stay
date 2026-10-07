# Local experience discovery

Find activities, exhibitions, tours or venues for the stay dates, guided by the guest's interests, pace and constraints. Return two or three sourced options that the hotel can assess and combine with its own transport, dining, guidance or personal touches.

For one city and fixed dates, collect the exact venue/location, relevant slot, duration, travel requirements, language/accessibility constraints, booking URL or contact, price/currency/basis, inclusions and cancellation terms. Record the source and check time. Advertised availability and supplier-confirmed availability are different states; unknowns remain visible.

Build in `extensions/local-discovery/index.ts`. Start with a small set of accessible venue or listing sources and the Prague case if useful. The current adapter returns not-implemented; simulated previews contain invented placeholders only. Real date filtering, retrieval, logistics and evidence checking remain hackathon work.

Compose an option with documented hotel capabilities, naming who would arrange each part and what must be confirmed. Keep external prices separate from hotel costs, markup and the final guest price. The hotel chooses the package and final price. No suitable reliable option becomes a concierge research task, not an invented recommendation.

Original reference: [Local discovery source.docx](Local%20discovery%20source.docx). Its old Git snapshot is historical; use [the current integration guide](../Integration.md).
