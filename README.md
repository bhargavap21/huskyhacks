# Second Look (HuskyHack 2026)

Concept demo for "Stop the Scam Before the Money Moves" (Sound Credit Union challenge). Second Look is protection members turn on inside a **simulated** Sound app; Sound employees can hold, talk, escalate, or (for verified takeover only) stop a payment before money moves. Everything runs on the kit's synthetic data.

- Design and requirements: [HANDOFF.md](HANDOFF.md)
- Build plan and status: [PLAN.md](PLAN.md)
- Decisions and rule catch counts: [DECISIONS.md](DECISIONS.md)
- Demo script: [DEMO.md](DEMO.md)
- One-pager: `/about` in the running app

## Run

```bash
npm i
npm start                         # http://localhost:8787
npm test                          # state machine, rules, no-answer-key leakage, sessions, copy checks
npm run replay -- --member M1001  # print a member's kit timeline with rule findings
npm run lookalikes                # catch counts per rule (reads the Member Key for measurement only)
```

Optional: put `ANTHROPIC_API_KEY=...` in `.env` to use Claude for the "Talk to Second Look" chat. Without it, the chat uses scripted replies labeled "offline reply".

## Layout

- `src/kit.ts` loads the events CSV (never the Member Key) with canonical label checks.
- `src/rules.ts` has rules R1-R4 plus the standard new-recipient banner; each returns field evidence.
- `src/payments.ts` is the payment state machine (4-hour holds, P2P pre-submit only, stop only after verified takeover, expiry never auto-sends).
- `src/sim.ts` is the replay engine: one simulation per browser session, one case per situation.
- `src/chat.ts` is the case-grounded chat with hard no-action limits.
- `public/` holds the member app, employee console and `/about` (plain HTML/JS).
- `src/email/` is reserved for the optional email module (not built).

## Data

`data/` holds the official kit files. The app reads only `HuskyHack_Synthetic_Events_v2.csv`. `HuskyHack_Member_Key_v2.csv` is the answer key: it is read only by `scripts/lookalikes.ts`, and a test fails if anything in `src/` or `public/` references it.
