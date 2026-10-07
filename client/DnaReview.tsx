import type { ReactNode } from 'react';

// Deliberately limited Markdown: React escapes all text; only HTTPS links are
// rendered. Operator-authored HTML is never executed.
function inline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  let offset = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)) {
    result.push(text.slice(offset, m.index));
    result.push(
      <a href={m[2]} target="_blank" rel="noreferrer" key={m.index}>
        {m[1]}
      </a>,
    );
    offset = m.index! + m[0].length;
  }
  result.push(text.slice(offset));
  return result;
}
function blocks(text: string) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block, i) => {
      const lines = block.split('\n');
      if (lines.length > 1 && lines.every((line) => line.startsWith('|'))) {
        const rows = lines.map((line) =>
          line
            .split('|')
            .slice(1, -1)
            .map((s) => s.trim()),
        );
        const [header, ...body] = rows.filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
        if (!header) return <p key={i}>{inline(block)}</p>;
        return (
          <div className="dna-table-scroll" key={i}>
            <table>
              <thead>
                <tr>
                  {header.map((cell, j) => (
                    <th key={j}>{inline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k}>{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      if (lines.every((line) => line.startsWith('- '))) {
        return (
          <ul key={i}>
            {lines.map((line, j) => (
              <li key={j}>{inline(line.slice(2))}</li>
            ))}
          </ul>
        );
      }
      return <p key={i}>{inline(block)}</p>;
    });
}
export function DnaReview({ text }: { text: string }) {
  const sections = text.replace(/\r\n/g, '\n').split(/\n(?=## )/);
  return (
    <div className="dna-review">
      {sections.map((section, i) => {
        const [title, ...body] = section.split('\n');
        if (!title.startsWith('## ')) return <div key={i}>{blocks(section.replace(/^# [^\n]*\n?/, ''))}</div>;
        return (
          <details key={i} open={i <= 2}>
            <summary>{title.slice(3)}</summary>
            <div className="dna-section-body">{blocks(body.join('\n'))}</div>
          </details>
        );
      })}
    </div>
  );
}
