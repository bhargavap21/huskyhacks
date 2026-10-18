# Signals schema (`signals/v1`)

What an alert on a connected channel (forwarded email, Gmail, a forwarded text, WhatsApp, a screened call) carries as evidence, and how its risk tier is computed. Signal names are the shared taxonomy in `src/tactics.ts`; the model's per-signal scores come from `src/classifier.ts` ([classifier-schema.md](classifier-schema.md)); `src/signals.ts` merges them with the rules and computes the tier; `assess()` in `src/monitor.ts` puts it together. How this feeds detection is decided in [DECISIONS.md, ADR 10](../DECISIONS.md).

## Shape

Each detection carries:

```jsonc
{
  "signals_version": "signals/v1",
  "risk": "high" | "medium" | "low",          // computed from the signals below, never from the model
  "signals": [
    {
      "key": "secrecy",                         // one of the keys below; at most one signal per key
      "label": "Asked to keep it secret",       // fixed text for the key
      "score": 0.95,                            // 0-1: how clearly the message shows this sign
      "span": "Please do NOT tell mom or dad",  // words copied from the message, verified to be in it
      "source": "model" | "rules"
    }
  ],
  "other": ["sound-cu-secure.example: Uses Sound’s name, but it isn’t soundcu.com."]  // deterministic checks
}
```

Keys and labels: `SIGNALS` and `SIGNAL_LABELS` in `src/tactics.ts` (urgency, secrecy, impersonation, threats, coaching, payment_pressure, credential_request, remote_access, online_relationship). What each covers: `SIGNAL_HELP` in `src/classifier.ts`.

## Rules every signal follows

- **No bare scores.** A signal is kept only if its `span` is found in the message: case, curly quotes and whitespace are forgiven, paraphrase is not. Model signals that fail this check are dropped and counted in the log. The UI always shows the score next to its quote, as a word ("Clear" from 0.7, "Likely" from 0.5, "Faint" below 0.5) and a number.
- **Faint signals.** The classifier keeps signals scored 0.5 or more as evidence that can alert, and 0.3-0.5 (with a real quote) as faint evidence that only ever makes a low alert.
- **Rules fill gaps, the model reads context.** Rule-based tactics (`src/tactics.ts`) produce signals with fixed scores: 0.7 for specific asks (secrecy, coaching, payment, code, remote access) and 0.4 for wording that's common in ordinary mail (urgency, impersonation, threats, online relationship), which alone makes only a low alert. If the model reports the same key, its signal replaces the rule's.
- **Prompt injection is evidence, not an instruction.** If the message contains instructions aimed at an AI, the model quotes them; once verified, the quote is listed under `other` and counts as a deterministic check.

## Risk tiers

| Tier | When | What the member gets |
|---|---|---|
| high | two clear signals (0.7 or more); or a clear code, payment or remote-access ask plus another sign at 0.5 or more; or a deterministic check (look-alike link, failed sender authentication, verified injection) plus a sign at 0.5 or more | push, else email; "Worth a look now" |
| medium | one sign at 0.5 or more, or a deterministic check alone | push, else email; "Worth a look" |
| low | only faint signs | shown in the app only, never pushed or emailed; "Low concern" |
| (none) | no evidence, or the model calls it ordinary and nothing specific was found | nothing kept |

The model can discard a message that only has generic wording ("today", "your bank"). It can't discard specific evidence (a look-alike link, failed authentication, a rule-matched code, payment or remote-access ask); in that case the alert stays, capped at medium.

## Calibration

`npm run calibrate` runs the 8 labeled fixtures in `fixtures/emails.json` through `assess()` with Claude; `npm run calibrate -- --rules` runs the rules alone, for free. The pass bar is no safety-relevant miss: every scam fixture alerts, and no benign fixture interrupts the member. `test/signals.test.ts` runs the rules-only check on every `npm test`. For precision and recall per signal on a larger labeled set, see `npm run eval` (eval/README.md).

Results on 2026-10-18 (after merging the shared taxonomy and classifier):

| Fixture | Expected | Claude + rules | Rules only |
|---|---|---|---|
| fx01 grandchild emergency | alert | high | high |
| fx02 fake Sound security | alert | high | high |
| fx03 government impersonation | alert | high | high |
| fx04 real grandchild request | no interruption | none | none |
| fx05 landlord after a move | no interruption | none | none |
| fx06 real statement notice | no interruption | none | none |
| fx07 vague investment pitch | low or medium | none (the classifier calls it ordinary) | none (rules can't read a vague pitch) |
| fx08 prize + prompt injection | alert, quote the injection | high, injection quoted | high |

Eight fixtures are a smoke test, not a validation. The thresholds are proposed values, like the R1-R4 thresholds, until they're measured on real, consented, redacted traffic (Milestone 4).

## Versioning

Adding a key, or changing a score rule or tier rule, means a new version (`signals/v2`), a new row in this file, and a fresh calibration run. Stored detections keep the `signals_version` they were made with.
