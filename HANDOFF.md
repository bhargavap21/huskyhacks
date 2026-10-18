# Second Look (Sound-embedded) - Implementation Handoff for a fresh Claude Code session

You start with zero context. This file plus `fixtures/emails.json` and `data/` is everything you need. Read it fully, then build in the order of section 14. Nothing has been built, deployed or tested yet.

Label key: **[KIT]** stated in the official HuskyHack kit files in `data/` (verified by reading them). **[USER]** reported by the team (Bhargava) in chat, not verifiable from any written source. **[PROPOSED]** a default chosen to ship fast; change it for a good reason and log it in `DECISIONS.md`.

---

## 1. What we are building (revised concept)

HuskyHack 2026 challenge: "Stop the Scam Before the Money Moves" (Sound Credit Union) [KIT]. Our concept is **Second Look: protection members turn on inside Sound's own app, with Sound employees able to intervene before money moves.**

The team set two priorities [USER]:

1. **Adoption and ease.** This must not be a separate app members have to find and install. It is a setting members enable in the Sound Credit Union app, offered during onboarding and available later in Settings. One switch, plain language, no new account, no new app to learn.
2. **Prevention, not just notification.** The member and the manipulator are not the only people in the loop. Sound employees are part of the intervention: they can pause a payment, talk to the member, escalate a case, and stop account-takeover payments before funds leave.
3. **No alert fatigue.** The team explicitly does not want an interruption for every suspicious message [USER]. The default is quiet, in-place context: a banner next to the thing it concerns, with a one-tap way to talk to the security agent. Proactive interruptions are reserved for immediate money or account risk and are budgeted, deduped, and cooled down (section 8).

**Capability honesty (never blur this):** the kit does NOT give Sound blanket authority to freeze accounts on suspicion [KIT]. What Sound can actually do [KIT, Capability Assumptions]:

- **Holds:** pause an outgoing **wire, external transfer, or ACH payment before it is sent, for up to 4 hours**, while it contacts the member.
- **P2P:** cannot be recalled once sent. Any pause must happen **before the member submits** (a pre-submit confirmation step).
- **Cash:** large withdrawals happen in a branch with an employee present; the intervention is the branch conversation.
- **Member-authorized payments:** Sound can **delay and advise; the member makes the final decision**. Override is the member's right and must stay in the design.
- **Account takeover:** Sound **can stop the payment** outright.
- **Confirmation:** Sound can send a code/confirmation by text, email, or in-app to **contact details on file**, and knows when those details last changed.
- **Recovery:** wire recalls and ACH returns **can be requested but are not guaranteed**; odds fall the longer a scam goes unreported.
- **Trusted contacts:** Sound does **not** offer this today; teams may assume Sound could launch it. Voluntary, revocable, member-directed; the contact is **informed, never given account access or control** [KIT guardrails].

Everything the demo shows must be one of these powers. We never claim an account freeze.

**Updated 2026-10-18 (DECISIONS #15):** the default screens now present the product as Sound would run it: a staff console and a member view, with no demo controls or "simulated" labels. Honesty is carried three ways instead. (1) Every seeded case is badged **Sample** and the queue says **Includes sample cases**. (2) The guided walkthrough (scenes, replay clock, kit timeline, staged samples) sits behind **View demo**, where the "simulated" labels remain. (3) The presenter says it out loud: this is a concept on synthetic data, and holds change only the simulation.

**What the demo is:** we have no access to Sound's real app, APIs, or systems. The demo is a **simulated Sound environment**: a member app that looks and reads like a Sound mobile app, an employee console, and a payment engine that replays the kit's synthetic events. Holds, releases, stops, and cancellations in the demo are **enforceable only inside the simulation** - the payment engine actually changes payment state, so a hold genuinely blocks the (synthetic) wire until it is released or expires. That is the honest middle ground: the pause really pauses the demo payment; it touches no real money, account, or Sound system. Say exactly this in the pitch.

**Detection core (kept from the earlier concept):** recognize manipulation patterns - urgency, secrecy, impersonation of a relative, institution or authority, threats, requests to move money in unusual ways, blocking verification, credential/code requests. Output is **"worth a second look / needs human review / unknown"** - never "definitely a scam", never "definitely safe". The member decides. Responses and verification steps are voluntary; the system explains what it cannot tell. No coaching-effectiveness or detection-accuracy claims.

## 2. Time and deliverables
- **Phase 1: Saturday Oct 17, prototype link due 3:00 PM PT, presentations start about 3:15** [USER, from organizer agenda; Devpost time unverified]. 2-minute pitch + 3 min Q&A [KIT].
- **Phase 2: Sunday Oct 18**: 5-minute live demo, 3 min Q&A, up to 10 slides, prototype link due by deadline [KIT].
- [KIT] Submission must show: clickable prototype; member story and journey; trigger, intervention, data used, role of people; false-positive path with appeal/override; realistic 90-day pilot with baseline/target assumptions stated (no real fraud rates from synthetic data); privacy, accessibility, responsible design; walk-through on at least one anchor persona (M1001-M1004) AND one legitimate look-alike from the data.
- Judging [KIT]: Member Safety 30, UX and Trust 25, Feasibility 20, Innovation 15, Prototype/Presentation 10.
- Build so a **click-through works by 3 PM even if every integration fails**: the member app, employee console, and replay engine are all local and simulated, so the core demo has no external dependency. The optional email module (section 10) is the only piece with live integrations; cut it first if time is tight.

## 3. Architecture [PROPOSED]

```
Kit events CSV --> Event loader --> Synthetic event engine (SQLite, replays one member's timeline)
                                        |
                              Detection engine (rules over kit fields, section 9)
                                        |
                 +----------------------+----------------------+
                 |                                             |
   Member app (simulated Sound app,             Employee console (web)
   mobile-first PWA): opt-in toggle,            risk queue, case detail, actions:
   warnings, hold notice, confirmation          place/release hold, outreach, escalate,
   step, Second Look chat, override,            stop (ATO), trusted-contact notify,
   trusted contact, recovery request            recovery request, case notes
                 |                                             |
                 +----------- shared case + payment state ------+
                               (section 7 state machine)

Optional (section 10): member-consented Gmail companion --> manipulation-pattern analysis
with validated evidence quotes --> extra signal on the Sound-side case + member push alerts
```

- Stack: Node 20 + TypeScript, Hono or Express, `better-sqlite3`, Vite + React. Member app and employee console served by one app, one SQLite file. LLM only for the chat and the optional email analysis. [PROPOSED]
- The member app must look like a feature inside Sound's app (Sound-style header, "Second Look" as a section), not a standalone product. It is a design mock of Sound's UI - label it "Concept mock of the Sound app" in an `/about` page and on the first screen footer.
- Hosting: any HTTPS host (Fly.io / Render / Railway / Cloudflare Tunnel). The core demo has no third-party calls, so it cannot be blocked by an API outage.
- Secrets in env: `LLM_API_KEY`, `APP_BASE_URL`, `ADMIN_PIN`. (Email module adds the Google/VAPID secrets listed in section 10.)

## 4. Member experience (inside the simulated Sound app)

1. **Enrollment (the adoption story):** during simulated Sound app onboarding, a screen offers Second Look: one toggle, one sentence ("We watch for signs someone may be manipulating you, and a Sound employee can step in before money moves"), a "what we use / what we never do" expander, and a skip. Same toggle lives in Settings -> Second Look, with a one-tap turn-off. Default after skip is off; no dark patterns, no re-ask loops. [PROPOSED placement - the user asked for "a setting they enable or something they install during onboarding" [USER]; this covers both.]
2. **Contextual banner (the default intervention):** when something concerning is detected, the member sees a calm banner **in the surface they are already in** - the payment flow, the recipient-setup screen, or the case/message view - not a message pushed to a separate channel [USER]. The banner says what we noticed and why it matters ("Some things about this request are worth a second look: this recipient is brand new and the amount is much higher than your usual"), names the concerning **evidence and request**, and never declares the person malicious [KIT dignity; no certainty claims]. It carries three taps: "Tell me more" (evidence + what we can't tell), "Talk to Second Look" (the security agent chat, scoped to this item), and "This is fine" (the false-positive path, one tap, no guilt). On a payment in progress it also offers "Pause and talk to Sound" and "Cancel payment". No shame, no red-alarm styling.
3. **Hold notice:** if the payment is held (wire/ACH/external transfer only, section 7), the member sees: what is paused, why, the 4-hour window, that a Sound employee will reach out, what happens at the 4-hour mark (section 7: execute only if they reconfirmed; otherwise it returns unsent and they can resubmit), and their options (release it myself = override with confirmation; cancel it; talk to someone now). The override path is always visible - the member's right [KIT].
4. **Confirmation step:** step-up confirmation to **contact details on file**, and the UI shows when those details last changed [KIT]. If email/phone changed in the last N days [PROPOSED N=7], the confirmation goes to the **pre-change** contact details and the UI says why (this is the M1003 lesson; see section 16).
5. **Second Look chat:** grounded in the actual case signals (and optional email evidence, section 10). It asks voluntary questions, quotes the evidence it used, says what it cannot tell, suggests independent verification (call the family member on the number you already had; walk into a branch; type soundcu.org yourself). It never sends messages, never moves money, never clicks anything, never calls anyone. Tone: "You decide. Here is what I'd double-check first."
6. **Trusted contact:** enrollment is voluntary, revocable, member-directed [KIT]. The member picks the person and what triggers a notification. The contact is **informed, never given account access, never given control**. The copy must allow for the possibility that the exploiter is a relative or caregiver [KIT guardrails] - e.g. "choose someone who is not involved in the payment."
7. **Recovery:** "Report a scam" button on every case and in Settings: creates a case, starts a recovery request (wire recall / ACH return - "possible, not guaranteed, faster is better" [KIT]), and shows official reporting routes (FTC, IC3).

## 5. Employee console

The employee side is what makes this preventive [USER]. Mobile-responsive web console, second device/tab in the demo.

1. **Risk queue:** held payments and open cases, sorted by time-in-hold (the 4-hour clock is the SLA), with member, amount, rail, top signals, and a live countdown. After-hours holds are flagged (a kit metric: "after-hours holds waiting for review").
2. **Case detail:** payment timeline from the event engine, the triggered rules with their field evidence (not a bare score), member history comparison (baseline amount, days since last same-rail payment, recipient age), profile-change/password-reset recency, trusted-contact enrollment status, prior cases, and the member's chat/Q&A answers if they chose to share them (consent flag).
3. **Actions (all simulated, all audited):** place hold; release hold; outreach (guided call script with scam-specific questions); escalate to case; **stop payment (ATO only - the console blocks this action for member-authorized payments and shows the rule)**; request trusted-contact notification (only if enrolled; the message is informational, includes no account access); recovery request. Every action writes an audit row with actor, time, reason.
4. **Conversation guide [KIT "Employee conversation"]:** for each scenario family, 3-4 plain questions ("Can you tell me who asked you to make this payment, in your own words?"), red-flag answer cues (secrecy, coaching, a second person on the line), and a non-judgmental script for telling a member you believe they are being manipulated while respecting their decision.

## 6. Data used (kit fields only)

Detection reads only fields in `data/HuskyHack_Synthetic_Events_v2.csv` [KIT]: amount, timestamp, channel, rail, `recipient_status` / `recipient_age_days` (new-recipient), `days_since_last_same_rail`, `amount_to_baseline_ratio`, `amount_vs_member_baseline`, `payment_velocity_band`, `available_balance_after`, `profile_change_recent`, `password_reset_recent`, `trusted_contact_enrolled`, `payment_status`, plus event types (Recipient Added, Password Reset, Email/Phone Change, Failed Login, Warning Displayed, Branch Visit, Contact Center Call, etc.).

**No answer-key leakage (hard rule):** `data/HuskyHack_Member_Key_v2.csv` is the answer key. It is used only to pick story anchors and to illustrate outcomes on slides - never as a runtime input, never to label training data, never read by the detection engine. Detection rules may use only information available at or before the event being scored (no future events, no outcome columns). Write a unit test that the engine's input row set for a payment contains no later timestamps.

## 7. Payment state machine (the enforceable simulation)

Rails and statuses come straight from the kit (`payment_rail`: Wire, ACH, P2P, External Transfer, Cash, Bill Pay, Debit Card; `payment_status`: Pending, Held, Completed, Cancelled by Member, Stopped by Sound).

```
INITIATED (Pending)
  -> scored by detection engine
  -> CLEAR: Completed
  -> WARN (low concern, member-authorized): warning screen -> member confirms -> Completed
     (M1037 path: must stay this fast - see section 16)
  -> HOLD (wire / ACH / external transfer only): Held, employee notified, 4-hour clock starts
       -> member confirms legitimate (with step-up confirmation): Released -> Completed
       -> member cancels: Cancelled by Member
       -> member reports scam: Cancelled + Case Created + optional Recovery Request
       -> employee outreach -> member's decision governs (authorized payment: Sound delays
          and advises, the member decides [KIT])
       -> hold expires at exactly 4 hours. The kit caps the pause at 4 hours but does NOT
          say what happens at expiry, so the disposition is [PROPOSED], configurable, and
          must be validated with Sound before any production use:
            * member reconfirmed "proceed" before expiry -> execute at expiry
            * member unreachable or undecided at expiry -> payment returns unsent (no
              indefinite hold), member is notified and can resubmit whenever they are
              ready; the case stays open and the queue flags it
  -> STOP (only after ATO review/verification per section 9 rule R2 - the demo scripts this as a premise): Stopped by Sound + account-recovery flow
  -> P2P: no hold state - intervention is the pre-submit WARN/confirmation screen only,
     because P2P cannot be recalled once sent [KIT]
  -> CASH (branch, large): no timer state - the intervention is the branch employee
     conversation + escalation path (M1004: pause stopped a $7,000 withdrawal [KIT])
```

The engine enforces this: a Held payment cannot transition to Completed except through Release or hold-expiry; a Stopped payment can never complete; a P2P payment skips Held entirely. Unit-test every transition.

## 8. Alert policy and threat priority (the answer to alert fatigue) [PROPOSED policy, explicitly an assumption to validate in the 90-day pilot - not a measured or proven score]

**Three presentation tiers, chosen by evidence and imminence:**

- **T0 Quiet (default):** no interruption. The item sits in the member's Second Look inbox with its evidence. Most findings land here, including weak or single-signal email findings. Nothing is hidden: the inbox badge counts new items, but the phone stays silent.
- **T1 Contextual banner:** shown in place, next to the thing it concerns (section 4.2), with "Talk to Second Look" one tap away. Used when evidence is real but no money is moving right now: e.g. a new-recipient pattern forming, a manipulation-pattern email the member opened a case for, a growing P2P series (R3). The banner speaks about the **evidence and the request**, never about the person ("this request asks for secrecy and a wire today" - not "this sender is a scammer").
- **T2 Urgent interruption (push/alert):** only for **immediate money or account risk**: a payment is being initiated or is sitting in a hold (R1/R2/R4 fired), an ATO cluster is active, or a T1 case changes materially while a payment session is open. T2 is the only tier allowed to buzz the phone.

**Priority ranking (evidence-grounded, explainable):** an item's priority is derived from three transparent factors, each shown to the member and employee - never a black-box score:
1. **What is being asked** (the request dimension): moving money (wire/cash/new-rail), credentials or one-time codes, secrecy, urgency/deadlines, blocking verification, gift cards/crypto. Requests that touch money or access rank above requests that only talk.
2. **Who is asking** (the identity dimension): brand-new recipient or first-time sender vs an established thread/recipient, display-name vs address mismatch, lookalike domain, relationship claims ("your grandson") with no corroborating history.
3. **Imminence:** is a payment session open, is a hold counting down, did amounts or recipients just escalate. Imminence is what can lift an item from T1 to T2.
Every promotion in tier must be traceable to specific evidence items ("promoted because: wire initiated 7 min after recipient added + amount 4.77x baseline"). If you cannot name the evidence, the item stays quiet. State in the pilot plan that these factors and thresholds are assumptions to be validated, not validated detectors.

**Budget, dedupe, cooldown, re-alert:**
- One case per situation: dedupe by (member, thread or recipient or payment) so 12 emails from the same scammer are one case that accumulates evidence, not 12 alerts.
- Notification budget [PROPOSED]: at most **1 T2 interruption per member per day** and at most **3 T1 banners per member per week** outside an active payment session; anything beyond lands in T0. During an active payment session the relevant banner always shows (that is context, not an interruption).
- Cooldown: once the member dismisses or overrides a case, no re-alert on it unless something **materially changes**: new evidence type, higher amount, new recipient, a payment initiated, or a rule newly firing. Material change re-alerts once, then the cooldown applies again.
- Member control: sensitivity setting ("fewer / standard / more alerts"), quiet hours honored for T1/T2 unless a payment is actively held, and a visible count of recent alerts with a "why did I get this?" explainer on each.
- **Budget and quiet hours govern member interruptions only - never the intervention machinery.** They must not suppress: the banner/checkpoint inside an active payment session (always shown), any employee-side queue item, SLA countdown, outreach task, or escalation, and the held-payment 4-hour expiry path. A held payment can never be left silently stuck because the member is in quiet hours: the hold clock runs, the employee queue shows it, and expiry releases it on time.
- False-positive cost is designed to be near zero: a T1 banner is dismissed in one tap with no consequence, and dismissal is recorded as member feedback shown back to them ("you marked this fine"), never as silent model training.

**Rendering honesty:** banners render only in surfaces we control in the demo - the Sound app mock, the Second Look inbox, and case/message views. We cannot inject banners into Gmail's or any provider's own UI, and no surface outside the demo is modified. The email module (section 10) therefore feeds T0/T1 items into the Second Look inbox and attaches evidence to a related payment case when one exists; it does not push per email.

## 9. Detection triggers [PROPOSED thresholds - tune on data, not on the key]

Deterministic, explainable rules over section-6 fields. Each rule returns the field evidence it matched; the UI shows the evidence, never a bare score.

**Value handling (hard rule):** the CSV uses canonical, case-sensitive labels. Normalize every compared value to these exact labels before matching - never lowercase-contains or partial matching. Canonical sets: `recipient_status` in {New, Existing, Not Applicable}; `profile_change_recent`, `password_reset_recent`, `trusted_contact_enrolled` in {Yes, No}; `amount_vs_member_baseline` in {Typical, Above Typical, Significantly Above Typical, Not Applicable}; `payment_velocity_band` in {Low, Medium, High, Not Applicable}; `payment_rail` in {Wire, ACH, P2P, External Transfer, Cash, Bill Pay, Debit Card}; `payment_status` in {Pending, Held, Completed, Cancelled by Member, Stopped by Sound}.

**Rail-specific outputs (must match the section 7 state machine):** a rule never just "fires" - it fires with the output its rail allows: Wire / ACH / External Transfer -> HOLD (max 4 hours). Cash -> no timed hold exists; the output is the branch employee conversation + escalation path (M1004's pause). P2P -> never held (cannot be recalled once sent [KIT]); the output is the pre-submit T1 banner/confirmation step only.

- **R1 Family-emergency shape (Wire only)** (anchor M1001 Linda): `recipient_status == New` AND `payment_rail == Wire` AND (`days_since_last_same_rail >= 365` OR no prior same-rail payment exists) AND `amount_to_baseline_ratio >= 3.0` -> HOLD. Linda's actual values clear these with margin (recipient New; 2,411 days; ratio 4.77). **Designed false positive:** R1 also catches M1057, a legitimate look-alike (home-purchase closing wire: $51,586.52, recipient New, ratio 42.63, held by an amount rule and released after a callback about 3-4 hours later [Member Key]). That catch is expected and must be visible in the demo: the answer is the fast confirmation + release path and quick employee outreach, not a looser rule. Do not tune R1 upward just to miss M1057 - document the catch.
- **R2 ATO cluster** (anchor M1003 Sarah): (`password_reset_recent == Yes` OR `profile_change_recent == Yes`) AND a `Recipient Added` event AND a payment initiated within 7 days [PROPOSED window] of the reset/change -> route to immediate review, pause the payment meanwhile, and step up confirmation to **pre-change** contact details (the kit's own intervention candidate for M1003). The kit allows Sound to stop a payment outright in account takeover [KIT], but this heuristic pattern alone does not prove a takeover - treat it as an unconfirmed signal that routes to verification and employee review, never as a confident identification of unauthorized activity. The demo's stop beat is a scripted premise showing the allowed power; the production-shaped flow is verify-first, and the UI copy says so.
- **R3 Escalating pattern** (anchor M1002 Michael): >= 3 P2P payments to the same `recipient_status == New` recipient within 30 days with strictly increasing amounts, followed by a first-ever Wire to any recipient -> T1 banner + pattern-aware warning + human outreach without blame; each later payment re-triggers with the history attached to the same case (section 8 dedupe).
- **R4 Branch cash** (anchor M1004 James): `payment_rail == Cash` AND `channel == Branch` AND (`amount_to_baseline_ratio >= 3.0` OR `amount_vs_member_baseline` in {Above Typical, Significantly Above Typical}) AND a Contact Center Call or Branch Visit about limits within the prior 30 days [PROPOSED window] -> branch employee conversation + scam-specific questions + trusted-contact option. No timer: the employee is the intervention.

**Look-alike duty [KIT]:** run the same rules over the 20 members with `is_legitimate_lookalike = Yes` in the Member Key (lookup allowed only to *measure* how many look-alikes a proposed rule would catch during development, then document the count honestly - never as a runtime input). Every look-alike a rule catches needs the fast, respectful path through (one confirmation, quick release, done). Report the catch count per rule in `DECISIONS.md`; prefer rules that catch fewer. Known expected catch: R1 catches M1057 (above).

## 10. Optional module: consented email companion (stretch - cut first)

The earlier concept (a member-side companion that watches the member's own email for manipulation patterns and alerts their phone) survives as an **optional signal source**, not the product. It is optional in both directions: the member can use Second Look without it, and it adds evidence to Sound-side cases only with explicit member consent.

- [USER] The user firsthand reported organizers/judges clarified **own first-party collected data is allowed**; this is accepted for design. It is not in any written file - keep the source distinction on the privacy slide, and present the module as a **member-side companion on a team-owned test inbox with explicit consent, not a Sound capability**. Do not claim Sound can read member email.
- If built, reuse the prior validated design: Gmail read-only OAuth (`gmail.readonly` only, Testing mode, 100 test users, 7-day token expiry), polling ingest with strict connected-at cutoff, transactional dedupe, untrusted-content handling, LLM analysis with the evidence validator (every quote an exact substring of parsed subject/body; auth headers always reported "unknown"), security chat with hard no-action limits, disconnect-deletes-everything. `fixtures/emails.json` (8 authored simulated emails: 4 risky incl. one prompt-injection test, 4 benign/weak) supports it.
- **Notification behavior follows section 8, not the old push-per-message model:** email findings default to T0 (quiet inbox item) or T1 (banner inside the Second Look surfaces only - Gmail's own UI cannot be modified); T2 push only when the email case is linked to an active payment or ATO risk, within the daily budget, deduped per thread into one accumulating case. PWA Web Push on iOS 16.4+ (Home Screen app, user-gesture permission, content-safe payloads) is the T2 transport.
- Email evidence lands on the Sound-side case as an extra signal chip ("member shared email evidence: secrecy + urgency patterns, quotes validated") - it never alone triggers a hold [PROPOSED], and it never overrides section 6 (transaction signals are the primary trigger).
- WhatsApp/Telegram remain out of scope: they cannot read a member's private chats; a bot sees only chats with itself (Telegram) or a business messaging window (WhatsApp Cloud API). Do not promise them.

## 11. Live vs mock (be explicit in UI and pitch)
| Piece | Real in the demo | Simulated/mock |
|---|---|---|
| Member app | Working web app, real click-through | A concept mock of Sound's app - not Sound software |
| Payment engine | State machine enforced in SQLite over kit events | No real money, accounts, or rails |
| Holds / releases / stops | Really change demo payment state | Affect nothing outside the demo |
| Detection | Real rules over kit event fields | Thresholds are proposals, not validated models |
| Chat | Real LLM with hard limits | Not a validated coaching tool; no efficacy claims |
| Employee console | Working web app with enforced actions | Actors are demo roles, not Sound staff |
| Email module (if built) | Real Gmail read-only + real push on a team-owned inbox | Fixtures are authored simulated emails |
Never present simulated enforcement as real banking power, and never present alert-only features (chat, email flags) as if they block payments.

## 12. Data models (SQLite)
```
members(id, synthetic_member_id, display_name, baseline_amount, trusted_contact_json, second_look_enrolled)
payments(id, member_id, kit_payment_id, rail, amount, recipient_id, recipient_age_days,
         status 'Pending|Held|Completed|Cancelled by Member|Stopped by Sound',
         initiated_at, hold_started_at, hold_expires_at, released_by, release_reason)
events(id, member_id, kit_event_id, ts, event_type, channel, payload_json)   -- replayed kit rows
cases(id, member_id, payment_id, trigger_rule, trigger_evidence_json, status, created_at, closed_at)
case_actions(id, case_id, actor 'member|employee|system', action, detail, ts)
chat_messages(id, case_id, role, text, ts)
employee_sessions / member_sessions (demo role switch - see section 13)
audit_log(id, ts, actor, action, detail)
```
The replay engine loads one member's kit rows into `events` in time order and plays them on a compressed clock (e.g. 1 kit-day = 20 seconds [PROPOSED]) so the demo shows a journey in minutes.

## 13. Auth, sessions and access control
- The demo uses a labeled **demo role switch** ("View as: Member / Employee") instead of real credentials - this is honest about what it is. Production expectations go in the handoff and the feasibility slide: Sound SSO for employees, least-privilege roles (front-line vs fraud team), full audit of every hold/release/stop, member actions behind Sound's normal member authentication [PROPOSED].
- Even in the demo, keep the section-3.1 discipline for anything that accepts input: CSRF token on state-changing requests, Origin checks, HttpOnly session cookie, no `caseId`-only access (every route filters by the session's role+member), `/dev` routes off in production config.
- If the email module is built, it keeps its own stricter spec (OAuth-created server sessions, state+PKCE, per-account filtering, disconnect cancels in-flight jobs then revokes and deletes everything).

## 14. Build order (timeboxed; keep a demoable app at every step)
1. (25 min) Repo scaffold, SQLite schema, event loader for the kit CSV, replay engine clock. `npm run replay -- --member M1001` prints Linda's timeline.
2. (30 min) Payment state machine + detection rules R1-R4 + unit tests (transitions; no-future-data test).
3. (30 min) Member app: Sound-style shell, enrollment toggle, payment flow with WARN screen, hold notice with countdown, override, chat.
4. (30 min) Employee console: risk queue with countdowns, case detail, actions with audit log, R2 stop blocked for authorized payments.
5. (20 min) M1037 fast path + look-alike measurement script; `/about` one-pager (required - see section 15).
6. (15 min) Demo script polish, accessibility pass, README, `DECISIONS.md`.
7. Stretch only: email module (section 10) behind a feature flag.
**Minimum for the 3:00 deadline: steps 1-5.** Everything else is labeled or cut. Do not promise a finish time to anyone; just build in this order.

## 15. Screens
1. Member: Sound-style home with "Second Look" section; enrollment toggle; payment flow (recipient setup, amount) with contextual warning; hold notice (countdown, options, override); confirmation step; case detail with evidence and "what we can't tell"; chat; trusted-contact enrollment; "Report a scam"; settings (turn off, data used, privacy text).
2. Employee: risk queue; case detail with conversation guide; action bar with audit.
3. `/about`: the required one-pager (concept, trigger, intervention, data used, role of people, false-positive path, 90-day pilot, privacy/accessibility, limits). **The one-pager is mandatory**: it was confirmed from an earlier Devpost report (it is not listed in the kit files), so treat it as required.
4. `/dev`: replay controls (member picker, speed, jump to event), rule-tuning view, force states. Off in production config.

## 16. Demo script (5 min) [PROPOSED]
1. **Anchor: M1001 Linda** [KIT facts, read directly from the kit]: both payments happened **in branch** - a $8,500 wire (recipient added in branch at 14:04, initiated 14:11, held 14:21, trusted contact offered and declined, employee outreach at 15:42 where she confirmed intended - the member's right - released 17:04) and a next-day $4,250 cash request that was escalated and **cancelled by Linda** after the second "bail" ask raised the alarm; scam reported, case created, wire recall requested, recovery unsuccessful. Net loss $8,500 [Member Key].
   - **Replay as-is** in the engine: state the facts only - the wire was held at 14:21, outreach happened at 15:42, Linda confirmed intended, and it released at 17:04; the next-day cash request was the payment that was stopped. Do not diagnose why the first wire still went through.
   - **Hypothesis, not conclusion:** "Our hypothesis is that attaching the evidence to the hold and starting a guided conversation earlier could change what a member decides. The demo shows that design; the pilot is how you'd measure it."
   - **Replay with Second Look**: the R1 rule fires at payment initiation (2,411 days since her last same-rail payment, brand-new recipient, amount 4.77x her baseline - the kit's own event fields), the hold goes up **with** the evidence attached, and the employee console has the conversation guide the moment the hold lands instead of a generic outreach at 15:42, the member chat asks the secrecy question, and Linda cancels the wire herself. Keep her override one tap away the whole time - say that out loud.
1b. **The quiet default:** open the Second Look inbox - several items sit silently at T0, one case has accumulated 12 messages from the same scammer with one banner. Say it plainly: "we do not interrupt you for every suspicious message. We show you, in place, when it matters."
2. **Restraint case: M1037** [KIT]: legitimate urgent $1,188.37 P2P to a grandchild's new account (college housing). The amount was typical for that member (1.14x baseline); only the new recipient stood out. Say it honestly: **R1 does not fire here** - P2P, typical amount - and that restraint is the point. What M1037 gets is the standard new-recipient T1 banner (the kit's real outcome was a generic new-recipient warning, member confirmed, completed in ~2 minutes): one confirmation, done in under a minute.
2b. **Same-trigger false positive: M1057** [KIT]: legitimate home-purchase closing wire, $51,586.52, brand-new wire recipient, 42.63x baseline - R1 fires exactly as designed, and in the kit's real outcome this member was held by an amount rule and released after a callback about 3-4 hours later. Show the designed answer live: hold with evidence, immediate employee outreach from the queue, member confirms, release - target minutes, not hours. This is the false-positive path the judges asked for, on the same trigger as Linda, shown not claimed.
3. **R2 ATO beat (M1003 Sarah, if time):** password reset + profile change + new recipient -> payment paused, routed to review, confirmation sent to **pre-change** contact details; in the scripted beat the review confirms takeover and the payment is **stopped**. Label it: "the pattern routes to verification - it doesn't prove a takeover by itself; the stop here is a scripted premise showing the power the kit allows." Contrast with authorized payments: "for your own payment, you decide; for a verified takeover, Sound stops it."
4. Pilot + limits slides (sections 16, 17).

## 17. 90-day pilot [KIT requirement; assumptions stated, no fraud-rate claims]
- Setup: opt-in offered to a defined member segment (e.g. new enrollees + members 60+ who opt in - never restrict by age alone [KIT]); branch and contact-center staff trained on the conversation guide; fraud team owns the queue.
- Baselines (state as assumptions, not data): expected opt-in rate, expected hold rate per 1,000 payments, average hold-to-release time, staff minutes per held payment. The synthetic data is 41% victims by design and must not anchor any rate [KIT].
- Targets (from the kit's suggested measures): dollars of harm prevented; scam completion reduced; recovery initiated sooner; warning completion; member satisfaction; false-positive rate; time from hold to release for legitimate members (target: minutes, matching the M1037 experience); time to intervention; employee effort per case; escalation and case quality; after-hours holds waiting for review.
- Ethics checkpoints: override rate monitored (high override = friction or over-triggering), complaint rate, accessibility review, quarterly rule audit against look-alike catch counts.

## 18. Privacy, accessibility, responsible design [KIT]
- Use only the data necessary for the intervention (section 6 list - nothing more). No device intelligence, behavioral biometrics, voice analysis, carrier data, consortium feeds, or members' personal calls/texts/email/browser/social activity [KIT]. The optional email module is the member's own first-party choice, not a Sound capability (section 10).
- Dignity and autonomy: member-authorized payments end with the member's decision; copy is calm and non-judgmental; no demographic-based restrictions [KIT].
- Trusted contacts: voluntary, revocable, member-directed; informed, never in control; copy acknowledges the exploiter may be a relative or caregiver [KIT].
- Accessibility: plain language at a low reading level, large type, high contrast (AA), screen-reader labels, 44px targets, no jargon, works for limited digital experience (a core vulnerability in the kit's own framing).
- Responsible claims: this is a concept demo on synthetic data. No detection-accuracy claims, no fraud-rate claims, no promise that any pattern means a scam, no "safe" verdicts. The one-pager is required (see section 15).

## 19. Acceptance tests
- A1 State machine: Held payments leave Held only via member/employee release, member cancellation, stop, or the configured expiry disposition - expiry executes only on a recorded member reconfirm, otherwise returns the payment unsent with notice (never auto-sends, never holds past 4 hours); Stopped never completes; P2P can never enter Held; every transition audited. Unit tests.
- A2 Detection: R1 fires on M1001's wire at initiation (not after); R2 routes M1003's cluster to review + pre-change confirmation with the payment paused (stop occurs only in the scripted ATO demo beat, labeled as such); R4 fires on M1004's cash attempt with the conversation output (no timed hold on Cash); R1 also fires on M1057's legitimate closing wire (expected catch) and the demo release path completes in minutes; **M1037's P2P is never held** - standard new-recipient banner at most, one confirmation, done. Rail outputs match the state machine: P2P can never enter Held, Cash never gets a timer.
- A2b Value hygiene: rule comparisons use the canonical CSV labels after normalization (unit test: a row with `recipient_status == New` matches; lowercased or partial variants do not silently match or silently miss).
- A3 No key leakage: engine input rows for any scored payment contain only that member's events with timestamps <= the payment's initiation; Member Key file is never opened by the app (grep test + import ban).
- A4 Employee actions: stop-payment is blocked for member-authorized payments with the rule shown; release requires a reason; every action in `audit_log`.
- A5 Member autonomy: override reachable in <= 2 taps from the hold notice; cancel reachable in 1; copy contains no shaming language (checklist review).
- A6 Trusted contact: notification action unavailable when not enrolled; message preview contains no balances/credentials; enrollment revocable in settings.
- A7 Replay honesty: Linda replay uses only kit rows (spot-check 3 timestamps against the CSV); "with Second Look" replay is labeled a proposed alternative, not a historical claim.
- A8 Look-alike measurement: script reports how many of the 20 look-alikes each rule catches; the count is in `DECISIONS.md`.
- A9 Accessibility: VoiceOver reads the hold notice and actions; text scales; contrast AA.
- A10 If email module built: fixtures fx01-fx03, fx08 flag as expected (behavior checks, not accuracy); evidence validator drops non-substring quotes; disconnect deletes token, bodies, cases, devices, jobs with no post-revoke sends; benign fixtures land in T0 with no push.
- A11 Alert policy: 12 messages from one scammer produce one case and at most one interruption; T2 respects the daily budget and quiet hours (active hold excepted); a dismissed case re-alerts only on material change (unit-test each trigger type); every tier promotion names its evidence; banner copy never calls a person malicious (snapshot test on the copy strings).

## 20. Open decisions for the owner
1. Whether the enrollment screen appears during onboarding, in Settings, or both (handoff proposes both) [USER asked for "maybe one or the other" - present both in the demo toggle].
2. Rule thresholds (baseline ratio, recipient-age window, reset-to-payment window) - proposals only.
3. Whether to spend time on the email module before Sunday (recommend: only after steps 1-6 are stable).
4. LLM provider/key for the chat.
5. Who plays the employee role in the live demo.

## 21. Run basics
`npm i && npm run dev` (member app on :8787, console on :8787/employee); `npm run replay -- --member M1001` for the timeline; `npm test` for state machine + rule tests + no-key-leakage test; `npm run lookalikes` for the catch-count report; `/dev` behind `ADMIN_PIN`, off in production config.

Kit facts above (event vocabulary, payment statuses, M1001 timeline and outcome, M1037 description, capability assumptions) were read directly from the kit files in this package: starter kit, problem statement, events CSV (7,471 rows, 118 synthetic members), Member Key (answer key - story and illustration only, never a runtime input), data dictionary.
