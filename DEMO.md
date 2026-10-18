# Demo script

Link: **https://vantis-huskyhack.vercel.app** (the old https://second-look-demo.vercel.app still works) (forwards to the laptop; see `deploy/vercel-proxy/README.md`).

- **Demo controls** bar: pick a scene, press **Play**. When a payment needs people, the replay stops and the hold clock runs at 60x (4 hours ≈ 4 minutes).
- **Page list** (left; collapse with ☰): **Home**, **Vantis** and **Console** show one page at a time; **Side by side** shows member and employee together (best on a laptop); **App setup** opens the member's setup steps; **Kit timeline**; **About this concept**.
- **Account menu** (bottom left, "Linda"): **Profile**, **Settings**, **Appearance** (light or dark) and **Sign out**. Sign-in is demo-only: no account or password, and a fresh visit starts signed in.
- **Vantis chat** opens on the right (button in the top bar). While a payment is held, the chat follows that payment unless you chose **Something feels off?**.
- **Invite a phone** (top bar): shows a QR code and a short link. Whoever scans it gets Linda's member app on their own phone, in this same simulation. Codes reset if the server restarts, so open it again for a fresh one.
- Deep links: `?page=home|console|split|profile|onboarding&scene=m1057&jump=1`, and `?chat=general` for the "feels off" chat.

Say these out loud every time:
- "Everything is simulated on the kit's synthetic data."
- "The pause really pauses the demo payment. It touches no real money or Sound system."
- "For your own payment, Sound can delay and advise. You decide."

---

## Phase 1: 2-minute pitch (Saturday)

| Time | Say | Do |
|---|---|---|
| 0:00 | "Linda, M1001, is told her grandson is in jail and to keep it secret. In the kit her $8,500 wire was held, she confirmed, and it went out. Recovery failed." | Scene: **Linda: with Vantis**. Press Play. |
| 0:20 | "Vantis is a setting she turned on inside the Sound app. The moment she starts the wire, rule R1 fires on Sound's own data: first wire in 2,411 days, a brand-new recipient, 4.77 times her usual." | Point at the hold notice (member) and the queue row (employee). |
| 0:45 | "The hold lands with the evidence, and the employee gets a conversation guide right away instead of a generic callback 90 minutes later. Her override stays one tap away." | Point at the guide, then **It’s me, send it now**. Don't press it. |
| 0:55 | (Live, if a judge is willing) "Try it yourself: you're Linda." | **Invite a phone**, judge scans. On their phone: **Talk it through**, tick **Share this chat with the Sound employee helping me**, type "He said not to tell my mom". On the console: their words appear under **What the member told Vantis**, tagged *Asked to keep it secret*, and the secrecy question moves to the top of the guide. |
| 1:05 | "Same trigger, legitimate: M1057's $51,586 closing wire. The answer isn't a looser rule; it's release in minutes." | Scene: **M1057**. Play. Type a reason, **Log the call**, **Release hold**. |
| 1:30 | "And a scam we miss: M1102 wired $5,000 for a 'federal agent'. Not unusual enough for R1. We show that instead of hiding it." | Scene: **M1102** (optional if short on time). |
| 1:40 | (Optional) "And members can talk it through before any money moves." | Home card **Something feels off?** → type one line → **Talk to a person at Sound**. |
| 1:45 | "Opt-in, no new app, quiet by default, employees in the loop, and only powers Sound already has." | (Optional) **App setup** to show the opt-in; **About this concept** if asked. |

---

## Phase 2: 5-minute live demo (Sunday)

### Sunday plan: slides, then one live Level 4 threat

Slides 1–8 (about 2:15): problem, how Vantis works, threat levels 0–4, one slide per use case. Then slide 9 and the live demo (about 2:15), then the close (slide 10). The older steps below stay as optional extras and Q&A material.

**Threat levels and actions** (`tier()` in `src/signals.ts`, actions in `src/monitor.ts` and `src/phone.ts`):

| Level | Looks like | Vantis |
|---|---|---|
| 0 | Ordinary message | Checked, thrown away |
| 1 Low | One faint sign | Note in the app only |
| 2 Medium | One clear sign or a look-alike link | Notification, reply on the channel |
| 3 High | Several clear signs | Notification with "Report to Sound" first |
| 4 Critical | Clear code/money/remote-access ask + poses as trusted, threats or secrecy | All of the above, and **Vantis calls the member within seconds**, coaches them, offers to tell Sound; a yes files the case with the evidence |

**Before going on stage**
- [ ] Bhargava's phone is linked on **Call guardian** and shows **Confirmed** (it's on the team list, so it confirms straight away).
- [ ] WhatsApp is configured (README, "WhatsApp setup"): Bhargava's phone is an allowed recipient of the Meta test number, and **Connected channels → WhatsApp** is on. Send "hi" to Vantis's WhatsApp once, so it can reply.
- [ ] Rehearse with **Connected channels → Sample Level 4 threat**: the phone should ring within about 10 seconds.
- [ ] Dheeraj's number is **not** saved in Bhargava's contacts (or he uses a second phone).
- [ ] Phone mirrored to the projector; laptop tabs: member app on **Connected channels** (Recent alerts), employee **Console**.
- [ ] Public link loads (the quick tunnel can die; check right before).
- [ ] Claude reachable: with Claude the demo message is Level 4; the rules alone rate it Level 2 and Vantis would not call.

**Live (about 2 minutes)**
1. "Dheeraj is going to try to scam me." Dheeraj sends on WhatsApp: *"This is the Sound Credit Union fraud team. Your account will be frozen in the next 30 minutes. Reply with the 6-digit code we just texted you to keep it open."*
2. Bhargava long-presses → **Forward** → **Vantis**. Vantis replies in the WhatsApp chat; the app shows **Level 4 · Act now** with each sign and its quoted words.
3. The phone rings: Vantis. Put it on speaker. It asks whether he replied or shared a code ("No"), explains what the message claims, and says what to do (don't reply, don't click, call Sound on the card).
4. When it offers to tell Sound: "Yes, please." Hang up. Switch to the console: the fraud case is at the top, Critical, with the quoted evidence.

**If something fails**
- WhatsApp doesn't arrive: Dheeraj texts the same message instead; Bhargava forwards the text to **(229) 471-5015**. Same Level 4 call.
- No call within 20 s: tap **Sample Level 4 threat** on Connected channels (same call path).
- Bonus, fully automatic (only if call forwarding and Silence Unknown Callers are set up on Bhargava's phone): Dheeraj calls Bhargava with `*67` and says he's Sound's fraud team needing the code. Vantis screens it, holds it back, and alerts him.

0. **Opt-in, no new app** (30 s, optional). Page list → **App setup** (or the **Finish setting up** card on Home). Step 1 offers Vantis with **Not now** right beside it ("if you choose not now, it stays off and we won't keep asking"). Turn it on, pick **Standard** alerts, skip the trusted contact, and show the summary. "It's a setting inside the app members already use. No new account, no new app." Then open the account menu → **Profile** to show the same choices.
1. **Linda as it happened** (30 s). Scene **Linda: what happened in the kit**, Play. State the facts only: held 14:21, outreach 15:42, she confirmed, released 17:04. The next-day cash request was the one stopped. Don't diagnose.
2. **Linda with Vantis** (90 s). The R1 hold appears at 14:11, at initiation, with the three kit fields. Employee: read guide question 3 ("Has anyone asked you to keep this quiet?"). Member: **Talk it through**, type "He said not to tell mom". The reply notes secrecy and suggests calling a number she already had. Then she presses **Cancel this payment**. "Our hypothesis is that evidence plus an early guided conversation changes decisions. The pilot is how you'd measure it."
2b. **Live in the room** (60 s, the centrepiece). Before step 2 ends, **Invite a phone** and ask a judge to scan. Press **Restart** then **Play** so the judge's phone shows the hold as the console row appears. On the judge's phone: **Talk it through**, tick **Share this chat…**, then type or record a voice note in their own words. On the console: **What the member told Vantis** shows their exact words and the patterns they mention (prompts for the call, not proof), and the guide reorders to match. Say: "Nothing is shared unless the member chooses to. Sound only sees what she typed, and it turns a warning into a conversation with someone who already knows what she said." Fallback: scan it with your own phone.
3. **Quiet default and restraint: M1037** (40 s). Typical amount, P2P, so R1 does not fire. One standard banner, **Yes, send it**. The Vantis tab shows "You marked this fine (N s)".
4. **Same-trigger false positive: M1057** (50 s). R1 fires exactly as for Linda. Employee releases with a reason in under a minute; or the member taps **It’s me, send it now** and enters the demo code (step-up confirmation).
5. **Takeover pattern: M1003** (40 s, if time). Pre-submit check with confirmation to *pre-change* contact details. Show **Stop payment** refused, then **Takeover confirmed (scripted premise)**, then **Stop**. The second payment joins the same case. "The pattern routes to verification. It doesn't prove a takeover by itself."
6. **Missed: M1102** (20 s). Only the standard banner shows.
6b. **Before any payment: "Something feels off?"** (30 s). Open `/?chat=general&view=member` (or the card on the member home screen). Type "Someone from Sound's fraud team called and wants the code I just got by text." Vantis explains that a real credit union never asks for a texted code and asks whether the code was shared. Tap **Talk to a person at Sound**: the request appears for the employee under **Members asking to talk**. **I already sent money** shows recovery steps and flags the recovery team as urgent.
6c. **A voice note or voicemail** (30 s). In the same "Something feels off?" chat, tap **Record a voice note** and read: "Grandma, it's me, I'm in jail, I need $2,000 by wire today, don't tell Mom." (Or attach a saved voicemail or a screenshot of the text.) Vantis shows the transcript and names the urgency, the emergency and the secrecy, without a verdict. If **Share this chat…** is ticked, the console shows the transcript with the same tags. "The member chooses what to show us. We never read her calls or texts."
6d. **Call guardian** (45 s). **Side by side** → **Call guardian** → tick **Let Sound see warnings during this call** → **Play a sample scam call**. Warnings stack up as the "fraud department" caller talks (authority, hurry, a code, a "safe account", secrecy, gift cards) and appear live on the console. Claude summarises at the end. Live version: link your phone, then add (229) 471-5015 to a call (Add call → Merge), or tap **Call my phone**.
6e. **Forward a scam email** (30 s). Beforehand, link your email on **Email check**. On stage, forward a phishing email to **vantis@agentmail.to** from your phone. Within about 30 s the reply arrives in your inbox and the report shows on **Email check** and the console, for example "sound-cu-secure.com uses Sound's name, but it isn't soundcu.com." Say: "Vantis only reads mail the member forwards from their own linked address. Everything else is left unread."
7. Slides: pilot (90 days, assumptions stated) and limits.

## If something breaks
- Page stuck: **Restart**.
- Phone join link says it expired: the server restarted. Open **Invite a phone** again for a new code.
- Member app shows "Sign in to Sound": tap **Sign in as Linda (demo)**, or open the link in a new tab (sign-in resets per tab).
- Chat slow or offline: it falls back to scripted replies labeled "offline reply".
- Link down: the laptop must be awake and online. Run `npm start` locally, and the tunnel again if needed.
