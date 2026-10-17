// npm run replay -- --member M1001 : print a member's kit timeline with rule findings at each payment initiation.
import { memberEvents, historyUpTo } from '../src/kit.ts';
import { score } from '../src/rules.ts';

const i = process.argv.indexOf('--member');
const member = i > 0 ? process.argv[i + 1] : 'M1001';
const evs = memberEvents(member);
if (!evs.length) { console.error(`No events for ${member}`); process.exit(1); }
for (const e of evs) {
  if (e.event_type === 'Login' || e.event_type === 'Debit Purchase' || e.event_type === 'ATM Withdrawal' || e.event_type === 'Deposit' || e.event_type === 'Automatic Payment' || e.event_type === 'Bill Payment') continue;
  const amt = e.amount ? ` $${e.amount.toFixed(2)}` : '';
  console.log(`${e.ts_text.padEnd(16)} ${e.event_type.padEnd(24)} ${e.channel.padEnd(14)} ${e.payment_id.padEnd(10)} ${e.rail === 'Not Applicable' ? '' : e.rail}${amt} ${e.payment_status === 'Not Applicable' ? '' : '[' + e.payment_status + ']'}${e.event_note ? '  | ' + e.event_note : ''}`);
  for (const f of score(e, historyUpTo(evs, e))) {
    console.log(`  >> ${f.rule} ${f.output} (${f.tier}): ${f.title}`);
    for (const ev of f.evidence) console.log(`     - ${ev.field}: ${ev.value} — ${ev.why}`);
  }
}
