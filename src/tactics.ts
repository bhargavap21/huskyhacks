// The one list of pressure tactics, shared by shared chats, the email inbox, connected channels, the call
// guardian and the eval (issue #4). Keys are the signal names the detection eval labels. A tactic names a request or
// a pattern, never a verdict about a person.
// Rules look for a request or a claim, not a bare keyword: "code" alone is ordinary mail, "read me the code"
// is not (issue #5). A match right after a negation in the same clause ("we will never ask for your PIN",
// "don't share it") doesn't count.
export const SIGNALS = ['urgency', 'secrecy', 'impersonation', 'threats', 'coaching', 'payment_pressure', 'credential_request', 'remote_access', 'online_relationship'] as const;
export type Signal = typeof SIGNALS[number];
/** `quote` is the phrase that matched: the evidence a member or employee can read. */
export type Tactic = { key: Signal; label: string; quote: string };
// One plain label per signal, for evidence that isn't from a specific rule (e.g. the classifier).
export const SIGNAL_LABELS: Record<Signal, string> = {
  urgency: 'Pressure to hurry', secrecy: 'Asked to keep it secret', impersonation: 'Claims to be someone you trust', threats: 'Threats or fear',
  coaching: 'May be coached or on the line', payment_pressure: 'Unusual way to pay', credential_request: 'Asked for a code or password',
  remote_access: 'Asked for remote access', online_relationship: 'Someone met only online',
};

// Who scammers claim to be. Shared with the call guardian.
export const ORGS = String.raw`bank|credit union|sound|fraud (?:department|team|unit)|security (?:team|department)|irs|fbi|federal|sheriff|police|social security|medicare|government|microsoft|apple|amazon|geek squad|tech(?:nical)? support|usps|ups|fedex|(?:\w+ )?energy|utility`;
const RELATIVE = String.raw`grand(?:son|daughter|child|kid)|son|daughter|nephew|niece`;
const PAY_METHOD = String.raw`gift ?cards?|(?:apple|google play|target|steam|amazon|itunes) cards?|bitcoin(?: atm)?|btc|crypto|usdt|prepaid (?:debit )?card|cash app|zelle|venmo|courier`;
const CREDENTIAL = String.raw`code|passcode|password|pin|one[- ]time|otp|login|social security number|ssn|full number|medicare number|account number|date of birth`;
const re = (s: string) => new RegExp(s, 'gi');

// A money context, for tactics that only matter once money comes into it.
const MONEY = /\$\s?\d|\b(wire|bail|money|cash|payment|pay|send|transfer|zelle|venmo|gift ?cards?|bitcoin|crypto|usdt|withdraw\w*|deposit|fee|loan)\b/i;

type Rule = { key: Signal; label: string; re: RegExp; needs?: RegExp; unless?: RegExp };
// First matching rule per signal names it, so order the more specific label first.
const RULES: Rule[] = [
  { key: 'secrecy', label: 'Asked to keep it secret', re: re(String.raw`\b(?:don'?t|do not|never)\s+(?:tell|call|discuss (?:this|it) with|talk to|mention (?:this|it) to)\b[^.!?]{0,40}\b(?:anyone|anybody|bank|branch|teller|staff|family|mom|mum|dad|parents|children|kids|police|wife|husband)\b|\b(?:can'?t|cannot|mustn'?t)\s+tell (?:anyone|anybody)\b|\b(?:told|said)\b[^.!?]{0,20}\bnot to tell\b|\bkeep (?:this|it) (?:confidential|between us)\b|\b(?:confidential|sealed|secret) (?:investigation|matter|case)\b|\bkeep this matter confidential\b|\bgag order\b|\bno ?one can know\b|\b(?:i'?ve )?told no ?one about us\b|\bso the bank doesn'?t flag\b`) },
  { key: 'secrecy', label: 'Asked to keep it secret', re: re(String.raw`\bkeep (?:this|it) (?:quiet|secret)\b`), needs: MONEY },
  { key: 'urgency', label: 'Pressure to hurry', re: re(String.raw`\b(?:right now|right away|immediately|asap|hurry|act now|last chance)\b|\bwithin (?:the|an|one|\d+) (?:hour|hours|minutes)\b|\bin the next (?:hour|\d+ (?:hours|minutes))\b|\bbefore (?:it'?s too late|\d{1,2}(?::\d\d)? ?(?:am|pm))\b|\b(?:today|tonight) (?:or|before)\b|\bon the way to\b|\b(?:need|must|have to|has to|needs to)\b[^.!?]{0,40}\b(?:today|tonight|now)\b|\b(?:go|call|pay|send|do it|transfer|wire|buy)\b[^.!?]{0,30}\bnow\b|\burgent(?:ly)? (?:need|help|payment|action)\b|\bcloses at midnight\b|\bbefore (?:they|the hackers|someone) (?:take|get)\b`) },
  { key: 'impersonation', label: 'Claims to be family in trouble', re: re(String.raw`\bit'?s me\b[^.!?]{0,60}\b(?:phone|number)\b|\b(?:lost|broke|dropped)\b[^.!?]{0,20}\bphone\b|\bnew number\b|\byour (?:${RELATIVE})'?s (?:friend|attorney|lawyer)\b|\b(?:attorney|lawyer)\b[^.!?]{0,30}\byour (?:${RELATIVE})\b`) },
  { key: 'impersonation', label: 'Claims to be a bank, agency or company', re: re(String.raw`\b(?:this is|i'?m|i am|calling from|on behalf of|from (?:the|your)|with the)\b[^.!?]{0,30}\b(?:${ORGS})\b|\b(?:someone|a (?:man|woman|guy|lady|caller|person)|the (?:man|woman|guy|lady|caller|person)|he|she|they)\b[^.!?]{0,15}\b(?:from|claiming to be|says (?:he|she|they)'?s? from|said (?:he|she|they) (?:was|were|is|are)(?: from)?)\b[^.!?]{0,25}\b(?:${ORGS})\b|\b(?:a|an)\s+(?:federal|government|irs|fbi|police|bank) (?:agent|officer|official|examiner)\b`) },
  { key: 'threats', label: 'Threats or fear', re: re(String.raw`\b(?:warrant|arrest(?:ed)?|custody|deport(?:ed|ation)?|lawsuit|legal action|deputies|in jail|stay in jail|never see (?:her|him|them) again|shut (?:off|down) your)\b|\b(?:account|card|number|power|service|banking)\b[^.!?]{0,30}\b(?:suspended|frozen|locked|closed|shut off|disconnected|compromised|hacked|exposed)\b|\b(?:will be|been) (?:suspended|frozen|locked|closed|shut off|disconnected|permanently closed|issued|sent to your home)\b|\b(?:your|the) (?:account|computer|bank details|identity|savings)\b[^.!?]{0,20}\b(?:compromised|hacked|exposed|stolen)\b|\b(?:frozen|locked) (?:out|account)\b`) },
  { key: 'coaching', label: 'May be coached or on the line', re: re(String.raw`\b(?:told|tells|telling) me (?:what|exactly what) to (?:say|type|do|tell)\b|\bwhat to (?:say|tell)\b|\bif (?:they|the teller|the bank|anyone|you) asks?\b[^.!?]{0,40}\b(?:say|tell)\b|\bshould (?:say|tell)\b[^.!?]{0,30}\bit'?s for\b|\bstay on (?:the|this) (?:line|phone)\b|\bkeep (?:my|your|the) phone on\b|\bon the other line\b|\bwalk you through\b|\bdon'?t hang up\b|\b(?:told|instructed) me to (?:take out|withdraw|send|wire|move|buy|transfer|keep)\b|\bhand it to our courier\b`) },
  { key: 'payment_pressure', label: 'Unusual way to pay', re: re(String.raw`\b(?:pay|paid|paying|payment|send|sending|buy|buying|wire|transfer|deposit|move|get|withdraw|hand|donate|fee|fine)\b[^.!?]{0,50}\b(?:${PAY_METHOD})\b|\$[\d,.]+[^.!?]{0,25}\b(?:by|via|through|with|in|using) (?:${PAY_METHOD})\b|\b(?:safe|secure|protected)(?: \w+)? account\b|\bthe new account (?:he|she|they) gave\b|\bmove (?:your|the|them|my) (?:money|savings|funds)?\b[^.!?]{0,20}\baccount\b|\b(?:processing|release|customs|legal|transfer|withdrawal|service|unlock) fee\b|\bpay (?:a|the) [^.!?]{0,20}\b(?:tax|fee)\b[^.!?]{0,20}\bbefore\b|\bsend (?:the|back the) (?:extra|difference|remaining|rest)\b|\b(?:extra|difference)\b[^.!?]{0,20}\bback\b|\bi'?ll pay you back\b|\bwill pay you back\b|\bwire \$|\bwire[ds]?\b[^.!?]{0,30}\b(?:\d[\d,]*|a few|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|grand)\b|\b(?:\d[\d,]*|hundred|thousand|grand) (?:dollars )?wired\b|\bdeposit [\d,.]+ usdt\b|\b(?:cash|money)\b[^.!?]{0,60}\b(?:collect|pick (?:it )?up|safekeeping)\b|\b(?:take out|withdraw)\b[^.!?]{0,20}\$[\d,.]+\b[^.!?]{0,20}\bcash\b`) },
  { key: 'credential_request', label: 'Asked for a code or password', re: re(String.raw`\b(?:read|send|give|tell|share|forward|confirm|verify|provide|need|have|wants?|reply with|respond with|asked (?:me |you )?for|asking (?:me |you )?for|what(?:'s| is) (?:the|your))\b[^.!?]{0,40}\b(?:${CREDENTIAL})\b|\b(?:${CREDENTIAL})\b[^.!?]{0,60}(?:[.!?]\s+[^.!?]{0,30})?\b(?:read it|send it|give it|forward it|tell me|back to me)\b`) },
  // "Enter/type the code" is how real sign-in messages deliver a code; it's a request only when the code isn't in the message.
  { key: 'credential_request', label: 'Asked for a code or password', re: re(String.raw`\b(?:enter|submit|type)\b[^.!?]{0,40}\b(?:${CREDENTIAL})\b`), unless: /\b(?:code|passcode|pin)\b[^.!?\d]{0,25}\d{4,8}\b/i },
  { key: 'remote_access', label: 'Asked for remote access', re: re(String.raw`\b(?:any ?desk|team ?viewer|remote access|screen ?shar\w*|see your screen|see my screen|control (?:of )?your (?:computer|screen)|take control|connect to your computer|download (?:this|an|the) app|install (?:an|this|the) app)\b`) },
  { key: 'online_relationship', label: 'Someone met only online', re: re(String.raw`\bmet (?:him|her|them)? ?(?:online|on (?:a |an )?(?:dating|instagram|facebook|tinder|hinge|whatsapp|game)\w*)\b|\bdating (?:app|site)\b|\bnever met (?:in person)?\b|\bmy (?:love|darling)\b`), needs: MONEY },
];

// A negation just before a match, in the same clause, cancels it.
const NEGATED = /\b(?:never|not|don'?t|doesn'?t|won'?t|will not|do not|didn'?t|no need to)\b(?:\W+\w+){0,3}\W*$/i;
const CLAUSE = /[.!?\n,;]|\b(?:and|but|so)\b/i;

export function tacticsIn(text: string): Tactic[] {
  const out: Tactic[] = [];
  for (const r of RULES) {
    if (out.some(t => t.key === r.key) || (r.needs && !r.needs.test(text)) || r.unless?.test(text)) continue;
    for (const m of text.matchAll(r.re)) {
      const before = text.slice(Math.max(0, m.index - 60), m.index).split(CLAUSE).pop() ?? '';
      if (/^(?:don'?t|do not|never)\b/i.test(m[0]) || !NEGATED.test(before)) { out.push({ key: r.key, label: r.label, quote: m[0].trim().slice(0, 80) }); break; }
    }
  }
  return out;
}
