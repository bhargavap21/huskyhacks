// PII redaction before every external model call (issue #11). Names, phone numbers, email addresses, street
// addresses, card and account numbers, SSNs, one-time codes and passwords become stable tokens ([NAME_1],
// [PHONE_2]) before text leaves this server, and the model's answer is turned back here, on the server.
// The token mapping lives only for that one call, in memory: it is never stored, logged or sent anywhere.
// Identity comes back as written (names, numbers, addresses: the member and Sound's fraud team need them).
// Secrets come back masked (•••• 4821, ••••••), so no code or card number is repeated, here or anywhere.
// Detection is by pattern: anything with a shape (numbers, emails, addresses), and names in context
// ("this is", "Dear", "Officer", "my grandson", sign-offs, From: lines) or already known: every member name we
// hold is redacted wherever it appears, context or not. A stranger's name with no context can still be missed.
// Photos and PDFs are read into text on this server first (src/media.ts), so they are covered too.

export type Kind = 'NAME' | 'PHONE' | 'EMAIL' | 'ADDRESS' | 'CARD' | 'ACCOUNT' | 'SSN' | 'CODE' | 'PASSWORD';
const KINDS: Kind[] = ['NAME', 'PHONE', 'EMAIL', 'ADDRESS', 'CARD', 'ACCOUNT', 'SSN', 'CODE', 'PASSWORD'];
const SECRET = new Set<Kind>(['CARD', 'ACCOUNT', 'SSN', 'CODE', 'PASSWORD']);
const TOKEN = new RegExp(String.raw`\[?\b(${KINDS.join('|')})_(\d+)\b\]?`, 'g');

/** How a secret reads once it comes back from the model: enough to recognize it, never the value. */
export function masked(kind: Kind, value: string) {
  const d = value.replace(/\D/g, '');
  if (kind === 'CARD' || kind === 'ACCOUNT') return d.length > 4 ? `•••• ${d.slice(-4)}` : '••••';
  if (kind === 'SSN') return '•••-••-••••';
  return '••••••';
}
// What a voice agent hears instead of a token: it can't be turned back, so it says what was there.
const SAID: Record<Kind, string> = { NAME: '[a name]', PHONE: '[a phone number]', EMAIL: '[an email address]', ADDRESS: '[an address]', CARD: '[a card number]', ACCOUNT: '[an account number]', SSN: '[an SSN]', CODE: '[a code]', PASSWORD: '[a password]' };

// ---- Patterns. Each leaves dollar amounts, dates, times, case IDs (SL-20261018-0004) and domains alone. ----
// Not part of a bigger number or word: 1,000 and 4.77 are separators between digits; "482913, then" is a code.
const EDGE_L = String.raw`(?<![\w$/+-])(?<!\d[.,])`, EDGE_R = String.raw`(?![\w/-]|[.,]\d)`;
const EMAIL = /\b([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
// A mailbox for a role, not a person (careers@, estate.claims@, account-security-noreply@): every word is a role word.
// Kept, since the sender's role is evidence ("winner@").
const ROLE_WORDS = new Set(`no noreply reply do not donotreply support help helpdesk desk info service services security alert alerts notification
notifications notice notices billing account accounts admin contact team hello fraud customer customerservice care mail mailer news newsletter
update updates verify verification careers jobs hr payroll sales offer offers receipt receipts statement statements office leasing closing docs
jury winner winners claim claims estate rental rentals owner order orders shipping delivery tracking refund refunds reward rewards promo
promotions marketing online communication communications member members webmaster postmaster privacy legal compliance invest investments system`.split(/\s+/));
const isRole = (local: string) => local.toLowerCase().replace(/\d+/g, '').split(/[._+-]+/).filter(Boolean).every(w => ROLE_WORDS.has(w));
const SSN_DASHED = new RegExp(`${EDGE_L}\\d{3}[- ]\\d{2}[- ]\\d{4}(?![\\w-])`, 'g');
const SSN_SAID = new RegExp(String.raw`(\b(?:ssn|social security(?: number| no\.?| #)?)\b[^\d\n]{0,20}?)${EDGE_L}(\d{9})(?![\w-])`, 'gi');
const PASSWORD = /(\b(?:password|passcode|pass code)\b\s*(:|=|is|was)\s*["'“]?)([^\s"'”,;]{3,64})/gi;
const STREET = 'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Terrace|Ter|Circle|Cir|Loop|Trail|Trl';
const ADDRESS = new RegExp(String.raw`${EDGE_L}\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:(?:[A-Z][a-z]+|\d+(?:st|nd|rd|th))\s+){1,3}(?:${STREET})\b\.?(?:\s+(?:NE|NW|SE|SW|N|S|E|W)\b)?(?:,?\s*(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*[\w-]+)?(?:,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,?\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?`, 'g');
const PO_BOX = /\bP\.?\s?O\.?\s+Box\s+\d+\b/gi;
const CODE_AFTER = new RegExp(String.raw`(\b(?:code|passcode|otp|pin|verification|one[- ]time)\b[^\d\n$]{0,40}?)${EDGE_L}((?:[A-Z]-)?\d{4,8})${EDGE_R}`, 'gi');
const NOT_A_CODE = /\b(?:zip|area|postal|promo|discount|coupon|country|error|status|tax|source)\s*$/i;
const CODE_BEFORE = new RegExp(String.raw`${EDGE_L}(\d{4,8})${EDGE_R}(?=\s+(?:is|was)\s+(?:your|the)\b[^\n\d]{0,30}\b(?:code|pin|passcode|otp)\b)`, 'gi');
const PHONE_US = new RegExp(String.raw`${EDGE_L}(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}${EDGE_R}`, 'g');
const PHONE_INTL = new RegExp(String.raw`${EDGE_L}\+\d{1,3}(?:[\s.-]?\d{2,4}){2,5}${EDGE_R}`, 'g');
const DIGITS = new RegExp(String.raw`${EDGE_L}\d(?:[ -]?\d){7,18}${EDGE_R}`, 'g');
const ACCOUNT_WORD = /\b(?:account|acct|routing|member (?:number|no|#|id))\b[^\n]*$/i;
const ACCOUNT_SAID = new RegExp(String.raw`(\b(?:account|acct|routing)(?:\s+(?:number|no\.?|#))?|\bmember\s+(?:number|no\.?|#|id))([^\d\n$]{0,15}?)${EDGE_L}(\d{5,7})${EDGE_R}`, 'gi');

const luhn = (d: string) => {
  let s = 0;
  for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; }
  return s % 10 === 0;
};

// ---- Names in context ----
const TITLES = 'Mr|Mrs|Ms|Miss|Mx|Dr|Officer|Special Agent|Agent|Detective|Det|Sergeant|Sgt|Deputy|Captain|Capt|Lieutenant|Lt|Inspector|Attorney|Judge|Sheriff|Professor|Prof|Pastor|Father';
const WORD = String.raw`[A-Z][a-z]+(?:-[A-Z][a-z]+)?`;
// Words that open a name, matched without case. The name itself must be capitalized.
const LEAD = /\b(?:my name is|my name's|name is|name:|this is|it's|it’s|i am|i'm|i’m|signed|regards|sincerely|thanks|thank you|cheers|best|love|dear|hi|hello|hey|attn|attention|from:|grandson|granddaughter|grandchild|son|daughter|nephew|niece|cousin|brother|sister|husband|wife|boyfriend|girlfriend|fianc[ée]e?|uncle|aunt|named|called)[,:]?[ \t]*(?:\r?\n[ \t]*)?/gi;
const FOLLOW = new RegExp(String.raw`["“]?(?:(?:${TITLES})\.?\s+)?(${WORD}(?:[ \t]+(?:[A-Z]\.[ \t]+)?${WORD}){0,3})`, 'y');
// "from" is usually an organization ("from Amazon"), so after it only a first-and-last-name pair counts ("Invoice from Rosalind Okafor").
const FROM_PAIR = new RegExp(String.raw`\bfrom[ \t]+(${WORD}[ \t]+${WORD})(?![ \t]+[A-Z])`, 'g');
const TITLED = new RegExp(String.raw`\b(?:${TITLES})\.?\s+(${WORD}(?:[ \t]+${WORD})?)`, 'g');
// Capitalized words that are not names: organizations, places, products, and words that start a sentence.
const NOT_NAMES = new Set(`sound vantis credit union bank irs fbi ssa dea police sheriff government federal department fraud security
support team service services customer client user member valued account holder agent officer amazon apple microsoft google paypal
usps ups fedex dhl zelle venmo cash app chase wells fargo citi citibank medicare medicaid social internal revenue tech technical geek
squad norton mcafee windows iphone android whatsapp gmail outlook yahoo icloud bitcoin crypto coinbase western moneygram walmart target
best buy ebay netflix verizon comcast xfinity spectrum att mobile wireless energy seattle washington america american express visa
mastercard discover capital office pharmacy clinic hospital school court county city state national international center centre unit
division legal claims billing delivery package order prize lottery winner refund investment the a an your you we our us i me my this
that it here there please sorry not just calling from with about good morning afternoon evening everyone all sir madam ma'am mom dad
mum grandma grandpa grandmother grandfather honey dear friend again so ok okay yes no hello hi hey thanks thank regards best sincerely
cheers love mr mrs ms dr urgent important notice alert final warning re fwd fw subject today tomorrow tonight monday tuesday wednesday
thursday friday saturday sunday january february march april june july august september october november december inc llc ltd co corp
company group agency insurance online digital global new york san los las north south east west united states puget king`.split(/\s+/));
const ORG_WORDS = /^(?:Bank|Police|Department|Services?|Support|Inc|Llc|Ltd|Company|Corp|Team|Office|Pharmacy|Clinic|Credit|Union|Insurance|Agency|Group|Center|Centre|Energy|Mobile|Wireless|Security|Fraud|Systems|Solutions|Financial|Federal|County|City|State)$/;

function candidate(raw: string): string | null {
  const words = raw.split(/\s+/);
  if (words.some(w => ORG_WORDS.test(w))) return null; // "this is Acme Services" is an organization
  const keep: string[] = [];
  for (const w of words) { if (NOT_NAMES.has(w.toLowerCase().replace(/\.$/, ''))) break; keep.push(w); }
  const name = keep.join(' ').trim();
  return name.length >= 2 && /[a-z]/.test(name) ? name : null;
}

/** Names this text gives in context: "This is Mark from…", "Dear Linda,", "Officer Davis", "my grandson Michael". */
export function namesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(LEAD)) {
    FOLLOW.lastIndex = m.index! + m[0].length;
    const f = FOLLOW.exec(text);
    const n = f && candidate(f[1]);
    if (n) out.add(n);
  }
  for (const m of text.matchAll(TITLED)) { const n = candidate(m[1]); if (n) out.add(n); }
  for (const m of text.matchAll(FROM_PAIR)) { const n = candidate(m[1]); if (n?.includes(' ')) out.add(n); }
  return [...out];
}

// A known name is used only if it reads as one ("Linda", "Sarah Chen"), not a label ("Home buyer", "Member").
const LOOKS_LIKE_NAME = new RegExp(String.raw`^${WORD}(?:\s+(?:[A-Z]\.\s+)?${WORD}){0,2}$`);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One mapping for one model call: redact the request, restore the answer. */
export class Redactor {
  private tokens = new Map<string, string>(); // `${kind}:${value}` -> token
  private values = new Map<string, { kind: Kind; value: string }>(); // token -> what it stands for
  private counts = new Map<Kind, number>();
  private names = new Set<string>();

  constructor(known: string[] = []) { for (const n of known) if (LOOKS_LIKE_NAME.test(n.replace(/\(.*?\)/g, '').trim())) this.addName(n.replace(/\(.*?\)/g, '')); }

  private addName(name: string) {
    const n = name.replace(/\s+/g, ' ').trim();
    if (n.length < 2 || NOT_NAMES.has(n.toLowerCase())) return;
    this.names.add(n);
    // "Michael Brown" also covers a later "Michael" or "Brown" on its own.
    for (const part of n.split(' ')) if (part.length >= 3 && !NOT_NAMES.has(part.toLowerCase()) && /^[A-Z]/.test(part)) this.names.add(part);
  }
  learn(text: string) { for (const n of namesIn(text)) this.addName(n); }

  private tok(kind: Kind, value: string) {
    const key = `${kind}:${value}`;
    let t = this.tokens.get(key);
    if (!t) {
      const n = (this.counts.get(kind) ?? 0) + 1;
      this.counts.set(kind, n);
      t = `[${kind}_${n}]`;
      this.tokens.set(key, t); this.values.set(t, { kind, value });
    }
    return t;
  }

  redact(text: string): string {
    if (!text) return text;
    this.learn(text);
    let s = text.replace(EMAIL, (m, local: string, domain: string) => (isRole(local) ? m : `${this.tok('EMAIL', local)}@${domain}`));
    s = s.replace(SSN_DASHED, m => this.tok('SSN', m));
    s = s.replace(SSN_SAID, (_, pre, d) => pre + this.tok('SSN', d));
    s = s.replace(PASSWORD, (m, pre: string, sep: string, v: string) => {
      const value = v.replace(/[.!?]+$/, '');
      if (/^(?:is|was)$/i.test(sep) && !/[\d\W_]/.test(value)) return m; // "your password is expiring"
      return pre + this.tok('PASSWORD', value) + v.slice(value.length);
    });
    s = s.replace(ADDRESS, m => this.tok('ADDRESS', m.replace(/\.$/, '')) + (m.endsWith('.') ? '.' : ''));
    s = s.replace(PO_BOX, m => this.tok('ADDRESS', m));
    s = s.replace(CODE_AFTER, (m, pre: string, code: string, at: number, all: string) => (NOT_A_CODE.test(all.slice(Math.max(0, at - 12), at)) ? m : pre + this.tok('CODE', code)));
    s = s.replace(CODE_BEFORE, (_, d) => this.tok('CODE', d));
    s = s.replace(PHONE_US, m => this.tok('PHONE', m));
    s = s.replace(PHONE_INTL, m => this.tok('PHONE', m));
    s = s.replace(DIGITS, (m, at: number, all: string) => {
      const d = m.replace(/\D/g, '');
      if (d.length >= 13 && luhn(d)) return this.tok('CARD', m);
      if (ACCOUNT_WORD.test(all.slice(Math.max(0, at - 30), at))) return this.tok('ACCOUNT', m);
      if (d.length === 10 || (d.length === 11 && d[0] === '1')) return this.tok('PHONE', m);
      return this.tok('ACCOUNT', m);
    });
    s = s.replace(ACCOUNT_SAID, (_, kw, gap, d) => kw + gap + this.tok('ACCOUNT', d));
    for (const n of [...this.names].sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(`(?<![\\w-])${esc(n)}(?![\\w-])`, 'g'), () => this.tok('NAME', n));
    return s;
  }

  /** The model's words, with identity put back and secrets masked. Unknown tokens are left as they are. */
  restore(text: string): string {
    if (!text) return text;
    return text.replace(TOKEN, (m, kind: Kind, n: string) => {
      const v = this.values.get(`[${kind}_${n}]`);
      return v ? (SECRET.has(v.kind) ? masked(v.kind, v.value) : v.value) : m;
    });
  }
  /** One-way, for a listener we can't restore from (a voice agent): each token becomes what it stood for, in words. */
  scrub(text: string): string { return this.redact(text).replace(TOKEN, (m, kind: Kind) => SAID[kind] ?? m); }
}

/** The text as the member and employees see it after a model call: identity kept, secrets masked. */
export function maskSecrets(text: string) { const r = new Redactor(); return r.restore(r.redact(text)); }
/** Text for an external listener that can't be restored from (a voice agent's prompt, a log line). */
export function scrub(text: string) { return new Redactor().scrub(text); }

// ---- Message structure: which strings are content ----
// In a content block, these fields are structure (or base64 file data), not text the model reads as words.
const BLOCK_KEYS = new Set(['type', 'id', 'tool_use_id', 'name', 'media_type', 'data', 'cache_control']);
function walk(v: any, f: (s: string) => string): any {
  if (typeof v === 'string') return f(v);
  if (Array.isArray(v)) return v.map(x => walk(x, f));
  if (v && typeof v === 'object') {
    const block = typeof v.type === 'string';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, block && BLOCK_KEYS.has(k) ? x : walk(x, f)]));
  }
  return v;
}

export type RedactOptions = { names?: string[] };
const GUARDED = Symbol('redacted');

/**
 * Wrap a model client so every messages.create call is redacted on the way out and restored on the way back.
 * `known` lists names we already hold (members); a request can add more with the option `redact: { names }`.
 * File blocks pass unchanged, but none are sent: attachments go as text read on this server (src/media.ts).
 */
export function guard<T>(c: T, known: () => string[] = () => []): T {
  const x = c as any;
  if (!x || x[GUARDED]) return c;
  const wrap = (target: any) => async (params: any, options: any = {}) => {
    const { redact, ...rest } = (options ?? {}) as { redact?: RedactOptions };
    const r = new Redactor([...known(), ...(redact?.names ?? [])]);
    walk([params.system, params.messages], s => { r.learn(s); return s; }); // names anywhere count everywhere
    const safe = { ...params, messages: walk(params.messages, s => r.redact(s)) };
    if (params.system !== undefined) safe.system = walk(params.system, s => r.redact(s));
    const res = await target.create(safe, rest);
    return res && Array.isArray(res.content) ? { ...res, content: walk(res.content, s => r.restore(s)) } : res;
  };
  return { [GUARDED]: true, messages: { create: wrap(x.messages) }, ...(x.beta?.messages ? { beta: { messages: { create: wrap(x.beta.messages) } } } : {}) } as T;
}
