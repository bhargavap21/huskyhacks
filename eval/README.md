# Detection eval

`conversations.jsonl` is a labeled test set for message-level detection: texts, emails, calls and chats a member might bring to Second Look. `npm run eval` runs every detector over it and writes `report.md` (precision, recall, per-signal breakdown, every miss and false alarm). CI runs it on every pull request and puts the report on the run's summary page.

The set is the answer key. Detectors get only the conversation text, never the labels, and a test fails if anything in `src/` or `public/` references this folder.

## Format

One conversation per line:

```json
{"id": "s05", "label": "scam", "channel": "chat", "adapted_from": "M1102 (...)",
 "from": "optional sender", "subject": "optional subject",
 "turns": [{"role": "contact" | "member", "text": "..."}],
 "expected": {"flag": true, "signals": ["impersonation", "coaching"]},
 "note": "optional, why this case is here"}
```

- `label` is `scam` or `legit`; `expected.flag` must match it.
- `channel` is `sms`, `email`, `call`, `chat` (the member's own words to Second Look) or `whatsapp`.
- `adapted_from` marks conversations written to resemble a kit member. The kit has payment events only, no message text, so every conversation here is authored.

## Labeling signals

Signals: `urgency`, `secrecy`, `impersonation`, `threats`, `coaching`, `payment_pressure`, `credential_request`, `remote_access`, `online_relationship`.

Label a signal only when it is used as **pressure on the member** (to pay, share, act fast, or hide something). A surprise party's "keep it a secret" is not secrecy; a login code the member asked for is not a credential request; a sale that "ends today" is not urgency. That keeps the per-signal numbers about manipulation, not keywords.

## Limits

Sixty hand-written conversations by one author. Use the numbers to compare detectors and catch regressions, not as an accuracy claim. Add hard cases from real (redacted, consented) reports as they come in.
