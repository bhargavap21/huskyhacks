# Rules vs classifier vs hybrid (issue #10)

Measured 2026-10-18 with `npm run eval` on the 80 authored conversations in `eval/` (60 tuning, 20 held out), model `claude-sonnet-4-6`. Every model call succeeded; none were left out. Full numbers, misses and false alarms: [eval/report.md](../eval/report.md).

## Should it alert?

| Detector | Held-out precision | Held-out recall | Tuning precision | Tuning recall |
|---|---|---|---|---|
| `rules` | 100% | 90% | 97% | 100% |
| `classifier` (model only) | 100% | 100% | 94% | 100% |
| `hybrid` (model on every message + rules) | 100% | 100% | 97% | 100% |
| `gate` (default: hybrid, ordinary mail skips the model) | 100% | 100% | 97% | 100% |

- **The model adds recall where the rules have no pattern.** The one held-out scam the rules miss (`h-s09`, "updated wire instructions" for a home closing) is caught by every model mode, with no added false alarms on held-out data.
- **`gate` loses nothing to `hybrid` here.** Every scam in the set has a tactic, a look-alike link or a money word, so the pre-filter never discarded one. There is no measured reason yet to make `hybrid` the default, and it would send every opted-in message to the model before PII redaction (#11). The default stays `gate` (DECISIONS #13).
- **Model false alarms:** a genuine "Sound Fraud Alert: Did you attempt a $45.20 purchase?" text (`l24`, all model modes, read as impersonation), and the legitimate grandchild request (`l13`, M1037-style; classifier only, hybrid's merged evidence kept it quiet). The rules' only false alarm is a birthday dinner kept "quiet" (`l20`).

## Which signals?

The model decides *whether* to alert well, but over-attaches signals. Signal precision on the held-out set (tuning set in brackets):

| Signal | rules | classifier | hybrid |
|---|---|---|---|
| coaching | n/a (0 found) | 11% (36%) | 11% (32%) |
| threats | 100% (91%) | 38% (65%) | 38% (58%) |
| online_relationship | 100% (100%) | 50% (33%) | 50% (38%) |
| urgency | 100% (100%) | 75% (73%) | 75% (70%) |
| impersonation | 100% (100%) | 75% (90%) | 75% (90%) |
| payment_pressure | 100% (100%) | 71% (100%) | 71% (100%) |

The rules' signal recall is lower (urgency and impersonation 50% held out), so neither source is right on its own. The biggest problem is the model's **coaching** label: it tags any instruction ("read me the code") as coaching, while the label means the member is being told what to say to others or to stay on the line. Because these labels appear on the member's alert card and the employee's case, the next step is to tighten the coaching and threats descriptions in `src/classifier.ts` and rerun.

## Limits

80 conversations written by one author; patterns were tuned on 60 of them. Use these numbers to compare detectors and catch regressions, not as an accuracy claim. A real comparison needs redacted, consented reports (after #11).

## Rerun

Put `ANTHROPIC_API_KEY` in `.env` and run `npm run eval` (about 30 minutes, three calls at a time). A failed model call is retried, then reported as not scored; it is never counted as a rules result.
