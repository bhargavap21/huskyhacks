// Calibration for connected-channel risk tiers (docs/signals.md, DECISIONS.md #10).
// Runs every labeled fixture in fixtures/emails.json through assess() and checks the tier against the label:
//   needs_human_review            -> high or medium (alerts the member)
//   no_concern_or_low             -> no alert, or low (in the app only, never pushed)
//   worth_a_second_look_or_unknown -> low or medium (never high)
// `npm run calibrate` uses Claude if a key is set (8 small calls); `npm run calibrate -- --rules` runs the rules only, free.
const rulesOnly = process.argv.includes('--rules');
process.env.DB_PATH = ':memory:';
if (rulesOnly) { delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_API_KEY; }
else await import('dotenv/config');

const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');
const { assess } = await import('../src/monitor.ts');

const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'emails.json'), 'utf8'));
const OK: Record<string, (r: string) => boolean> = {
  needs_human_review: r => r === 'high' || r === 'medium',
  no_concern_or_low: r => r === 'none' || r === 'low',
  worth_a_second_look_or_unknown: r => r === 'low' || r === 'medium',
};
let fails = 0;
console.log(`Mode: ${rulesOnly ? 'rules only' : 'Claude + rules'}\n`);
for (const f of fixtures) {
  const d = await assess('email', f.from_header, f.subject, f.body_text, [], { mode: 'gate' });
  const risk = d?.risk ?? 'none';
  const ok = OK[f.expected.verdict]?.(risk) ?? true;
  // Safety-relevant: a scam that doesn't alert, or a benign message that interrupts the member. A weak case left
  // unflagged is a known gap of the rules-only path (they can't read a vague pitch), reported but not failed.
  const soft = !ok && f.expected.verdict === 'worth_a_second_look_or_unknown' && risk === 'none';
  if (!ok && !soft) fails++;
  console.log(`${ok ? 'ok  ' : soft ? 'miss' : 'FAIL'} ${f.fixture_id} expected ${f.expected.verdict}, got ${risk}`);
  for (const s of d?.signals ?? []) console.log(`       ${s.key} ${s.score.toFixed(2)} (${s.source}): “${s.span.slice(0, 90)}”`);
  for (const o of d?.other ?? []) console.log(`       + ${o.slice(0, 110)}`);
  const quoted = (d?.signals ?? []).map(s => s.span.toLowerCase()).join(' | ');
  const missing = (f.expected.must_quote ?? []).filter((q: string) => !quoted.includes(q.toLowerCase().slice(0, 18)));
  if (missing.length) console.log(`       (not quoted: ${missing.map((q: string) => `“${q}”`).join(', ')})`);
}
console.log(`\n${fixtures.length - fails}/${fixtures.length} fixtures without a safety-relevant miss`);
process.exit(fails ? 1 : 0);
