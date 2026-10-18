// Eval harness for message-level detection (issue #7): runs each detector over eval/conversations.jsonl
// and reports precision and recall, overall and per signal, with every miss and false alarm listed.
// The dataset is the answer key: detectors get only the conversation text, never the labels, and the app
// never reads it (test/leakage.test.ts).
// Run: npm run eval [-- --out eval/report.md]   Detectors that need an API key are skipped without one.
import 'dotenv/config'; // the model detectors run only when .env has ANTHROPIC_API_KEY
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ruleCheck, assess } from '../src/monitor.ts';
import { client, MODEL } from '../src/chat.ts';
import { SIGNALS, type Signal } from '../src/tactics.ts';

export const DATASET = join(import.meta.dirname, '..', 'eval', 'conversations.jsonl');
// Written before any tuning and never used to choose patterns: the honest number for changes made on the tuning set.
export const HOLDOUT = join(import.meta.dirname, '..', 'eval', 'holdout.jsonl');
const SETS = [{ name: 'Tuning set', file: 'eval/conversations.jsonl', path: DATASET }, { name: 'Held-out set', file: 'eval/holdout.jsonl', path: HOLDOUT }];
export { SIGNALS, type Signal };

export type Conversation = {
  id: string; label: 'scam' | 'legit'; channel: string; adapted_from?: string; note?: string;
  from?: string; subject?: string; turns: { role: 'contact' | 'member'; text: string }[];
  expected: { flag: boolean; signals: Signal[] };
};
/** What a detector sees: the conversation without its labels. */
export type Input = Omit<Conversation, 'label' | 'expected' | 'note' | 'adapted_from'>;
export type Output = { flag: boolean; signals: Signal[]; why: string[] };
export type Detector = { name: string; about: string; available: boolean; signals: boolean; run: (c: Input) => Promise<Output> };

export function load(path = DATASET): Conversation[] {
  return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}
const strip = ({ label: _l, expected: _e, note: _n, adapted_from: _a, ...input }: Conversation): Input => input;
const text = (c: Input) => c.turns.map(t => t.text).join('\n');


export const DETECTORS: Detector[] = [
  {
    name: 'rules', about: 'Regex tactics and look-alike domains (`ruleCheck` in src/monitor.ts), no model', available: true, signals: true,
    run: async c => {
      const r = ruleCheck(c.subject ?? '', text(c));
      const signals = [...new Set([...r.tactics.map(t => t.key), ...(r.lookalike ? ['impersonation' as Signal] : [])])];
      return { flag: r.flag, signals, why: [...r.tactics.map(t => t.label), ...r.links.filter(l => l.note && !l.note.startsWith('This is')).map(l => `${l.domain}: ${l.note}`)] };
    },
  },
  ...(['classifier', 'hybrid', 'gate'] as const).map((mode): Detector => ({
    name: mode, available: !!client, signals: true,
    about: { classifier: 'The model\'s evidence only, no rules (`assess`, DETECTION_MODE=classifier)', hybrid: 'The model sees every message; its evidence and the rules\' are merged and risk is computed from both (`assess`, DETECTION_MODE=hybrid)', gate: 'Production default: hybrid, but ordinary mail never reaches the model (`assess`, DETECTION_MODE=gate)' }[mode],
    run: async c => {
      const d = await assess(c.channel === 'call' ? 'call screening' : 'email', c.from ?? 'unknown sender', c.subject ?? '', text(c), [], { mode, strict: true });
      return { flag: !!d, signals: [...new Set((d?.signals ?? []).map(x => x.key))], why: d?.why ?? [] };
    },
  })),
];

type Counts = { tp: number; fp: number; fn: number; tn: number };
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const prf = (c: Counts) => ({ precision: pct(c.tp, c.tp + c.fp), recall: pct(c.tp, c.tp + c.fn) });

export async function evaluate(det: Detector, data: Conversation[]) {
  // A few conversations at a time (model calls take seconds each), each retried before it counts as an error.
  // An error is excluded from the numbers and listed: never silently scored as something else.
  const slots: ({ c: Conversation; out: Output } | { c: Conversation; error: string })[] = new Array(data.length);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < data.length) {
      const i = next++;
      for (let attempt = 1; ; attempt++) {
        try { slots[i] = { c: data[i], out: await det.run(strip(data[i])) }; break; }
        catch (e) {
          if (attempt === 3) { slots[i] = { c: data[i], error: (e as Error).message }; break; }
          await new Promise(r => setTimeout(r, 3000 * attempt));
        }
      }
    }
  }));
  const rows = slots.filter((x): x is { c: Conversation; out: Output } => 'out' in x);
  const errors = slots.filter((x): x is { c: Conversation; error: string } => 'error' in x);
  const flag: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const { c, out } of rows) flag[out.flag ? (c.expected.flag ? 'tp' : 'fp') : (c.expected.flag ? 'fn' : 'tn')]++;
  const perSignal = SIGNALS.map(s => {
    const k: Counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
    for (const { c, out } of rows) { const want = c.expected.signals.includes(s), got = out.signals.includes(s); k[got ? (want ? 'tp' : 'fp') : (want ? 'fn' : 'tn')]++; }
    return { signal: s, ...k };
  });
  return { det, rows, flag, perSignal, errors };
}

export function report(results: Awaited<ReturnType<typeof evaluate>>[], skipped: Detector[], n: number, set = SETS[0]) {
  const out = [`# ${set.name}`, '', `${n} authored conversations in \`${set.file}\` (${results[0]?.rows.filter(r => r.c.expected.flag).length ?? 0} scams, ${results[0]?.rows.filter(r => !r.c.expected.flag).length ?? 0} legitimate). Small and hand-written, so read the misses, not just the percentages.`, ''];
  out.push('| Detector | Precision | Recall | Caught | Missed | False alarms |', '|---|---|---|---|---|---|');
  for (const r of results) { const m = prf(r.flag); out.push(`| ${r.det.name} | ${m.precision} | ${m.recall} | ${r.flag.tp} | ${r.flag.fn} | ${r.flag.fp} |`); }
  for (const d of skipped) out.push(`| ${d.name} | not run (needs ANTHROPIC_API_KEY) | | | | |`);
  for (const r of results) {
    out.push('', `## ${set.name}: ${r.det.name}`, '', r.det.about, '');
    if (r.errors.length) out.push(`**${r.errors.length} conversation(s) not scored** (model call failed after 3 tries; left out of every number above and below): ${r.errors.map(e => `\`${e.c.id}\``).join(', ')}`, '');
    if (r.det.signals) {
      out.push('| Signal | Labeled | Precision | Recall | False positives |', '|---|---|---|---|---|');
      for (const s of r.perSignal) { const m = prf(s); out.push(`| ${s.signal} | ${s.tp + s.fn} | ${m.precision} | ${m.recall} | ${s.fp} |`); }
      out.push('');
    }
    const line = (x: (typeof r.rows)[number]) => `- \`${x.c.id}\`${x.c.adapted_from ? ` (${x.c.adapted_from})` : ''}: ${x.out.why.length ? x.out.why.join('; ') : 'nothing fired'}`;
    const missed = r.rows.filter(x => x.c.expected.flag && !x.out.flag), alarms = r.rows.filter(x => !x.c.expected.flag && x.out.flag);
    out.push(`**Missed scams (${missed.length})**`, '', ...(missed.length ? missed.map(line) : ['- none']), '', `**False alarms on legitimate messages (${alarms.length})**`, '', ...(alarms.length ? alarms.map(line) : ['- none']));
  }
  return out.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--out'), outPath = i > 0 ? process.argv[i + 1] : join(import.meta.dirname, '..', 'eval', 'report.md');
  const only = process.argv.includes('--tuning-only') ? SETS.slice(0, 1) : SETS; // keep the held-out set unseen while tuning
  const run = DETECTORS.filter(d => d.available), skipped = DETECTORS.filter(d => !d.available);
  let md = `# Detection eval\n\nGenerated by \`npm run eval\`. Conversations are authored (see eval/README.md); patterns are tuned on the tuning set only.${client ? ` Model detectors used \`${MODEL}\`.` : ''}\n\n`;
  for (const set of only) {
    const data = load(set.path), results = [];
    for (const d of run) results.push(await evaluate(d, data));
    md += report(results, skipped, data.length, set).replace(/^# /, '## ').replace(/\n## /g, '\n### ') + '\n';
  }
  writeFileSync(outPath, md);
  console.log(md);
}
