# Demo script

Link: **https://second-look-demo.vercel.app** (forwards to the laptop; see `deploy/vercel-proxy/README.md`). Use the **Demo controls** bar: pick a scene, press **Play**. When a payment needs people, the replay stops and the hold clock runs at 60x (4 hours ≈ 4 minutes). Use the left page list: **Side by side** shows member and employee together (best on a laptop); **Home** / **Console** show one at a time. The **Second Look chat** opens on the right (collapse it with **Hide chat**, the page list with ☰). Deep links: `?page=home|console|split&scene=m1057&jump=1`.

Say these out loud every time:
- "Everything is simulated on the kit's synthetic data. The member app is a concept mock, not Sound software."
- "The pause really pauses the demo payment. It touches no real money or Sound system."
- "For your own payment, Sound can delay and advise. You decide."

---

## Phase 1: 2-minute pitch (Saturday)

| Time | Say | Do |
|---|---|---|
| 0:00 | "Linda, M1001, is told her grandson is in jail and to keep it secret. In the kit her $8,500 wire was held, she confirmed, and it went out. Recovery failed." | Scene: **Linda: with Second Look**. Press Play. |
| 0:20 | "Second Look is a setting she turned on inside the Sound app. The moment she starts the wire, rule R1 fires on Sound's own data: first wire in 2,411 days, a brand-new recipient, 4.77 times her usual." | Point at the hold notice (member) and the queue row (employee). |
| 0:45 | "The hold lands with the evidence, and the employee gets a conversation guide right away instead of a generic callback 90 minutes later. Her override stays one tap away." | Point at the guide, then **It’s me, send it now**. Don't press it. |
| 1:05 | "Same trigger, legitimate: M1057's $51,586 closing wire. The answer isn't a looser rule; it's release in minutes." | Scene: **M1057**. Play. Type a reason, **Log the call**, **Release hold**. |
| 1:30 | "And a scam we miss: M1102 wired $5,000 for a 'federal agent'. Not unusual enough for R1. We show that instead of hiding it." | Scene: **M1102** (optional if short on time). |
| 1:40 | (Optional) "And members can talk it through before any money moves." | Home card **Something feels off?** → type one line → **Talk to a person at Sound**. |
| 1:45 | "Opt-in, no new app, quiet by default, employees in the loop, and only powers Sound already has." | Open **About this concept** if asked. |

---

## Phase 2: 5-minute live demo (Sunday)

1. **Linda as it happened** (30 s). Scene **Linda: what happened in the kit**, Play. State the facts only: held 14:21, outreach 15:42, she confirmed, released 17:04. The next-day cash request was the one stopped. Don't diagnose.
2. **Linda with Second Look** (90 s). The R1 hold appears at 14:11, at initiation, with the three kit fields. Employee: read guide question 3 ("Has anyone asked you to keep this quiet?"). Member: **Talk it through**, type "He said not to tell mom". The reply notes secrecy and suggests calling a number she already had. Then she presses **Cancel this payment**. "Our hypothesis is that evidence plus an early guided conversation changes decisions. The pilot is how you'd measure it."
3. **Quiet default and restraint: M1037** (40 s). Typical amount, P2P, so R1 does not fire. One standard banner, **Yes, send it**. The Second Look tab shows "You marked this fine (N s)".
4. **Same-trigger false positive: M1057** (50 s). R1 fires exactly as for Linda. Employee releases with a reason in under a minute; or the member taps **It’s me, send it now** and enters the demo code (step-up confirmation).
5. **Takeover pattern: M1003** (40 s, if time). Pre-submit check with confirmation to *pre-change* contact details. Show **Stop payment** refused, then **Takeover confirmed (scripted premise)**, then **Stop**. The second payment joins the same case. "The pattern routes to verification. It doesn't prove a takeover by itself."
6. **Missed: M1102** (20 s). Only the standard banner shows.
6b. **Before any payment: "Something feels off?"** (30 s). Open `/?chat=general&view=member` (or the card on the member home screen). Type "Someone from Sound's fraud team called and wants the code I just got by text." Second Look explains that a real credit union never asks for a texted code and asks whether the code was shared. Tap **Talk to a person at Sound**: the request appears for the employee under **Members asking to talk**. **I already sent money** shows recovery steps and flags the recovery team as urgent.
7. Slides: pilot (90 days, assumptions stated) and limits.

## If something breaks
- Page stuck: **Restart scene**.
- Chat slow or offline: it falls back to scripted replies labeled "offline reply".
- Link down: the laptop must be awake and online. Run `npm start` locally, and the tunnel again if needed.
