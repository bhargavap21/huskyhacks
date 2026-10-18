# Second Look (Sound-embedded) - Implementation Plan

**Source of truth: [HANDOFF.md](HANDOFF.md).** This plan sequences it, records what we measured on the kit data, and lists the conflicts in it that need a call. Where this file and HANDOFF.md disagree, HANDOFF.md wins unless an item below is marked **DECIDED** in DECISIONS.md.

Concept in one line: Second Look is a setting members turn on inside a **simulated Sound app**. Kit transaction signals (rules R1-R4) start a case, and a **Sound employee console** can hold, talk, escalate, or stop (ATO only) before money moves. Email is an optional, member-consented extra signal (HANDOFF section 10, cut first).

---

## 1. Current state (Saturday Oct 17, about 1:20 PM)

| Item | State | Plan |
|---|---|---|
| `data/` kit files, git repo | Present | Keep |
| `package.json`, deps (hono, better-sqlite3, @anthropic-ai/sdk, web-push, googleapis), `tsconfig.json` | Present | Keep. web-push and googleapis are only for the optional email module |
| `src/db.ts` | Email-first schema (accounts, devices, messages, processed_messages...) | **Refactor:** core schema per HANDOFF section 12 in `src/db.ts`; move the email tables to `src/email/schema.ts`, behind a flag |
| `scripts/payment_trigger.py` + `public/trigger_results.json` | Old single-rule trigger | **Replace** with `src/rules.ts` (R1-R4) and `npm run lookalikes`; delete both once parity is shown |
| `fixtures/emails.json` | My Phase 0 version | **Replace** with the version from `second-look-handoff.zip` (the one HANDOFF references) |
| LLM pipeline, evidence validator, chat, Gmail ingest, Web Push | **Not built** (the update prompt assumes they exist; they don't) | Chat built fresh in step 4; the rest only in the email module |
| `DECISIONS.md` | Email-first decisions | Updated: superseded rows marked |

---

## 2. Measured on the kit data (HANDOFF rules as written)

Look-alike counts use the Member Key for measurement only (HANDOFF section 9), never at runtime.

| Rule | Anchor fires? | Scam members caught | Look-alikes caught | Routine caught |
|---|---|---|---|---|
| R1 family-emergency wire | M1001 yes, at initiation (P1001-003) | 10/12 family emergency, plus 4 government impersonation | 4: M1057, M1067, M1075, M1104 (all home-closing wires; expected) | 0 |
| R2 ATO cluster | M1003 yes (P1003-007, -008) | 12/12 ATO, plus 2 family emergency | 4: M1039, M1041, M1051, M1114 (real reset + move) | 0 |
| R3 escalating P2P -> first-ever wire | M1002 yes | 4/12 romance | 0 | 0 |
| R4 branch cash after limits call | M1004 yes (P1004-004) | 7/12 government impersonation | 0 | 0 |

Facts verified against HANDOFF section 16:
- **Linda's timeline:** recipient added 14:04, initiated 14:11, held 14:21, outreach 15:42, released 17:04.
- **M1037:** $1,188.37 P2P at 1.14x; generic warning, completed in 2 minutes; R1 does not fire.
- **M1057:** $51,586.52 wire at 42.63x; R1 fires.

**Not caught by any rule (10 scam journeys):**
- 8 romance: M1009, M1023, M1029, M1036, M1052, M1056, M1061, M1088.
- 1 family emergency: M1035.
- 1 government impersonation: M1102.

---

## 3. Conflicts in HANDOFF.md that need a call

1. **R2 vs the state machine on M1003.**
   - The conflict: R2 says "pause the payment meanwhile", but both M1003 payments are **P2P**, and section 7 says P2P can never enter Held.
   - Proposal: on P2P, R2 holds the payment **at pre-submit**. It stays Pending, not yet submitted, with no 4-hour timer, while it waits for pre-change verification. The scripted ATO stop happens before submit (Stopped by Sound).
2. **R4 reads `event_note`.**
   - The conflict: "a call about limits" is only in `event_note`, which the data dictionary marks Observable = **"Partly", "Yes - storytelling"**.
   - Option A: keep the note, labeled "employee-recorded call topic" (a contact center logs call reasons). Catches 7/12 government impersonation, 0 look-alikes.
   - Option B: any Contact Center Call or Branch Visit within 30 days. Catches 7/12 plus 3 family emergency, but also **3 look-alikes** (the vehicle-cash members).
   - Proposal: **A**. Disclose it on the data slide.
3. **R3 misses 8 of 12 romance journeys.** Most of them move to **External Transfer**, not Wire.
   - Proposal: "first-ever Wire **or External Transfer**". Re-measure before adopting, and don't tune toward the key beyond this one rail fix.
4. **The demo script has no missed scam.** The problem statement requires "a legitimate member it flags **and a scam it misses**". HANDOFF section 16 covers the flag (M1057) but not the miss.
   - Proposal: add a 20-second beat with one member from the list above (after the R3 decision). Use M1102 if R3 changes, M1029 if it doesn't. Say plainly what signal was absent.
5. **The core demo is supposed to have zero external dependencies, but the chat is "real LLM".**
   - Proposal: the chat calls Claude when a key is set. Otherwise, or on error, it uses scripted case-grounded replies, labeled "offline replies". The click-through never depends on the API.
6. **Stack.** HANDOFF proposes Vite + React; DECISIONS #6 chose plain HTML/JS for time. Proposal: keep plain HTML/JS (fewer build steps).

---

## 4. Build order (HANDOFF section 14, with the steps above folded in)

The demo must be clickable at the end of every step. No finish times are promised; status updates go in this file.

| Step | Build | Tests (HANDOFF section 19) | Status |
|---|---|---|---|
| 1 | Core schema; kit CSV loader; replay engine with compressed clock (1 kit-day = 20 s); `npm run replay -- --member M1001` | A3 no-key-leakage (grep + import ban + "no later timestamps" unit test), A7 spot-check 3 Linda timestamps | Done (13:08) |
| 2 | Payment state machine (rail-specific: Wire/ACH/External Transfer can be Held for 4 h max; P2P only pre-submit; Cash only branch conversation; Stopped never completes; expiry executes only on reconfirm, otherwise returns unsent). Rules R1-R4 returning field evidence, canonical labels | A1, A2, A2b, A4 (stop blocked unless ATO) | Done (13:08), 21 tests pass |
| 3 | Employee console: risk queue sorted by hold countdown, after-hours flag, case detail with rule evidence + history comparison, conversation guide, actions with audit, release requires a reason | A4 | Done (13:17) |
| 4 | Member app (Sound-style shell, footer "Concept mock of the Sound app"): enrollment toggle at onboarding and in Settings; payment flow with T1 banner; hold notice with countdown, override in 2 taps or fewer, cancel in 1; pre-change confirmation; chat (with fallback); trusted contact; Report a scam | A5, A6 | Done (13:17); chat uses Claude if a key is set, else offline replies |
| 5 | Demo scenes: Linda as-is vs with Second Look; M1037 restraint; M1057 fast release; missed-scam beat; `npm run lookalikes`; `/about` one-pager; role switch "View as: Member / Employee" | A2, A8 | Done (13:17): six scenes in the demo bar, `/about` written |
| 6 | Alert policy T0/T1/T2: dedupe one case per situation, budget (1 T2/day, 3 T1/week), cooldown + material-change re-alert, quiet hours that never suppress checkpoints/queue/expiry; "why did I get this?"; banner copy snapshot test | A11 | Done (core): `src/alerts.ts` + 8 tests; wired into the sim (content-safe notification, why-did-I-get-this, settings for alert level and quiet hours) |
| 7 | Polish: accessibility pass (VoiceOver, scaling, AA, 44 px), README, DECISIONS, demo script | A9 | Partial: README, DEMO.md, focus/live-region fixes done; VoiceOver on a real iPhone still to do |
| 8 | Stretch: optional email module (HANDOFF section 10) | A10 | Done, as Second Look's own AgentMail inbox (`src/email.ts`) instead of watching a fixed inbox |
| 9 | Chat attachments (screenshots, PDFs, voice notes) | | Done |
| 10 | Call guardian and Second Look's phone line (AgentPhone) | | Done |
| 11 | Fraud cases filed for the member from any channel | | Done |
| 12 | Connected channels (Gmail forwarding or sign-in, call screening, texts) with push alerts | | Done; Gmail sign-in needs Google OAuth credentials |
| 13 | Verified phone and email links | | Done |

The current feature list lives in the README ("What's built"); this table is the build history.

**Minimum for 3:00 PM (HANDOFF): steps 1-5.** Step 6's full policy can be a thin version by then (banners exist and copy is safe; budget and cooldown come Sunday). If behind, cut in this order: email module, then the R2/M1003 beat, then the trusted-contact screen (keep the setting).

**Sunday (Phase 2):** finish step 6 and 7; rehearse the 5-minute script (HANDOFF section 16 plus the missed-scam beat); up to 10 slides; pilot slide from HANDOFF section 17; email module only if steps 1-7 are stable.

---

## 5. Email module notes (superseded)

The original plan watched a fixed inbox with a sender allowlist. What shipped instead: Second Look has its own address (secondlook@agentmail.to); it reads only mail from verified member addresses (or mail their Gmail forwards once they turn on watching), replies only to the member, and treats forwarded content as data. See README, "What's built".
