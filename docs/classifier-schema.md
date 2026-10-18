# Classifier output schema (version 1)

`src/classifier.ts` asks Claude to score an incoming message (email, forwarded text, screened call) and returns a `Classification`. The model fills a forced tool call; `validate()` then checks every signal against the message before anything reaches a member or employee.

## Signals

| Signal | What it means |
|---|---|
| `urgency` | Pressure to act fast: deadlines, "right now", "within the hour" |
| `secrecy` | Pressure to hide it from family, the bank or anyone else |
| `impersonation` | Claims to be someone the member trusts: a relative, the credit union, the government, a company |
| `threats` | Threats or fear: arrest, a closed or frozen account, harm to someone |
| `coaching` | The member is told what to say or do, or to stay on the line |
| `payment_pressure` | Pressure to pay in an unusual way: gift cards, crypto, cash for a courier, a "safe account", fees to release money, returning an overpayment |
| `credential_request` | Asks for a code, password, PIN or identity number |
| `remote_access` | Asks to install software or control the member's screen |
| `online_relationship` | Money involving someone the member knows only online |

These are the same keys the rules use (`src/tactics.ts`) and the eval labels, so all three can be compared signal by signal.

## What the model returns (tool input)

```json
{
  "signals": { "<signal>": { "score": 0.0, "quote": "up to 12 words copied from the message" }, "...": {} },
  "alert": true,
  "risk": "low | medium | high",
  "title": "push line, under 90 characters, no verdict",
  "summary": "one or two sentences for the member",
  "advice": "one sentence: what to do"
}
```

Every signal must be present with a `score` from 0 to 1 and a `quote`.

## What callers get (`Classification`)

```ts
{
  version: 1, model: string,
  alert: boolean, risk: 'low' | 'medium' | 'high',
  signals: { signal, label, score, quote }[],   // only signals that passed validation
  title, summary, advice,
  dropped: { signal, reason }[]                 // for debugging and the eval; never shown
}
```

## Validation rules

- A signal counts only if `score >= 0.5` (`SIGNAL_THRESHOLD`).
- Its `quote` must appear in the message (case, whitespace and curly quotes ignored). Otherwise the signal is dropped as `quote not in message`, or as `no quote` when empty. No bare scores and no invented evidence.
- `alert` is true only if the model said so **and** at least one signal survived.
- An unknown `risk` becomes `medium`.

## How it is used

`assess()` in `src/monitor.ts` runs in one of three modes, set by `DETECTION_MODE`:

- `gate` (default): the rules run first; mail with no tactic, look-alike link or money word never reaches the model. Otherwise the classifier decides.
- `rules`: rules only.
- `classifier`: the classifier sees every message.

Without an API key, or if the call fails, every mode falls back to the rules, whose evidence is also quoted (the phrase each rule matched). Either way a detection carries `signals` (per-signal evidence) and `why` lines such as `Asked for a code or password: “read me the code”`, which the member's alert card and the fraud case show.

How classifier output may feed payment decisions is decided in the ADR for issue #8; until then it only informs alerts and cases.

## Changing the schema

Bump `SCHEMA_VERSION`, update this file, and run `npm run eval` with an API key to compare against the previous version.
