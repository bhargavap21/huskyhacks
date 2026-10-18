# Decisions

HANDOFF.md (Sound-embedded version) replaced the email-first handoff on 2026-10-17. Rows marked SUPERSEDED no longer apply.

| # | Date | Decision | Why |
|---|---|---|---|
| 1 | 2026-10-17 | **Email module only:** watched inbox `bhargava.perumalla1@gmail.com` (owner's choice). | Team-owned account; owner's call. |
| 2 | 2026-10-17 | **Email module only:** sender allowlist on ingest (`INGEST_SENDER_ALLOWLIST`). Each new message is fetched as `format=metadata` first. If From is not allowlisted, it is dropped: no body fetch, no storage, no LLM call. Only a count is kept. | The watched inbox may receive real third-party mail. Keeps the "synthetic / team-owned only" claim true. |
| 3 | 2026-10-17 | **Email module only:** sender account `bhargavap740@gmail.com`, the only allowlist entry. SendGrid (owner's account) may send fixtures from this verified address only; no spoofed senders. | Hand-sent and scripted fixtures. |
| 4 | 2026-10-17 | ~~Two layers: email layer + payment-moment layer~~ **SUPERSEDED** by HANDOFF.md: Sound-embedded Second Look with kit-signal rules R1-R4 as the primary trigger. | Product direction change. |
| 5 | 2026-10-17 | ~~Cloudflare Tunnel for iOS Web Push~~ **SUPERSEDED**: the core demo needs no push. Any HTTPS host works for the prototype link; the tunnel is needed only for the email module. | Push is T2 transport for the optional module only. |
| 6 | 2026-10-17 | Kit files live in `data/`. Screens in plain HTML/JS served by Hono, no React/Vite (deviates from HANDOFF section 3). | Time; fewer build steps. |
| 8 | 2026-10-17 | Approved by owner: R2 on P2P waits at pre-submit (never Held); R4 keeps `event_note` limits topic, disclosed as employee-recorded and "partly" observable; R3 includes External Transfer; missed-scam beat (M1102); chat falls back to labeled offline replies; plain HTML/JS. | PLAN.md section 3. |
| 9 | 2026-10-17 | Scene state (payments, cases) lives in memory and is rebuilt from the kit file on each scene load; audit log and chat persist in SQLite. Hold clock runs at 60x while a payment waits on people (4 h = 4 real minutes). | Demo resets cleanly between scenes; fast enough to show a full hold. |
| 12 | 2026-10-17 | Fresh checkouts run on a committed synthetic stand-in (`fixtures/synthetic-kit/`, from `scripts/synthetic-kit.ts`) when `data/` is absent; the official kit files are never committed. Anchor members reproduce only kit facts already public in this repo; everything else is invented. | The kit is not for public release and the repo is public (issue #18). |
| 11 | 2026-10-17 | Deleted `src/email/schema.ts` (never imported) rather than promoting it, and dropped the unused `googleapis` dependency. It was the email-first design superseded by #4: its own database file, per-account Gmail tokens and a second `audit_log`. The built channels keep their tables in `src/db.ts`; the unified message and case model (issue #2) is designed from those, not from this file. | Issue #20: one database and one audit log, no dead code. |
| 7 | 2026-10-17 | Fixtures: use the `fixtures/emails.json` from `second-look-handoff.zip` (the version HANDOFF references). Mine is replaced. | HANDOFF wins on conflicts. |
| 10 | 2026-10-17 | **Classifier output is advisory alerting, never payment detection.** See ADR 10 below. | Issue #8. |

## Rule catch counts (HANDOFF section 9 rules as written; Member Key used for measurement only)

| Rule | Scam members caught | Look-alikes caught | Routine |
|---|---|---|---|
| R1 | 10/12 family emergency + 4 government impersonation | 4 (M1057, M1067, M1075, M1104: home-closing wires; expected, fast-release path) | 0 |
| R2 | 12/12 ATO + 2 family emergency | 4 (M1039, M1041, M1051, M1114: real reset + move) | 0 |
| R3 (with External Transfer, DECISIONS #8) | 7/12 romance | 0 | 0 |
| R4 (with `event_note` "limits") | 7/12 government impersonation | 0 | 0 |

Not caught by any rule (after #8): M1009, M1029, M1052, M1056, M1088 (romance), M1035 (family emergency), M1102 (government impersonation). Demo's missed-scam beat: M1102.


## ADR 10: How classifier output feeds detection (issue #8)

**Status:** accepted, 2026-10-17.

**Context.** Second Look has two detection paths. (1) Payment-moment rules R1-R4 read the credit union's own records and drive the payment state machine (hold, pre-submit review, banner). The product promise is that this path is rules, not AI. (2) Connected channels (forwarded email, Gmail, forwarded texts, WhatsApp, screened calls) use a model to read messages and alert the member. Before this ADR, the model returned free-text reasons and a risk of only "high" or "medium", and the rules fallback forced everything to "high".

**Decision.**

1. **Payments: advisory only.** No classifier output (signals, risk, model verdicts) can change a payment's state, hold or release a payment, or feed R1-R4. Classifier output may enrich what people see: the member's alerts and chat, and the employee's case and callback queue. `src/payments.ts`, `src/rules.ts` and `src/sim.ts` must not import `monitor`, `signals`, `gmail` or `whatsapp`; `test/signals.test.ts` enforces this. Changing this needs a new ADR, with the evidence requirement below and a measured false-positive rate.
2. **Connected channels: a detection input under the evidence rule.** On the member's own channels, classifier signals decide whether to alert and how loudly, but only as span-verified evidence (`signals/v1`, docs/signals.md). Every signal carries a 0-1 score and a quote that must be found in the message; signals without one are dropped. No alert is kept without at least one verified signal or deterministic check.
3. **Risk is computed, not asserted.** The model no longer returns a risk level. `tier()` in `src/signals.ts` computes high, medium or low from the verified signals and the deterministic checks (look-alike links, failed sender authentication, a quoted prompt injection). The rules-only path goes through the same function, so it no longer forces "high".
4. **Low tier.** "Low" alerts (faint signs only) are shown in the app and never pushed or emailed. Interruptions are reserved for medium and high.
5. **Limits on the model's veto.** The model may discard a message that only has generic wording. It can't discard specific deterministic evidence (a look-alike link, failed authentication, a rule-matched code or payment ask); in that case the alert stays, capped at medium.

**Calibration.** Against the 8 labeled fixtures: with Claude, all 4 scams are high, all 3 benign messages are dropped, and the vague pitch is medium. With rules only, the same, except the vague pitch is dropped. Details in docs/signals.md. The thresholds are proposed, not validated, like R1-R4's.

**Consequences.** Members and employees see per-signal evidence instead of free text. A model mistake can at worst cause or miss an alert on a channel the member connected; it can't move or stop money. Real-traffic calibration waits on PII redaction (Milestone 4, issue #11).
