// Second Look files a fraud report with Sound on the member's behalf, from any channel.
// It only files when the member asked or agreed in that conversation; it offers on its own when it sees
// warning signs or money already gone. The report lands in the employee work queue (urgent), and, if
// FRAUD_TEAM_EMAIL is set, is also emailed to Sound's fraud team from Second Look's inbox.
import { useWorld, fraudReport, type FraudReport } from './sim.ts';
import { audit } from './db.ts';

const FRAUD_TEAM = process.env.FRAUD_TEAM_EMAIL ?? '';
const INBOX = process.env.AGENTMAIL_INBOX_ID;
const KEY = process.env.AGENTMAIL_API_KEY;

const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function normalize(raw: any, channel: FraudReport['channel'], contact: string): FraudReport {
  return {
    channel, contact: clean(contact, 120),
    summary: clean(raw?.summary, 600) || 'The member asked Second Look to report a possible scam.',
    asked_for: clean(raw?.asked_for, 200),
    money_sent: !!raw?.money_sent,
    tactics: (Array.isArray(raw?.tactics) ? raw.tactics : []).map((t: unknown) => clean(t, 60)).filter(Boolean).slice(0, 8),
    quotes: (Array.isArray(raw?.quotes) ? raw.quotes : []).map((t: unknown) => clean(t, 200)).filter(Boolean).slice(0, 4),
  };
}

async function emailTeam(r: FraudReport) {
  if (!FRAUD_TEAM || !INBOX || !KEY) return false;
  const text = [
    `Second Look filed this report at the member's request (${r.channel}).`, '',
    `Member contact: ${r.contact || 'see the employee console'}`,
    `Money already sent: ${r.money_sent ? 'YES, start recovery now' : 'not that we know of'}`,
    r.asked_for ? `What they were asked for: ${r.asked_for}` : '',
    r.tactics.length ? `Warning signs: ${r.tactics.join(', ')}` : '', '',
    r.summary, '',
    ...r.quotes.map(q => `> ${q}`), '',
    'These are the member’s account and automatic checks, not proof. Call the member on the number on file, not any number from the scam.',
    '— Second Look (HuskyHack 2026 concept demo)',
  ].filter(l => l !== undefined).join('\n');
  try {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(INBOX)}/messages/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ to: [FRAUD_TEAM], subject: `${r.money_sent ? 'URGENT: ' : ''}Second Look fraud report (${r.channel})`, text }),
    });
    return res.ok;
  } catch { return false; }
}

/** File for a member's simulation (sid), or with no sid (an unlinked caller): then only the fraud-team email goes out. */
export async function fileReport(sid: string | null, r: FraudReport) {
  let queued = false;
  if (sid) { useWorld(sid); fraudReport(r); queued = true; } // synchronous: no await between choosing the world and writing
  else audit('second-look', 'fraud_report_unlinked', `${r.channel}: ${r.summary.slice(0, 200)}`);
  const emailed = await emailTeam(r);
  return { queued, emailed };
}
