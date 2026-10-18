// Connected channels: Vantis watches channels the member connected and alerts them on its own,
// before they act. Sources: Gmail auto-forwarding (or Gmail read-only sign-in), and call screening on
// Vantis's number. A detection is kept only when something is worth a look; harmless mail is
// discarded after the check. Alerts go out as a push notification (if the member turned it on), an
// in-app alert, and, failing push, a short email to their linked address.
// Per-member settings live in `channels`; nothing is watched unless the member turned that channel on.
import webpush from 'web-push';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { db } from './db.ts';
import { client } from './chat.ts';
import { tacticsIn } from './tactics.ts';
import { classify, type Classification } from './classifier.ts';
import { ruleSignals, merge, tier, SIGNALS_VERSION, type Signal, type Risk } from './signals.ts';
import { fileReport, normalize, extractIntake } from './reports.ts';
import { demoKey } from './sim.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS channels (sid TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS detections (id INTEGER PRIMARY KEY, sid TEXT NOT NULL, ts INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, sid TEXT NOT NULL, json TEXT NOT NULL);
`);

export type Settings = { email_watch: boolean; screening: boolean; screen_connect: boolean; texts: boolean; whatsapp: boolean; push: boolean; gmail: { address: string; refresh: string; since: number } | null; forward_confirm: { code: string; link: string; from: string; ts: number } | null };
const DEFAULTS: Settings = { email_watch: false, screening: false, screen_connect: false, texts: false, whatsapp: false, push: false, gmail: null, forward_confirm: null };

export function settings(sid: string): Settings {
  const r = db.prepare('SELECT json FROM channels WHERE sid = ?').get(sid) as { json: string } | undefined;
  return { ...DEFAULTS, ...(r ? JSON.parse(r.json) : {}) };
}
export function saveSettings(sid: string, patch: Partial<Settings>) {
  const s = { ...settings(sid), ...patch };
  db.prepare('INSERT OR REPLACE INTO channels (sid, json) VALUES (?, ?)').run(sid, JSON.stringify(s));
  return s;
}
export function sidsWhere(pred: (s: Settings) => boolean): { sid: string; s: Settings }[] {
  return (db.prepare('SELECT sid, json FROM channels').all() as { sid: string; json: string }[])
    .map(r => ({ sid: r.sid, s: { ...DEFAULTS, ...JSON.parse(r.json) } as Settings })).filter(x => pred(x.s));
}

// ---- Detections ----
export type Detection = {
  channel: 'email' | 'call screening' | 'text' | 'gmail' | 'whatsapp';
  risk: Risk; title: string; summary: string; advice: string;
  signals_version?: string; signals?: Signal[]; other?: string[]; // per-signal evidence (signals/v1) + deterministic checks
  source?: 'classifier' | 'rules';
  why: string[]; // flat list for email alerts and reports; derived from signals + other
  from: string; subject?: string; links?: { domain: string; note: string | null }[]; numbers?: string[];
  excerpt?: string; reported?: boolean; alerted_by?: string[];
  demo?: boolean; // a sample sent from the demo walkthrough: hidden from the live product, reported into the demo
  files?: { kind: string; name: string; note: string }[]; // what the member sent along (names and transcripts only)
};
export function detections(sid: string) {
  return (db.prepare('SELECT id, ts, json FROM detections WHERE sid = ? ORDER BY id DESC LIMIT 20').all(sid) as { id: number; ts: number; json: string }[])
    .map(r => { const d = JSON.parse(r.json) as Detection; delete d.excerpt; return { id: r.id, ts: r.ts, ...d }; });
}
export function detection(sid: string, id: number) {
  const r = db.prepare('SELECT json FROM detections WHERE id = ? AND sid = ?').get(id, sid) as { json: string } | undefined;
  return r ? (JSON.parse(r.json) as Detection) : null;
}
export function updateDetection(sid: string, id: number, d: Detection) {
  db.prepare('UPDATE detections SET json = ? WHERE id = ? AND sid = ?').run(JSON.stringify(d), id, sid);
}

// ---- Analysis: cheap checks first, Claude only when something looks off ----
const OFFICIAL = 'soundcu.com';
// Names scammers borrow in look-alike domains, with the real domain.
const BRANDS: { name: string; site: string; re: RegExp }[] = [
  { name: 'Sound', site: OFFICIAL, re: /sound|credit.?union|scu/ },
  { name: 'the IRS', site: 'irs.gov', re: /\birs\b|irs-/ },
  { name: 'USPS', site: 'usps.com', re: /usps/ },
  { name: 'UPS', site: 'ups.com', re: /(^|[.-])ups[.-]/ },
  { name: 'FedEx', site: 'fedex.com', re: /fedex/ },
  { name: 'Amazon', site: 'amazon.com', re: /amazon/ },
  { name: 'PayPal', site: 'paypal.com', re: /paypal/ },
  { name: 'Microsoft', site: 'microsoft.com', re: /microsoft/ },
  { name: 'Apple', site: 'apple.com', re: /apple/ },
];
export function domainNote(domain: string) {
  if (domain === OFFICIAL || domain.endsWith('.' + OFFICIAL)) return 'This is Sound’s real website.';
  const b = BRANDS.find(x => x.re.test(domain));
  return b && domain !== b.site && !domain.endsWith('.' + b.site) ? `Uses ${b.name}’s name, but it isn’t ${b.site}.` : null;
}
export function inspect(text: string) {
  const domains = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/([^\s/<>"')\]]+)/gi)) domains.add(m[1].toLowerCase().replace(/^www\./, '').replace(/[.,;:]+$/, ''));
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|net|org|info|xyz|top|co|io|us|biz|online|site|app|link|support|live|shop))\b/gi)) {
    const d = m[1].toLowerCase().replace(/^www\./, '');
    if (!/agentmail\.to$|^(gmail|outlook|yahoo|icloud|hotmail|google)\.com$/.test(d)) domains.add(d);
  }
  const links = [...domains].slice(0, 8).map(domain => ({ domain, note: domainNote(domain) }));
  const numbers = [...new Set([...text.matchAll(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)].map(m => m[0].trim()))].slice(0, 5);
  return { links, numbers, tactics: tacticsIn(text) };
}
const MONEYISH = /\b(wire|gift ?card|crypto|bitcoin|zelle|venmo|cash ?app|payment|invoice|refund|verify|suspend|locked|unusual (sign|activity)|safe account|move (?:your|his|her|the) money|password|code|ssn|social security|tax|irs|warrant|arrest|prize|winner|inheritance|package|customs|fee)\b|\binvest|\bopportunit|\$\s?\d/i;

/** The rules-only check: pressure tactics, look-alike domains, and any extra warning (e.g. failed sender authentication). */
export function ruleCheck(subject: string, body: string, extra: string[] = []) {
  const f = inspect(`${subject}\n${body}`);
  const lookalike = f.links.some(l => l.note && !l.note.startsWith('This is'));
  return { ...f, lookalike, flag: f.tactics.length > 0 || lookalike || extra.length > 0 };
}

// How incoming messages are checked (issues #3, #9; the detection eval compares them):
//   gate        (default) like hybrid, but clearly ordinary mail (no tactic, look-alike link or money word)
//               never reaches the model
//   hybrid      the classifier sees every message; its evidence and the rules' are merged per signal, and
//               risk comes from the combined evidence (signals.ts)
//   rules       rules only, no model
//   classifier  the model's evidence only, no rules: for measuring the classifier on its own
// Without an API key, or if the call fails, every mode falls back to the rules.
// Every model call is redacted first (#11). gate stays the default until the eval (#10) shows hybrid is better.
export type Mode = 'gate' | 'hybrid' | 'rules' | 'classifier';
const MODES: Mode[] = ['gate', 'hybrid', 'rules', 'classifier'];
export const DETECTION_MODE: Mode = MODES.includes(process.env.DETECTION_MODE as Mode) ? (process.env.DETECTION_MODE as Mode) : 'gate';

/**
 * Should this be flagged? Returns null for harmless messages (then nothing is kept).
 * Detection here is advisory alerting on the member's own channels; it never touches payments (DECISIONS.md, ADR 10).
 * The classifier reports per-signal evidence; risk is computed from the verified evidence, not taken from the model.
 */
export async function assess(channel: Detection['channel'], from: string, subject: string, body: string, extra: string[] = [], opts: { mode?: Mode; client?: any } = {}): Promise<Detection | null> {
  const mode = opts.mode ?? DETECTION_MODE, c = opts.client === undefined ? client : opts.client;
  const text = `${subject}\n${body}`;
  const f = ruleCheck(subject, body, extra);
  const lookalikes = f.links.filter(l => l.note && !l.note.startsWith('This is')).map(l => `${l.domain}: ${l.note}`);
  const rules = ruleSignals(text);
  const hard = lookalikes.length + extra.length; // deterministic checks the model can't argue away
  if (mode === 'gate' && !f.flag && !hard && !MONEYISH.test(`${subject} ${body}`)) return null; // clearly ordinary: discard unread by the model
  let v: Classification | null = null;
  if (mode !== 'rules' && c) {
    try { v = await classify({ channel, from, subject, body, hints: [...rules.map(t => t.label), ...lookalikes, ...extra] }, c); }
    catch (e) { console.error('monitor: Claude unavailable, using automatic checks:', (e as Error).message); }
  }
  if (v?.dropped.length) console.log(`monitor: dropped ${v.dropped.length} model signal(s) without a real quote`);
  const modelOnly = mode === 'classifier' && !!v; // with no model result, fall back to the rules like every mode
  const signals = merge(v, modelOnly ? [] : rules);
  const other = [...(modelOnly ? [] : [...lookalikes, ...extra]), ...(v?.injection ? [`Contains instructions aimed at automated checkers: “${v.injection}”`] : [])];
  // The model may call a message ordinary, which discards generic wording ("today", "your bank").
  // It can't discard specific evidence: a look-alike link, failed authentication, or a code, payment or remote-access ask.
  const specific = !modelOnly && (hard > 0 || rules.some(s => s.key === 'credential_request' || s.key === 'payment_pressure' || s.key === 'remote_access'));
  if (v && !v.alert && !specific) return null;
  if (!signals.length && !other.length) return null; // no evidence, no alert
  let risk = tier(signals, (modelOnly ? 0 : hard) + (v?.injection ? 1 : 0));
  // The model's "ordinary" caps the level at 2, except when hard evidence alone makes it Level 4: a claim to be a bank or
  // agency, or a look-alike link, together with a clear money, code or remote-access ask. That never waits on the model.
  const hardCritical = !modelOnly && hard > 0 && tier(rules, hard) === 'critical';
  if (v && !v.alert && !hardCritical && (risk === 'high' || risk === 'critical')) risk = 'medium';
  return {
    channel, from, subject, risk, source: v ? 'classifier' : 'rules',
    title: (v?.title || `${channel === 'call screening' ? 'A screened call' : 'A message'} has warning signs: ${[...signals.map(s => s.label.toLowerCase()), ...(lookalikes.length ? ['look-alike link'] : [])].join(', ')}`).slice(0, 140),
    summary: (v?.summary ?? '').slice(0, 400),
    signals_version: SIGNALS_VERSION, signals, other,
    why: [...signals.map(s => `${s.label}: “${s.span}”`), ...other].slice(0, 6).map(x => x.slice(0, 220)),
    advice: (v?.advice || `Don’t click links or call numbers from it. Check by typing ${OFFICIAL} yourself or calling the number on your card.`).slice(0, 240),
    links: f.links, numbers: f.numbers, excerpt: body.slice(0, 4000),
  };
}

// ---- Alerts: push, else email; never more than one every two minutes per member ----
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? '';
let pushReady = false;
try {
  const pem = Buffer.from(process.env.VAPID_PRIVATE_KEY_PEM ?? '', 'base64').toString('utf8');
  if (VAPID_PUBLIC && pem.includes('PRIVATE KEY')) {
    const jwk = createPrivateKey(pem).export({ format: 'jwk' }) as { d: string };
    const pub = createPublicKey(createPrivateKey(pem)).export({ format: 'jwk' }) as { x: string; y: string };
    const pubRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
    webpush.setVapidDetails(process.env.VAPID_MAILTO ?? 'mailto:demo@example.com', pubRaw, jwk.d);
    pushReady = pubRaw === VAPID_PUBLIC;
    if (!pushReady) console.error('monitor: VAPID public key does not match the private key; push disabled');
  }
} catch (e) { console.error('monitor: push setup failed:', (e as Error).message); }
export const pushKey = () => (pushReady ? VAPID_PUBLIC : null);

export function addPushSub(sid: string, sub: any) {
  if (!sub?.endpoint || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) throw new Error('Bad subscription');
  db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, sid, json) VALUES (?, ?, ?)').run(sub.endpoint, sid, JSON.stringify(sub));
  saveSettings(sid, { push: true });
}
export function removePushSubs(sid: string) { db.prepare('DELETE FROM push_subs WHERE sid = ?').run(sid); saveSettings(sid, { push: false }); }

// ---- What Vantis does at each threat level ----
//   1 low       kept in the app, no interruption
//   2 medium    notification (push, else email) and a reply on the channel it came in on
//   3 high      same, with "Report to Sound" offered first
//   4 critical  all of the above, and Vantis calls the member right away to talk them through it (phone.ts)
let criticalHandler: ((sid: string, id: number, d: Detection) => Promise<void>) | null = null;
export function onCritical(fn: typeof criticalHandler) { criticalHandler = fn; }

/** A heads-up that isn't a warning ("Vantis is connecting Dr. Lee's office"): push if on, otherwise in the app only. */
export async function notifyMember(sid: string, body: string, url = '/?page=channels') {
  if (!pushReady) return false;
  let sent = false;
  for (const s of db.prepare('SELECT endpoint, json FROM push_subs WHERE sid = ?').all(sid) as { endpoint: string; json: string }[]) {
    try { await webpush.sendNotification(JSON.parse(s.json), JSON.stringify({ title: 'Vantis', body, tag: `info-${Date.now()}`, url }), { TTL: 120 }); sent = true; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); }
  }
  return sent;
}

const lastAlert = new Map<string, number>();
async function alertMember(sid: string, id: number, d: Detection, emailTo: string | null, sendEmail: (to: string, subject: string, text: string) => Promise<void>) {
  const via: string[] = ['app'];
  if (d.risk === 'low') return via; // faint signs only: shown in the app, never pushed or emailed
  if (Date.now() - (lastAlert.get(sid) ?? 0) < 120_000) return via;
  lastAlert.set(sid, Date.now());
  const subs = db.prepare('SELECT endpoint, json FROM push_subs WHERE sid = ?').all(sid) as { endpoint: string; json: string }[];
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.json), JSON.stringify({ title: 'Vantis', body: d.title, tag: `det-${id}`, url: '/?page=channels' }), { TTL: 3600 });
      if (!via.includes('push')) via.push('push');
    } catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); }
  }
  if (!via.includes('push') && emailTo) {
    try { await sendEmail(emailTo, `Vantis: ${d.title}`, `${d.summary}\n\n${d.why.map(w => `- ${w}`).join('\n')}\n\n${d.advice}\n\nOpen the Sound app to see it, or reply REPORT and Vantis will pass it to Sound’s fraud team.\n\nVantis`); via.push('email'); }
    catch (e) { console.error('monitor: alert email failed:', (e as Error).message); }
  }
  return via;
}

/** Keep a detection and alert the member. */
// `notify: false` when the member is already reading Vantis's reply (WhatsApp): kept in the app, no push.
export async function record(sid: string, d: Detection, emailTo: string | null, sendEmail: (to: string, subject: string, text: string) => Promise<void>, notify = true) {
  const id = Number(db.prepare('INSERT INTO detections (sid, ts, json) VALUES (?, ?, ?)').run(sid, Date.now(), JSON.stringify(d)).lastInsertRowid);
  // Level 4: call first (seconds matter), then the usual alerts.
  const call = d.risk === 'critical' && criticalHandler ? criticalHandler(sid, id, d).then(() => true, e => { console.error('monitor: critical call failed:', (e as Error).message); return false; }) : Promise.resolve(false);
  d.alerted_by = notify ? await alertMember(sid, id, d, emailTo, sendEmail) : ['app', ...(d.channel === 'whatsapp' ? ['WhatsApp reply'] : [])];
  if (await call) d.alerted_by.push('phone call');
  updateDetection(sid, id, d);
  console.log(`monitor: ${d.channel} detection for a member (${d.risk}), alerted by ${d.alerted_by.join(', ')}`);
  return id;
}

/** "Report to Sound" on a detection: build the fraud case from what Vantis saw. */
export async function reportDetection(sid: string, id: number) {
  const d = detection(sid, id);
  if (!d) throw new Error('That alert is gone');
  const base = { summary: `${d.title}. ${d.summary}`, contact_method: d.channel === 'call screening' ? 'phone call (screened by Vantis)' : d.channel === 'text' ? 'text message' : d.channel === 'whatsapp' ? 'WhatsApp message' : 'email', scammer_phone: d.channel === 'call screening' ? d.from : d.numbers?.[0] ?? '', scammer_email: /@/.test(d.from) ? d.from.replace(/^.*<([^>]+)>.*$/, '$1') : '', scammer_website: d.links?.find(l => l.note && !l.note.startsWith('This is'))?.domain ?? d.links?.[0]?.domain ?? '', tactics: d.signals ? d.signals.map(s => s.label) : d.why };
  const x = await extractIntake('You read something Vantis flagged on a credit union member’s connected channel (an email, text, or a call it screened). The member has not acted on it. Fill the fraud case: the threat details come from the message; the member did not send money or share anything unless the content says so.', `From: ${d.from}\nSubject: ${d.subject ?? ''}\n\n${d.excerpt ?? d.summary}`).catch(() => null);
  const tactics = d.signals ? d.signals.map(s => s.label) : d.why;
  const out = await fileReport(d.demo ? demoKey(sid) : sid, normalize({ ...base, ...(x ?? {}), tactics: [...new Set([...tactics, ...(x?.tactics ?? [])])].slice(0, 8), signals: d.signals ?? [] }, d.channel === 'whatsapp' ? 'whatsapp' : 'app', { linked: true }));
  d.reported = true; updateDetection(sid, id, d);
  return out;
}
