# Second Look (HuskyHack 2026)

Concept demo for "Stop the Scam Before the Money Moves" (Sound Credit Union challenge). Second Look is protection members turn on inside a **simulated** Sound app. It flags risky payments from the kit's transaction signals, helps members check calls, texts and emails that feel off, and, when the member agrees, files a structured fraud case with Sound. Sound employees can hold, talk, escalate, or (for verified takeover only) stop a payment before money moves. Payments and members are the kit's synthetic data.

- Live demo: https://second-look-demo.vercel.app (forwards to the presenter's laptop; see `deploy/vercel-proxy/README.md`)
- Design and requirements: [HANDOFF.md](HANDOFF.md) · Build history: [PLAN.md](PLAN.md) · Decisions: [DECISIONS.md](DECISIONS.md) · Demo script: [DEMO.md](DEMO.md) · One-pager: `/about`

## What's built

This list is the single source of truth for what exists.

| Area | What it does | Code |
|---|---|---|
| Payment protection | Rules R1-R4 plus a new-recipient banner on the kit's events, each with field evidence; 4-hour holds on Wire/ACH/External Transfer, P2P stopped before submit, cash goes to a branch conversation; alert budgets, cooldowns, quiet hours | `src/rules.ts`, `src/payments.ts`, `src/sim.ts`, `src/alerts.ts` |
| Employee console | One work queue (member requests and Second Look fraud cases first, then holds by time left), case evidence, conversation guide, audited actions | `public/app.js` |
| Chat ("Ask Second Look") | Case-grounded Claude chat with no-action limits; screenshots, PDFs and voice notes (transcribed on the server with local Whisper, audio not kept) | `src/chat.ts`, `src/media.ts` |
| Call guardian | Listens to a call on speaker (or a sample scam call) and warns as it happens; summary at the end | `src/guardian.ts` |
| Phone line, (229) 471-5015 | AgentPhone number: members add it to a call, call it, or have it call back; live transcripts feed the call guardian; screens calls a member forwards | `src/phone.ts` |
| Email, secondlook@agentmail.to | AgentMail inbox: members forward a message (or ask a question) and get a reply; look-alike domains flagged | `src/email.ts` |
| Connected channels | Opt-in watching: mail the member's Gmail auto-forwards (or read-only Gmail sign-in), screened calls, forwarded texts. Ordinary messages are discarded after the check; alerts by web push, in app, or email | `src/monitor.ts`, `src/gmail.ts`, `public/sw.js` |
| Per-signal evidence | Each alert lists signs (urgency, secrecy, impersonation, threats, coaching, payment pressure, code requests) with a 0-1 score and the quoted words; risk (high/medium/low) is computed from them. Schema `signals/v1`; classifier is advisory for payments (DECISIONS.md, ADR 10) | `src/signals.ts`, [docs/signals.md](docs/signals.md) |
| WhatsApp | Members forward a message, screenshot or voice note to Second Look's WhatsApp number from their linked phone and get the chat's reply in the thread; it can report to Sound with the evidence. Inbound only; Meta signature checked first | `src/whatsapp.ts` |
| Fraud cases | Filed from any channel once the member says yes: member, threat, exposure, priority, suggested next steps, open questions; to the work queue and emailed to `FRAUD_TEAM_EMAIL` | `src/reports.ts` |
| Live in the room | A judge's phone joins the presenter's simulation by QR code | `src/server.ts` |

Phone numbers and email addresses only count once verified (a code by email; a call from the phone). Second Look never moves money and never collects full card or account numbers, SSNs, PINs, passwords or codes.

## Run

```bash
npm i
npm start                         # http://localhost:8787
npm test                          # state machine, rules, leakage, sessions, copy, tactics
npm run replay -- --member M1001  # print a member's kit timeline with rule findings
npm run lookalikes                # catch counts per rule (reads the Member Key for measurement only)
npm run calibrate                 # risk tiers on the labeled email fixtures (add -- --rules for the free rules-only run)
```

The payment simulator needs the kit data (next section). Without it, the server explains what's missing and `npm test` skips the 16 kit-replay tests with a reason.

### Configuration (`.env`, never committed)

| Variable | Turns on |
|---|---|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude for chat, summaries and case filing (otherwise scripted replies labeled "offline") |
| `AGENTPHONE_API_KEY`, `AGENTPHONE_AGENT_ID`, `AGENTPHONE_NUMBER_ID`, `AGENTPHONE_NUMBER` | Second Look's phone line |
| `AGENTPHONE_ALLOWED_TO` | Team phones Second Look may call from "Have Second Look call me" (trusted without a verification call) |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID` | Second Look's inbox |
| `FRAUD_TEAM_EMAIL` | Where fraud cases are emailed (stand-in for Sound's fraud team) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_PEM`, `VAPID_MAILTO` | Web push alerts |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL` | "Connect Gmail" (read-only) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMBER` | WhatsApp forwarding (setup below) |
| `ALLOWED_ORIGIN_HOSTS` | Extra hosts allowed through the CSRF origin check (the Vercel front door) |
| `KIT_EVENTS_PATH` | Read the kit events CSV from somewhere other than `data/` |

### WhatsApp setup (Meta WhatsApp Cloud API)

1. At developers.facebook.com, create an app (type Business) and add the **WhatsApp** product. The API Setup page gives a free test number: copy its **Phone number ID** to `WHATSAPP_PHONE_NUMBER_ID` and the number to `WHATSAPP_NUMBER`. Add your own phone under "To" so the test number may reply to it (up to 5 numbers).
2. Access token: the temporary one on API Setup lasts 24 hours. For the demo, make a System User token with `whatsapp_business_messaging` in Business Settings. Put it in `WHATSAPP_TOKEN`.
3. App secret: App settings → Basic → App secret, to `WHATSAPP_APP_SECRET` (this is what the webhook signature is checked against).
4. Pick any random string for `WHATSAPP_VERIFY_TOKEN`. In WhatsApp → Configuration → Webhook, set the callback URL to `https://<your public host>/webhooks/whatsapp` with that verify token, then subscribe to the **messages** field.
5. Restart the server. In the app: link your phone on Call guardian, turn on WhatsApp under Connected channels, then message the number. Your first WhatsApp message confirms the linked phone.

## Getting the kit data

The official HuskyHack files are hackathon materials, not for public release, and this repo is public, so `data/` is gitignored. **Never commit them.**

1. Get the kit from the HuskyHack 2026 challenge materials (or from a teammate).
2. Put the files in `data/` with their original names: `HuskyHack_Synthetic_Events_v2.csv` (the app reads only this), `HuskyHack_Member_Key_v2.csv`, plus the docs.
3. Run `npm test`: the kit-replay tests run instead of being skipped.

`HuskyHack_Member_Key_v2.csv` is the answer key. Only `scripts/lookalikes.ts` reads it, and a test fails if anything in `src/` or `public/` references it.

## Layout

- `src/kit.ts` loads the events CSV (never the Member Key) with canonical label checks.
- `src/rules.ts`, `src/payments.ts`, `src/sim.ts`, `src/alerts.ts`: payment rules, state machine, replay engine, alert policy.
- `src/chat.ts`, `src/media.ts`: chat and attachments. `src/tactics.ts`: pressure-tactic patterns shared by every channel.
- `src/guardian.ts`, `src/phone.ts`, `src/email.ts`, `src/monitor.ts`, `src/gmail.ts`: call guardian, phone line, inbox, connected channels.
- `src/reports.ts`: fraud cases. `src/server.ts`: routes, sessions, CSRF.
- `public/`: member app, employee console, `/about`, push service worker (plain HTML/JS, Instinct design system in `design-system/`).
