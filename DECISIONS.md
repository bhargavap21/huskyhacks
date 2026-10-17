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
| 7 | 2026-10-17 | Fixtures: use the `fixtures/emails.json` from `second-look-handoff.zip` (the version HANDOFF references). Mine is replaced. | HANDOFF wins on conflicts. |

## Rule catch counts (HANDOFF section 9 rules as written; Member Key used for measurement only)

| Rule | Scam members caught | Look-alikes caught | Routine |
|---|---|---|---|
| R1 | 10/12 family emergency + 4 government impersonation | 4 (M1057, M1067, M1075, M1104: home-closing wires; expected, fast-release path) | 0 |
| R2 | 12/12 ATO + 2 family emergency | 4 (M1039, M1041, M1051, M1114: real reset + move) | 0 |
| R3 | 4/12 romance | 0 | 0 |
| R4 (with `event_note` "limits") | 7/12 government impersonation | 0 | 0 |

Not caught by any rule: M1009, M1023, M1029, M1036, M1052, M1056, M1061, M1088 (romance), M1035 (family emergency), M1102 (government impersonation).

## Open, needs owner call (see PLAN.md section 3)
- R2 on P2P: pre-submit hold, not Held.
- R4 reading `event_note`: option A (keep, disclosed) vs B.
- R3: add External Transfer.
- Missed-scam demo beat.
- Chat offline fallback.
