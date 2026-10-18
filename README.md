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
npm run eval                      # message-detection precision/recall on eval/conversations.jsonl -> eval/report.md
```

The payment demo needs no keys. Each optional channel turns on when its keys are in `.env`, and stays off (hidden in the app) without them:

| Turns on | Variables |
|---|---|
| Claude for chat, email replies, channel checks and call summaries (otherwise scripted replies labeled "offline reply") | `ANTHROPIC_API_KEY` (or `LLM_API_KEY`), optional `ANTHROPIC_MODEL` |
| How incoming messages are checked: `gate` (default), `rules` or `classifier` (see [docs/classifier-schema.md](docs/classifier-schema.md)) | `DETECTION_MODE` |
| Second Look's email inbox | `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`; `FRAUD_TEAM_EMAIL` also emails filed cases to the fraud team |
| Connect Gmail (read-only) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL` |
| Second Look's phone number | `AGENTPHONE_API_KEY`, `AGENTPHONE_AGENT_ID`, `AGENTPHONE_NUMBER`, `AGENTPHONE_NUMBER_ID`; `AGENTPHONE_ALLOWED_TO` lists the phones "Call my phone" may ring; `AGENTPHONE_SCREENING_POOL` lists spare numbers (attached to the same agent) so each member who screens calls gets their own |
| Push alerts | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_PEM` (base64 PEM), optional `VAPID_MAILTO` |
| Server | `PORT` (8787), `DB_PATH`, `SESSION_SECRET`, `ALLOWED_ORIGIN_HOSTS` (a proxy in front, e.g. Vercel), `WHISPER_MODEL` |

## Layout

This list is the record of what exists; PLAN.md is the historical build plan.

Payment demo (no keys needed):
- `src/kit.ts` loads the events CSV (never the Member Key) with canonical label checks.
- `src/rules.ts` has rules R1-R4 plus the standard new-recipient banner; each returns field evidence.
- `src/payments.ts` is the payment state machine (4-hour holds, P2P pre-submit only, stop only after verified takeover, expiry never auto-sends).
- `src/sim.ts` is the replay engine: one simulation per browser session, one case per situation.
- `src/alerts.ts` is the alert policy: T0/T1/T2 tiers, interruption budget, cooldowns, quiet hours.
- `src/chat.ts` is the case-grounded "Talk to Second Look" chat with hard no-action limits; `src/media.ts` handles its photos, PDFs and voice notes (transcribed on this machine with Whisper).
- `public/` holds the member app, employee console and `/about` (plain HTML/JS).

Channels (each off without its keys, and only for members who turn it on):
- `src/email.ts` is Second Look's email inbox (AgentMail): members forward mail from an address they linked and get a reply, and can have it reported to Sound.
- `src/gmail.ts` is "Connect Gmail": read-only sign-in, new inbox mail checked every minute.
- `src/phone.ts` is Second Look's phone number (AgentPhone): call it, add it to a call, have it call you, screen missed calls, forward texts.
- `src/guardian.ts` is the call guardian: listens on speaker or to a phone call and names pressure tactics as they happen.
- `src/monitor.ts` holds the channel settings, the shared check for incoming messages (`assess`), and alerts (push, in-app, email).
- `src/tactics.ts` names pressure tactics in text, keyed by signal, with the words that matched; `src/classifier.ts` scores the same signals with Claude, keeping only quoted evidence; `src/reports.ts` files a fraud case from any channel.

Data and scripts:
- `scripts/replay.ts`, `scripts/lookalikes.ts` (see Run), and `scripts/synthetic-kit.ts` (see Data).
- `fixtures/emails.json` holds scripted emails with expected outcomes.

## Data

`data/` holds the official kit files. They are not for public release, so they are gitignored; ask the team for them. The app reads only `HuskyHack_Synthetic_Events_v2.csv`. `HuskyHack_Member_Key_v2.csv` is the answer key: it is read only by `scripts/lookalikes.ts`, and a test fails if anything in `src/` or `public/` references it.

Without `data/`, everything runs on a **synthetic stand-in** in `fixtures/synthetic-kit/` (the server says so when it starts). It reproduces the anchor members the scenes and tests use (M1001, M1002, M1003, M1004, M1037, M1057, M1102), using only kit facts this repo already states, plus invented routine members. Its rule catch counts say nothing about the real kit. The files come from `scripts/synthetic-kit.ts`; after editing the generator, run `npm run kit:synthetic` (a test fails if the committed files are stale). Never commit the official files.
