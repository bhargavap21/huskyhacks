// Measurement only (HANDOFF section 9): the Member Key is read HERE, never by src/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEvents, parseCsv, historyUpTo, USING_STANDIN } from '../src/kit.ts';
import { score } from '../src/rules.ts';

// The key must match the events: the synthetic stand-in's own key, or the official one next to the official events.
const KEY_PATH = USING_STANDIN ? join(import.meta.dirname, '..', 'fixtures', 'synthetic-kit', 'member-key.csv') : join(import.meta.dirname, '..', 'data', 'HuskyHack_Member_Key_v2.csv');
if (USING_STANDIN) console.log('Synthetic stand-in data (fixtures/synthetic-kit/), not the official kit: these counts say nothing about the real rules.\n');
const [h, ...rows] = parseCsv(readFileSync(KEY_PATH, 'utf8'));
const key = new Map(rows.filter(r => r.length >= h.length).map(r => [r[0], Object.fromEntries(h.map((k, i) => [k, r[i]]))]));
const group = (m: string) => { const k = key.get(m)!; return k.is_legitimate_lookalike === 'Yes' ? 'Legitimate look-alike' : k.scenario_type === 'Normal Activity' ? 'Routine' : k.scenario_type; };

const fired = new Map<string, Map<string, Set<string>>>(); // rule -> group -> members
const anyCatch = new Set<string>();
for (const [m, evs] of loadEvents()) {
  for (const e of evs) for (const f of score(e, historyUpTo(evs, e))) {
    if (f.rule === 'STD') continue;
    anyCatch.add(m);
    const g = fired.get(f.rule) ?? fired.set(f.rule, new Map()).get(f.rule)!;
    (g.get(group(m)) ?? g.set(group(m), new Set()).get(group(m))!).add(m);
  }
}
const totals = new Map<string, number>();
for (const m of key.keys()) totals.set(group(m), (totals.get(group(m)) ?? 0) + 1);
for (const r of ['R1', 'R2', 'R3', 'R4']) {
  console.log(r);
  for (const [g, ms] of fired.get(r) ?? []) console.log(`  ${g.padEnd(42)} ${ms.size}/${totals.get(g)}${g === 'Legitimate look-alike' ? '  ' + [...ms].sort().join(', ') : ''}`);
}
console.log('Missed by every rule:');
for (const [m, k] of key) if (k.scenario_type !== 'Normal Activity' && !anyCatch.has(m)) console.log(`  ${m} ${k.scenario_type} | ${k.journey_outcome} | loss $${k.net_member_loss}`);
console.log('\nIllustration on synthetic data only; not an accuracy or fraud-rate claim.');
