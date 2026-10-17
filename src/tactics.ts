// Pressure tactics named in the member's own words, for the employee's view of a chat the member chose to share.
// These name a request or pattern, never a verdict about a person. Only text the member typed is read.
export type Tactic = { key: string; label: string };
const RULES: { key: string; label: string; re: RegExp }[] = [
  { key: 'secrecy', label: 'Asked to keep it secret', re: /\b(secret|don.?t tell|not to tell|keep (it|this) (quiet|between)|no ?one can know|nobody can know)/i },
  { key: 'urgency', label: 'Pressure to hurry', re: /\b(right now|right away|today|tonight|immediately|hurry|urgent|asap|deadline|within (an|the|one|\d+) (hour|hours|minutes|days?)|before it.?s too late)\b/i },
  { key: 'family', label: 'Emergency involving family', re: /\b(jail|bail|arrest(ed)?|accident|hospital|lawyer|attorney|grand(son|daughter|child))\b/i },
  { key: 'authority', label: 'Someone claiming authority', re: /\b(police|irs|fbi|federal|agent|sheriff|government|social security|fraud (team|department)|from (the|my) (bank|credit union))\b/i },
  { key: 'payment', label: 'Unusual way to pay', re: /\b(gift ?cards?|crypto|bitcoin|courier|cash pick ?up|zelle me|wire it)\b/i },
  { key: 'code', label: 'Asked for a code or password', re: /\b(code|password|pin|one.?time)\b/i },
  { key: 'coached', label: 'May be coached or on the line', re: /(told me (what|to say)|on the (phone|line) with|stay on the line|said not to tell the bank|what to tell you)/i },
  { key: 'online', label: 'Someone met only online', re: /\b(met (him|her|them)? ?online|dating (app|site)|never met (in person)?)\b/i },
];
export function tacticsIn(text: string): Tactic[] {
  return RULES.filter(r => r.re.test(text)).map(({ key, label }) => ({ key, label }));
}
