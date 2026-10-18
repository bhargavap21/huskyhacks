// Pressure tactics named in the member's own words, for the employee's view of a chat the member chose to share.
// These name a request or pattern, never a verdict about a person. Only text the member typed is read.
export type Tactic = { key: string; label: string };
const RULES: { key: string; label: string; re: RegExp; test?: (t: string) => boolean }[] = [
  { key: 'secrecy', label: 'Asked to keep it secret', re: /\b(secret|don.?t tell|do not tell|not to tell|keep (it|this) (quiet|between)|no ?one can know|nobody can know)/i },
  { key: 'urgency', label: 'Pressure to hurry', re: /\b(right now|right away|today|tonight|immediately|hurry|urgent|asap|deadline|(within|in) (an|the|one|\d+) (hour|hours|minutes|days?)|before it.?s too late)\b/i },
  { key: 'family', label: 'Emergency involving family', re: /\b(jail|bail|arrest(ed)?|accident|hospital|lawyer|attorney|grand(son|daughter|child))\b/i },
  { key: 'authority', label: 'Someone claiming authority', re: /\b(police|irs|fbi|federal|agent|sheriff|government|social security|fraud (team|department)|from (the|my) (bank|credit union))\b/i },
  { key: 'payment', label: 'Unusual way to pay', re: /\b(gift ?cards?|crypto|bitcoin|courier|cash pick ?up|zelle me|wire (it|the money|funds|\$))\b/i },
  { key: 'code', label: 'Asked for a code or password', re: /$^/, test: asksForCode },
  { key: 'coached', label: 'May be coached or on the line', re: /(told me (what|to say)|on the (phone|line) with|stay on the line|said not to tell the bank|what to tell you)/i },
  { key: 'online', label: 'Someone met only online', re: /\b(met (him|her|them)? ?online|dating (app|site)|never met (in person)?)\b/i },
];
export function tacticsIn(text: string): Tactic[] {
  return RULES.filter(r => (r.test ? r.test(text) : r.re.test(text))).map(({ key, label }) => ({ key, label }));
}

// "Code" alone is everywhere (login codes the member asked for, promo and tracking codes), so this only
// fires when someone wants the code handed over: "read me the code", "they asked for my PIN",
// "have your one-time code ready", or "we sent a code. Can you read it to me?" across a sentence break.
// Warnings like "don't share this code with anyone" never count.
const SECRET = /\b(code|passcode|password|pin|one.?time (code|passcode|password))\b/i;
const HAND_OVER = /\b(read|give|gave|giving|tell|told|share|shared|sharing|provide|say|reply with|send (it|them|that|the code) (back|to)|asked( me| you)? for|asking( me| you)? for|wants?|wanted|need|have (it|your|the)[^.!?]{0,30}ready|what('?s| is) (the|your))\b/i;
const HAND_OVER_IT = /\b(read|give|tell|share|say|send)\b[^.!?]{0,15}\b(it|that|them|those|the numbers?)\b/i;
const NEVER = /\b(don.?t|do not|never|nobody|no one|won.?t|will not)\b[^.!?]{0,40}\b(share|give|tell|read|send|ask)/i;
const PROMO = /\b(promo|coupon|discount|tracking|zip|postal|area|source|qr|country|dress) code\b|\bcode [A-Z0-9]{4,}\b/;
export function asksForCode(text: string): boolean {
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  return sentences.some((s, i) => {
    if (!SECRET.test(s) || PROMO.test(s) || NEVER.test(s)) return false;
    if (HAND_OVER.test(s)) return true;
    const next = sentences[i + 1] ?? '';
    return HAND_OVER_IT.test(next) && !NEVER.test(next);
  });
}

// The words that matched each tactic, so a flag always comes with its evidence: the sentence (clipped to
// ~160 characters around the match) where the rule fired.
export type TacticSpan = Tactic & { span: string };
const clip = (s: string, at: number) => {
  s = s.trim();
  if (s.length <= 160) return s;
  const from = Math.max(0, Math.min(at - 60, s.length - 160));
  return s.slice(from, from + 160).trim();
};
export function tacticSpans(text: string): TacticSpan[] {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim());
  const out: TacticSpan[] = [];
  for (const r of RULES) {
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (r.test) {
        if (!SECRET.test(s) || !asksForCode(`${s} ${sentences[i + 1] ?? ''}`)) continue;
        out.push({ key: r.key, label: r.label, span: clip(s, s.search(SECRET)) });
      } else {
        const m = r.re.exec(s);
        if (!m) continue;
        out.push({ key: r.key, label: r.label, span: clip(s, m.index) });
      }
      break;
    }
  }
  return out;
}
