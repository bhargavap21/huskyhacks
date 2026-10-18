import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitTest } from './kit.ts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { memberEvents, historyUpTo, parseCsv, EVENTS_PATH } from '../src/kit.ts';

const files = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : [p]; });

test('the app never references the Member Key (grep + import ban over src/ and public/)', () => {
  for (const p of [...files('src'), ...files('public')]) {
    const s = readFileSync(p, 'utf8');
    assert.ok(!/Member_Key|member_key|journey_outcome|is_legitimate_lookalike|net_member_loss/.test(s), `answer-key reference in ${p}`);
  }
});
kitTest('history for any scored payment contains only that member and nothing later', () => {
  for (const m of ['M1001', 'M1003', 'M1037', 'M1057']) {
    const evs = memberEvents(m);
    for (const e of evs.filter(x => x.event_type === 'Payment Initiated')) {
      const h = historyUpTo(evs, e);
      assert.ok(h.every(x => x.member === m && x.ts <= e.ts && x.seq <= e.seq));
    }
  }
});
kitTest('replay matches kit rows (spot-check 3 Linda timestamps against the CSV)', () => {
  const [h, ...rows] = parseCsv(readFileSync(EVENTS_PATH, 'utf8'));
  const col = (k: string) => h.indexOf(k);
  const want = ['Recipient Added', 'Payment Held', 'Payment Released'];
  const evs = memberEvents('M1001');
  for (const t of want) {
    const csv = rows.find(r => r[col('synthetic_member_id')] === 'M1001' && r[col('event_type')] === t)!;
    assert.equal(evs.find(e => e.event_type === t)!.ts_text, csv[col('event_timestamp')]);
  }
});
