import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.');
const ignored = new Set([
  'node_modules',
  '.git',
  '.local',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
async function walk(folder) {
  const found = [];
  for (const e of await readdir(folder, { withFileTypes: true })) {
    if (ignored.has(e.name) || e.name === '.env') continue;
    const p = resolve(folder, e.name);
    if (e.isDirectory()) found.push(...(await walk(p)));
    else found.push(p);
  }
  return found;
}
const files = await walk(root);
let links = 0,
  jsonFiles = 0;
for (const path of files) {
  const name = relative(root, path);
  if (/\.(docx|png|jpg|woff2?)$/i.test(path)) continue;
  const content = await readFile(path, 'utf8');
  if (path.endsWith('.json')) {
    JSON.parse(content);
    jsonFiles++;
  }
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content), `Private key marker in ${name}`);
  assert(
    !/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/.test(content),
    `Credential-like value in ${name}`,
  );
  if (!path.endsWith('.md')) continue;
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split(' "')[0].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(\w+:|\/\/)/.test(target)) continue;
    await stat(resolve(dirname(path), decodeURIComponent(target))).catch(() => {
      throw new Error(`Broken link in ${name}: ${target}`);
    });
    links++;
  }
}
for (const id of ['family-anniversary', 'prague-anniversary', 'work-and-running']) {
  const path = resolve('examples', id);
  const d = JSON.parse(await readFile(resolve(path, 'case.json'), 'utf8'));
  assert(d.input.stay.demo && d.input.stay.email === '', 'Example must be fictional without an email');
  assert.equal(d.input.hotel.id, d.input.stay.hotelId);
  assert.equal(d.input.hotel.version, d.input.stay.dnaVersion);
  const ids = new Set(d.input.messages.filter((m) => m.role === 'user').map((m) => m.id));
  for (const f of d.input.stay.facts) assert(ids.has(f.sourceMessageId), `Missing guest evidence in ${id}`);
  assert.equal(
    (await readFile(resolve(path, 'Baseline brief.txt'), 'utf8')).replace(/\r\n/g, '\n').trimEnd(),
    d.baseline.text.trimEnd(),
  );
  const conversation = d.input.messages
    .map((m) => (m.role === 'user' ? 'GUEST' : 'HOST') + ': ' + m.content)
    .join('\n\n');
  assert.equal(
    (await readFile(resolve(path, 'Conversation.txt'), 'utf8')).replace(/\r\n/g, '\n').trimEnd(),
    conversation.trimEnd(),
  );
}
console.log(
  `Repository checks passed: ${files.length} files, ${jsonFiles} JSON files, ${links} relative links, three consistent fictional cases.`,
);
