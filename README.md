# Vantis (HuskyHack 2026)

Concept demo for "Stop the Scam Before the Money Moves" (Sound Credit Union challenge). Vantis is protection members turn on inside a **simulated** Sound app. It flags risky payments from the kit's transaction signals, helps members check calls, texts and emails that feel off, and, when the member agrees, files a structured fraud case with Sound. Sound employees can hold, talk, escalate, or (for verified takeover only) stop a payment before money moves. Payments and members are the kit's synthetic data.

- Live demo: https://vantis-huskyhack.vercel.app (also https://second-look-demo.vercel.app) (forwards to the presenter's laptop; see `deploy/vercel-proxy/README.md`)
- Design and requirements: [HANDOFF.md](HANDOFF.md) · Build history: [PLAN.md](PLAN.md) · Decisions: [DECISIONS.md](DECISIONS.md) · Demo script: [DEMO.md](DEMO.md) · One-pager: `/about`

## What's built

This list is the single source of truth for what exists.

| Area | What it does | Code |
|---|---|---|
| Payment protection | Rules R1-R4 plus a new-recipient banner on the kit's events, each with field evidence; 4-hour holds on Wire/ACH/External Transfer, P2P stopped before submit, cash goes to a branch conversation; alert budgets, cooldowns, quiet hours | `src/rules.ts`, `src/payments.ts`, `src/sim.ts`, `src/alerts.ts` |
| Employee console | One work queue (member requests and Vantis fraud cases first, then holds by time left), case evidence, conversation guide, audited actions | `public/app.js` |
| Chat ("Ask Vantis") | Case-grounded Claude chat with no-action limits; screenshots, PDFs and voice notes (transcribed on the server with local Whisper, audio not kept) | `src/chat.ts`, `src/media.ts` |
| Call guardian | Listens to a call on speaker (or a sample scam call) and warns as it happens; summary at the end | `src/guardian.ts` |
| Phone line, (229) 471-5015 | AgentPhone number: members add it to a call, call it, or have it call back; live transcripts feed the call guardian; screens calls a member forwards | `src/phone.ts` |
| Screen unknown callers | With Silence Unknown Callers plus forward-unanswered, unknown callers reach Vantis first. It asks who's calling and why; our server decides (`/hooks/screening-decision`, agent custom tool): ordinary callers are put through (member opts in, verified phone), anyone claiming to be a bank or agency or raising codes, payments or secrecy is held back with quoted evidence. Fails closed; loop guard on unanswered transfers | `src/screening.ts`, `src/phone.ts` |
| Email, vantis@agentmail.to | AgentMail inbox: members forward a message (or ask a question) and get a reply; look-alike domains flagged | `src/email.ts` |
| Connected channels | Opt-in watching: mail the member's Gmail auto-forwards (or read-only Gmail sign-in), screened calls, forwarded texts. Ordinary messages are discarded after the check; alerts by web push, in app, or email | `src/monitor.ts`, `src/gmail.ts`, `public/sw.js` |
| Per-signal evidence | Each alert lists signs (urgency, secrecy, impersonation, threats, coaching, payment pressure, code requests) with a 0-1 score and the quoted words; risk (high/medium/low) is computed from them. Schema `signals/v1`; classifier is advisory for payments (DECISIONS.md, ADR 10) | `src/signals.ts`, [docs/signals.md](docs/signals.md) |
| WhatsApp | Members forward a message, screenshot or voice note to Vantis's WhatsApp number from their linked phone and get the chat's reply in the thread; it can report to Sound with the evidence. Inbound only; Meta signature checked first | `src/whatsapp.ts` |
| Fraud cases | Filed from any channel once the member says yes: member, threat, exposure, priority, suggested next steps, open questions; to the work queue and emailed to `FRAUD_TEAM_EMAIL` | `src/reports.ts` |
| Live in the room | A judge's phone joins the presenter's simulation by QR code | `src/server.ts` |

Phone numbers and email addresses only count once verified (a code by email; a call from the phone). Vantis never moves money and never collects full card or account numbers, SSNs, PINs, passwords or codes.

## Run

```bash
npm i
npm start                         # http://localhost:8787
npm test                          # state machine, rules, leakage, sessions, copy, tactics
npm run replay -- --member M1001  # print a member's kit timeline with rule findings
npm run lookalikes                # catch counts per rule (reads the Member Key for measurement only)
npm run calibrate                 # risk tiers on the labeled email fixtures (add -- --rules for the free rules-only run)
npm run eval                      # message-detection precision/recall on eval/conversations.jsonl -> eval/report.md
```

The payment demo needs no keys. Each optional channel turns on when its keys are in `.env`, and stays off (hidden in the app) without them:

| Turns on | Variables |
|---|---|
| Claude for chat, email replies, channel checks and call summaries (otherwise scripted replies labeled "offline reply") | `ANTHROPIC_API_KEY` (or `LLM_API_KEY`), optional `ANTHROPIC_MODEL` |
| How incoming messages are checked: `gate` (default), `hybrid`, `rules` or `classifier` (see [docs/classifier-schema.md](docs/classifier-schema.md)) | `DETECTION_MODE` |
| Vantis's email inbox | `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`; `FRAUD_TEAM_EMAIL` also emails filed cases to the fraud team |
| Connect Gmail (read-only) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL` |
| Vantis's phone number | `AGENTPHONE_API_KEY`, `AGENTPHONE_AGENT_ID`, `AGENTPHONE_NUMBER`, `AGENTPHONE_NUMBER_ID`; `AGENTPHONE_ALLOWED_TO` lists the phones "Call my phone" may ring; `AGENTPHONE_SCREENING_POOL` lists spare numbers so each member who screens calls gets their own; `AGENTPHONE_SCREEN_AGENT_ID` (optional) is a second agent those pool numbers are attached to, so forwarded callers hear a screening greeting and members calling Vantis hear their own |
| WhatsApp forwarding (setup below) | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMBER` |
| Push alerts | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_PEM` (base64 PEM), optional `VAPID_MAILTO` |
| Kit data somewhere other than `data/` | `KIT_EVENTS_PATH` |
| Fixed secret for the screening tool (otherwise a new one each start, pushed to the agent) | `SCREENING_TOOL_SECRET` |
| Server | `PORT` (8787), `DB_PATH`, `SESSION_SECRET`, `ALLOWED_ORIGIN_HOSTS` (a proxy in front, e.g. Vercel), `WHISPER_MODEL` |

### WhatsApp setup (Meta WhatsApp Cloud API)

1. At developers.facebook.com, create an app (type Business) and add the **WhatsApp** product. The API Setup page gives a free test number: copy its **Phone number ID** to `WHATSAPP_PHONE_NUMBER_ID` and the number to `WHATSAPP_NUMBER`. Add your own phone under "To" so the test number may reply to it (up to 5 numbers).
2. Access token: the temporary one on API Setup lasts 24 hours. For the demo, make a System User token with `whatsapp_business_messaging` in Business Settings. Put it in `WHATSAPP_TOKEN`.
3. App secret: App settings → Basic → App secret, to `WHATSAPP_APP_SECRET` (this is what the webhook signature is checked against).
4. Pick any random string for `WHATSAPP_VERIFY_TOKEN`. In WhatsApp → Configuration → Webhook, set the callback URL to `https://<your public host>/webhooks/whatsapp` with that verify token, then subscribe to the **messages** field.
5. Restart the server. In the app: link your phone on Call guardian, turn on WhatsApp under Connected channels, then message the number. Your first WhatsApp message confirms the linked phone.


## Layout

This list is the record of what exists; PLAN.md is the historical build plan.

Payment demo (no keys needed):
- `src/kit.ts` loads the events CSV (never the Member Key) with canonical label checks.
- `src/rules.ts` has rules R1-R4 plus the standard new-recipient banner; each returns field evidence.
- `src/payments.ts` is the payment state machine (4-hour holds, P2P pre-submit only, stop only after verified takeover, expiry never auto-sends).
- `src/sim.ts` is the replay engine: one simulation per browser session, one case per situation.
- `src/alerts.ts` is the alert policy: T0/T1/T2 tiers, interruption budget, cooldowns, quiet hours.
- `src/chat.ts` is the case-grounded "Talk to Vantis" chat with hard no-action limits; `src/media.ts` handles its photos, PDFs and voice notes (transcribed on this machine with Whisper).
- `public/` holds the member app, employee console and `/about` (plain HTML/JS).

Channels (each off without its keys, and only for members who turn it on):
- `src/email.ts` is Vantis's email inbox (AgentMail): members forward mail from an address they linked and get a reply, and can have it reported to Sound.
- `src/gmail.ts` is "Connect Gmail": read-only sign-in, new inbox mail checked every minute.
- `src/phone.ts` is Vantis's phone number (AgentPhone): call it, add it to a call, have it call you, screen missed calls, forward texts.
- `src/guardian.ts` is the call guardian: listens on speaker or to a phone call and names pressure tactics as they happen.
- `src/monitor.ts` holds the channel settings, the shared check for incoming messages (`assess`), and alerts (push, in-app, email).
- `src/whatsapp.ts` is WhatsApp forwarding (Cloud API webhook): members forward from their linked phone and get the chat's reply in the thread.
- `src/tactics.ts` names pressure tactics in text, keyed by signal, with the words that matched; `src/classifier.ts` scores the same signals with Claude, keeping only quoted evidence; `src/signals.ts` merges both and computes the risk tier from the evidence (ADR 10, [docs/signals.md](docs/signals.md)); `src/reports.ts` files a fraud case from any channel.

Data and scripts:
- `scripts/replay.ts`, `scripts/lookalikes.ts` (see Run), and `scripts/synthetic-kit.ts` (see Data).
- `fixtures/emails.json` holds scripted emails with expected outcomes (`npm run calibrate` checks the risk tiers against them); `eval/` holds the message-detection eval set (`npm run eval`).

## Data

`data/` holds the official kit files. They are not for public release, so they are gitignored; ask the team for them. The app reads only `HuskyHack_Synthetic_Events_v2.csv`. `HuskyHack_Member_Key_v2.csv` is the answer key: it is read only by `scripts/lookalikes.ts`, and a test fails if anything in `src/` or `public/` references it.

Without `data/`, everything runs on a **synthetic stand-in** in `fixtures/synthetic-kit/` (the server says so when it starts). It reproduces the anchor members the scenes and tests use (M1001, M1002, M1003, M1004, M1037, M1057, M1102), using only kit facts this repo already states, plus invented routine members. Its rule catch counts say nothing about the real kit. The files come from `scripts/synthetic-kit.ts`; after editing the generator, run `npm run kit:synthetic` (a test fails if the committed files are stale). **Never commit the official files.** `KIT_EVENTS_PATH` points the app at the events file somewhere else.
