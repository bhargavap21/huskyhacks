// Second Look demo UI. Plain JS; polls /api/state and renders the member app + employee console.
const openDet = new Map();
let S = null, csrf = '', page = 'home', selCase = null, chatCase = 'general', chatLog = [], showMore = {}, busy = false;
// Shell state: left page list and right Second Look copilot, both collapsible and remembered per browser.
const stored = k => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const narrow = () => matchMedia('(max-width: 900px)').matches;
let sideCollapsed = stored('sl-side') === '1', copilotOpen = narrow() ? false : stored('sl-copilot') !== '0';
const MEMBER_PAGES = ['home', 'inbox', 'guardian', 'email', 'settings', 'onboarding', 'profile'];
// Demo-only sign-in, per tab: a cold visit starts signed in so links and scenes never hit a gate.
const sess = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const sessSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };
let signedIn = sess('sl-signed-in') !== '0', obStep = 0;
// Home shows a 'Finish setting up' card until setup is finished or dismissed in this tab.
let setupDone = sess('sl-setup') === '1';
const markSetupDone = () => { setupDone = true; sessSet('sl-setup', '1'); };
// The chat follows a held payment until the member picks "Something feels off" themselves.
let chatAuto = true;
// A phone that joined by QR code shows only the member app, full screen.
let joined = sess('sl-joined') === '1';
// Chat: the + menu, and chats where the member already answered the sharing prompt.
let plusOpen = false, outcomeSel = '', blurbSeen = new Set(); const shareAnswered = new Set();
// Composer icons (inline SVG, colour from the button).
const svg = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = { chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'), plus: svg('<path d="M12 5v14M5 12h14"/>'), mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'), up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>') };
// Attachments waiting in the composer (photos, PDFs, voice notes) and the voice note being recorded.
let pendingAtt = [], rec = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hm = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };

// role=status: screen readers announce toasts.
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 4200); }

async function post(path, body = {}) {
  if (busy) return; busy = true;
  try {
    const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf': csrf }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) toast(j.error || 'That did not work');
    return j;
  } finally { busy = false; await poll(); }
}

async function poll() {
  const r = await fetch('/api/state'); S = await r.json(); csrf = S.csrf;
  const held = chatAuto && chatCase === 'general' && S.awaiting && S.payments.find(p => p.pid === S.awaiting);
  if (held && held.case_id && caseById(held.case_id)) { chatCase = held.case_id; chatLog = await (await fetch('/api/chat/' + chatCase)).json(); }
  render();
}

// Keep typed input and focus across re-renders (focus is matched by id, or by action + target).
function keep(fn) {
  const a = document.activeElement, vals = {};
  const key = a && (a.id ? '#' + a.id : a.dataset && a.dataset.act ? `[data-act="${a.dataset.act}"]${a.dataset.pid ? `[data-pid="${a.dataset.pid}"]` : ''}${a.dataset.case ? `[data-case="${a.dataset.case}"]` : ''}` : null);
  document.querySelectorAll('[data-keep]').forEach(el => (vals[el.id] = el.value));
  fn();
  for (const [k, v] of Object.entries(vals)) { const el = document.getElementById(k); if (el) el.value = v; }
  if (key) { const el = document.querySelector(key); if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); } }
}

// Only rebuild when something other than the clock changed; clock and countdowns update in place.
let lastKey = '';
function structuralKey() { const { sim, sim_text, csrf: _c, ...rest } = S; return JSON.stringify([rest, page, selCase, chatCase, chatLog.length, pendingAtt.length, !!rec, showMore, sideCollapsed, copilotOpen, signedIn, obStep, setupDone, joined, plusOpen, outcomeSel]); }
function tickText() {
  $('#clock').textContent = S.sim_text;
  document.querySelectorAll('[data-expires]').forEach(el => { const t = hm(Number(el.dataset.expires) - S.sim); el.textContent = t; el.setAttribute('aria-label', 'Time left ' + t); });
}

function render(force = false) {
  if (!S) return;
  const k = structuralKey();
  if (!force && k === lastKey) return tickText();
  lastKey = k;
  const sel = $('#scene');
  if (!sel.options.length) sel.innerHTML = S.scenes.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
  sel.value = S.scene.id;
  $('#play').textContent = S.running ? 'Pause' : (S.ended ? 'Ended' : 'Play');
  $('#play').disabled = S.ended;
  $('#next').disabled = !!S.awaiting || S.ended;
  $('#clock').textContent = S.sim_text;
  $('#speed').textContent = S.awaiting ? '(hold clock at 60×: 4 h ≈ 4 min)' : `(${Math.round(S.speed)}×)`;
  // Scene note: open the first time a scene is shown, folded once you move on.
  $('#blurb').innerHTML = det('blurb-' + S.scene.id, 'About this scene', `<p>${esc((S.mode === 'as_is' ? 'Kit replay, as it happened. ' : 'With Second Look (proposed design). ') + S.scene.blurb)}</p>`, !blurbSeen.has(S.scene.id));
  const shell = $('#shell');
  shell.classList.toggle('side-collapsed', sideCollapsed);
  shell.classList.toggle('copilot-closed', !copilotOpen);
  $('#side-toggle').setAttribute('aria-expanded', String(!sideCollapsed));
  $('#side-toggle').setAttribute('aria-label', sideCollapsed ? 'Expand page list' : 'Collapse page list');
  $('#copilot-toggle').setAttribute('aria-expanded', String(copilotOpen));
  $('#copilot-toggle').innerHTML = `${ICON.chat}<span class="lbl">${copilotOpen ? 'Hide chat' : 'Ask Second Look'}</span>`;
  document.body.classList.toggle('joined', joined);
  if (joined && !MEMBER_PAGES.includes(page)) page = 'home';
  document.querySelectorAll('[data-page]').forEach(b => b.dataset.page === page ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  // Account button at the bottom of the page list (member identity, sign-in state).
  const m = S.member;
  $('#acct-initial').textContent = signedIn ? m.name.trim()[0].toUpperCase() : '?';
  $('#acct-label').textContent = signedIn ? m.name : 'Signed out';
  $('#acct-name').textContent = signedIn ? `${m.name} · ${m.id}` : 'Signed out of the demo';
  $('#acct-sign').dataset.act = signedIn ? 'sign_out' : 'sign_in';
  $('#acct-sign-lbl').textContent = signedIn ? 'Sign out' : `Sign in as ${m.name} (demo)`;
  $('#acct-btn').classList.toggle('current', ['profile', 'settings'].includes(page));
  const openCases = S.cases.filter(c => c.status === 'open').length;
  $('#count-console').textContent = openCases + S.callbacks.filter(x => x.status === 'waiting').length || '';
  $('#count-inbox').textContent = S.cases.length || '';
  keep(() => { $('#page').innerHTML = pageView(); $('#copilot-body').innerHTML = !copilotOpen ? '' : signedIn ? chatView() : '<p class="copilot-signedout small muted">Sign in to the Sound app to ask Second Look.</p>'; });
  const cs = $('#chatscroll'); if (cs) cs.scrollTop = cs.scrollHeight;
  tickText();
}

/* ---------------- Pages ---------------- */
const TABS = [['home', 'Home'], ['inbox', 'Alerts'], ['ask', 'Ask'], ['profile', 'Profile']];
const joinedTabs = () => joined && signedIn ? `<nav class="joined-tabs" aria-label="Sound app">${TABS.map(([k, l]) => k === 'ask' ? `<button data-act="ask">${l}</button>` : `<button data-page="${k}" ${page === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>` : '';
const phone = body => `<section class="phone" aria-label="Member app (concept mock of the Sound app)"><div class="app-head"><b>Sound</b><span class="small">Concept mock</span></div><div class="app-body">${body}</div>${joinedTabs()}<p class="footnote">Concept mock of the Sound app, not Sound software. Synthetic kit data; holds and releases change only this simulation.</p></section>`;
function timelineCard(openByDefault) {
  const tl = S.timeline.slice().reverse();
  return `<div class="card">${det('kit-tl', `Kit timeline, ${S.mode === 'as_is' ? 'as it happened' : 'with Second Look'} <span class="muted small">(${tl.length} events${tl[0] ? ` · latest ${esc(tl[0].ts_text.split(' ')[1])}` : ''})</span>`, `<div class="timeline">${tl.map(t => `<div class="${t.kind}">${esc(t.ts_text)} · ${esc(t.text)}</div>`).join('') || '<div class="muted">Press Play to start the replay.</div>'}</div>`, openByDefault)}</div>`;
}
function pageView() {
  if (MEMBER_PAGES.includes(page)) return `<div class="page-member">${phone(memberView())}</div>`;
  if (page === 'console') return `<div class="employee">${employeeView()}</div>`;
  if (page === 'timeline') return `<div class="page-timeline">${timelineCard(true)}</div>`;
  return `<div class="grid">${phone(memberView())}<section class="employee" aria-label="Employee console">${employeeView()}</section></div>`; // split
}

/* ---------------- Member app ---------------- */
const caseById = id => S.cases.find(c => c.id === id);
const payOf = c => S.payments.find(p => p.pid === c.pid);
const plainEvidence = c => `<ul>${c.evidence.map(e => `<li>${esc(e.why)}: <b>${esc(e.value)}</b></li>`).join('')}</ul>`;

function memberView() {
  if (!signedIn) return signInView();
  if (page === 'onboarding') return onboardingView();
  if (page === 'profile') return profileView();
  if (page === 'settings') return settingsView();
  if (page === 'inbox') return inboxView();
  if (page === 'guardian') return guardianView();
  if (page === 'email') return emailView();
  return homeView();
}

function homeView() {
  const m = S.member;
  let out = `<div class="card"><div class="muted small">Welcome back</div><h2>${esc(m.name)}</h2>
    <div class="row small"><span class="in-badge in-badge--neutral">Second Look: ${m.enrolled ? 'On' : 'Off'}</span>${S.mode === 'as_is' ? '<span class="in-badge in-badge--neutral">Kit replay: Second Look not in use</span>' : ''}</div></div>`;
  if (S.notifications.length) { const n = S.notifications[0]; out = `<div class="lock" role="note" aria-label="Notification on the lock screen (simulated)"><div class="lock-app">Sound · ${esc(n.ts_text.split(' ')[1])}</div><div>${esc(n.text.replace(/^Sound: (.)/, (_, c) => c.toUpperCase()))}</div><div class="lock-cap">Simulated lock screen · no amounts or names shown</div></div>` + out; }
  const active = S.awaiting && S.payments.find(p => p.pid === S.awaiting);
  const feelsOff = `<div class="card feels-off"><h3>Something feels off?</h3><p class="small">A call, text or email asking for money or a code? Talk it through before you do anything. Second Look never moves money, and only tells Sound’s fraud team when you ask it to.</p><div class="row"><button class="primary" data-act="chat_general">Ask Second Look</button>${S.cases[0] ? `<button class="quiet" data-act="report" data-pid="${S.cases[0].pid}">Report a scam</button>` : ''}</div>
    <p class="small feels-ways">Other ways to get a second look: <button class="quiet" data-page="guardian">Bring it into a call</button> · <button class="quiet" data-page="email">Forward it an email</button></p></div>`;
  const recent = S.payments.slice(0, 4);
  const recentCard = `<div class="card"><h3>Recent payments</h3>${recent.length ? `<table><tbody>${recent.map(p => `<tr><td>${esc(p.rail === 'P2P' ? 'Payment' : p.rail)} · ${p.row.recipient_status === 'New' ? 'new recipient' : p.rail === 'Cash' ? 'branch' : 'saved recipient'}<div class="muted small">${esc(p.initiated)}</div></td><td>${usd(p.amount)}<div class="small">${esc(p.status)}</div></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No payments yet in this scene. Press Play.</p>'}</div>`;
  // While money is waiting on the member, the home screen is only about that.
  if (active) return out + activePayment(active, caseById(active.case_id)) + det('home-more', 'Everything else', feelsOff + recentCard);
  if (!setupDone) out += `<div class="card setup-card"><p class="eyebrow">3 short steps</p><h3>Finish setting up your app</h3><p class="small">Choose scam protection, how often we alert you, and an optional trusted contact.</p><div class="row"><button data-act="onboarding">Start setup</button><button class="quiet" data-act="setup_dismiss">Not now</button></div></div>`;
  out += feelsOff;
  out += `<div class="card"><h3>Recent payments</h3>${recent.length ? `<table><tbody>${recent.map(p => `<tr><td>${esc(p.rail === 'P2P' ? 'Payment' : p.rail)} · ${p.row.recipient_status === 'New' ? 'new recipient' : p.rail === 'Cash' ? 'branch' : 'saved recipient'}<div class="muted small">${esc(p.initiated)}</div></td><td>${usd(p.amount)}<div class="small">${esc(p.status)}</div></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No payments yet in this scene. Press Play.</p>'}</div>`;
  return out;
}

// Plain-language reasons from rule evidence (member) and short signal cards (employee).
const usd0 = n => Number(n) % 1 === 0 ? '$' + Number(n).toLocaleString('en-US') : usd(n);
const ago = d => d >= 730 ? `over ${Math.floor(d / 365)} years` : d >= 365 ? 'over a year' : `${d} days`;
function reasons(c) {
  const p = payOf(c), rail = p.rail.toLowerCase();
  return c.evidence.map(e => {
    const n = parseFloat(String(e.value).replace(/,/g, ''));
    switch (e.field) {
      case 'recipient_status': return { label: 'Recipient', value: 'New', plain: 'This recipient is new to you' };
      case 'days_since_last_same_rail': return isNaN(n) ? { label: `Last ${rail}`, value: 'Never', plain: `Your first-ever ${rail}` } : { label: `Last ${rail}`, value: `${ago(n)} ago`, plain: `Your first ${rail} in ${ago(n)}` };
      case 'amount_to_baseline_ratio': return { label: 'Amount', value: `≈ ${Math.round(n)}× usual`, plain: `About ${Math.round(n)}× what you usually send` };
      case 'amount_vs_member_baseline': return { label: 'Amount', value: e.value.split(' (')[0], plain: e.value.startsWith('Typical') ? 'The amount is in line with your usual' : 'Larger than you usually take out' };
      case 'event_type': return { label: e.value.split(' (')[0], value: (e.value.match(/\(([^)]+)\)/) || [])[1] || '', plain: e.why };
      case 'payment_rail': return { label: 'Payment type', value: e.value, plain: e.why };
      case 'P2P series': return { label: 'Pattern', value: 'Growing payments', plain: 'Payments to one person kept getting bigger' };
      case 'amount': return { label: 'This payment', value: e.value, plain: '' };
      default: return { label: 'Call topic', value: 'Asked about limits', plain: e.why };
    }
  });
}
const reasonList = c => `<ul class="reasons">${reasons(c).filter(r => r.plain).map(r => `<li>${esc(r.plain)}</li>`).join('')}</ul>`;
const det = (id, summary, body, dflt = false) => `<details id="${id}" ${(openDet.has(id) ? openDet.get(id) : dflt) ? 'open' : ''}><summary>${summary}</summary>${body}</details>`;

function activePayment(p, c) {
  const kind = p.rail === 'P2P' ? 'payment' : p.rail === 'Cash' ? 'cash withdrawal' : p.rail.toLowerCase();
  const talk = (primary = false) => `<button ${primary ? 'class="primary"' : ''} data-act="chat" data-case="${c.id}">Talk it through</button>`;
  if (p.status === 'Held') {
    const left = p.hold_expires_at - S.sim;
    const code = S.confirm_code && S.confirm_code.pid === p.pid ? `<div class="card"><h3>Confirm it’s you</h3><p class="small">We sent a code to your ${esc(S.confirm_code.sent_to)}. ${esc(S.confirm_code.why)}</p><p class="small muted">Demo code: ${esc(S.confirm_code.demo_code)}</p><label for="code">Code</label><input type="text" id="code" data-keep inputmode="numeric" autocomplete="one-time-code"><div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="release" data-pid="${p.pid}">Send my payment</button></div></div>` : '';
    return `<div class="banner urgent" role="region" aria-label="Payment on hold">
      <p class="eyebrow in-badge in-badge--review">On hold · nothing has been sent</p>
      <h2>Your ${usd0(p.amount)} ${kind} is paused</h2>
      <p>A few things look different from usual, so we paused it to check with you. A Sound team member will call you. If it’s right, you can still send it.</p>
      ${reasonList(c)}
      <p class="small">Paused for up to <b class="countdown-inline" data-expires="${p.hold_expires_at}">${hm(left)}</b> more.</p>
      <div class="stack">${talk(true)}
        <button data-act="request_code" data-pid="${p.pid}">It’s me, send it now</button>
        <button data-act="cancel" data-pid="${p.pid}">Cancel this payment</button></div>
      ${det('m-more-' + p.pid, 'More options', `<div class="stack" style="margin-top:var(--space-2)">
        <button data-act="callback" data-pid="${p.pid}" ${c.callback_requested ? 'disabled' : ''}>${c.callback_requested ? 'Sound will call you' : 'Ask Sound to call me now'}</button>
        <button data-act="reconfirm" data-pid="${p.pid}" ${p.reconfirmed ? 'disabled' : ''}>${p.reconfirmed ? 'It will send when the pause ends' : 'Send it when the pause ends'}</button>
        <button class="quiet" data-act="report" data-pid="${p.pid}">Report a scam</button></div>`)}
      ${det('m-next-' + p.pid, 'What happens next?', `<p class="small">We never hold a payment longer than 4 hours. If you’ve told us to go ahead, it sends then. If not, it comes back to you unsent and you can send it again whenever you’re ready. It’s always your decision.</p>`)}
    </div>${code}`;
  }
  if (p.gate === 'banner_confirm') return `<div class="banner" role="region" aria-label="Quick check">
      <p class="eyebrow">Quick check</p>
      <h2>Sending ${usd0(p.amount)} to someone new?</h2>
      <p>${c.rule === 'STD' ? 'You haven’t paid this person before. If you know them, you’re all set.' : 'A few things about this payment are worth a second look.'}</p>
      <div class="stack"><button class="primary" data-act="looks_fine" data-pid="${p.pid}">Yes, send it</button>${talk()}
      <button class="quiet" data-act="cancel" data-pid="${p.pid}">Cancel</button></div>
      ${det('m-why-' + p.pid, 'Why am I seeing this?', `${reasonList(c)}<p class="small">What we can’t tell: who you’re really dealing with. These signs often have good explanations.</p>`)}</div>`;
  if (p.gate === 'presubmit_review') return `<div class="banner urgent" role="region" aria-label="Checking it’s you">
      <p class="eyebrow">Waiting for a quick check · nothing has been sent</p>
      <h2>Let’s make sure this ${usd0(p.amount)} payment is yours</h2>
      <p>Your sign-in or contact details changed recently. We’re reaching you at the details you had <b>before</b> that change: ${esc(S.member.pre_change_contact)}.</p>
      ${reasonList(c)}
      <div class="stack">${talk(true)}<button data-act="report" data-pid="${p.pid}">I didn’t make these changes</button><button class="quiet" data-act="cancel" data-pid="${p.pid}">Cancel payment</button></div>
      ${det('m-next-' + p.pid, 'Why wait?', `<p class="small">Person-to-person payments can’t be pulled back once sent, so we check first.</p>`)}</div>`;
  if (p.gate === 'branch_conversation') return `<div class="banner" role="region" aria-label="Branch conversation"><p class="eyebrow">At the branch</p><h2>A team member will talk this through with you</h2><p>It’s a short, private conversation about this ${usd0(p.amount)} ${kind}. You decide what happens next.</p>${talk()}</div>`;
  return '';
}

function inboxView() {
  if (!S.cases.length) return `<div class="card"><h2>Alerts</h2><p class="muted">Nothing here. We stay quiet unless something is worth a second look.</p></div>`;
  return `<div class="card"><h2>Alerts</h2><p class="small muted">Things Second Look noticed, with the evidence. We only interrupt you when money is about to move.</p></div>` + S.cases.map(c => {
    const p = payOf(c);
    return `<div class="card"><div class="row small"><span class="in-badge ${c.tier === 'T2' ? 'in-badge--risk' : 'in-badge--neutral'}">${c.tier === 'T2' ? 'Needs a look now' : c.tier === 'T1' ? 'Worth a second look' : 'Quiet'}</span><span class="in-badge in-badge--neutral">${esc(p.status)}</span>${c.member_label === 'looks_fine' ? `<span class="in-badge in-badge--neutral">You marked this fine${c.label_seconds != null ? ` (${c.label_seconds}s)` : ''}</span>` : ''}</div>
      <h3>${usd0(p.amount)} ${esc(p.rail === 'P2P' ? 'payment' : p.rail.toLowerCase())} to ${p.row.recipient_status === 'New' ? 'a new recipient' : 'a saved recipient'}</h3>${reasonList(c)}
      <details><summary>Why did I get this?</summary><p class="small">${esc(c.actions.find(a => a.action === 'case_opened')?.detail || '')}</p>${c.alert ? `<p class="small">How we told you: ${c.alert.interrupt ? 'a notification, because money was about to move' : c.alert.banner_in_place ? 'a note in the payment screen only, no notification' : 'quietly, here only'}${c.alert.suppressed ? ` (${esc(c.alert.suppressed)})` : ''}.</p>` : ''}</details>
      <div class="row">${'<button data-act="chat" data-case="' + c.id + '">Ask Second Look</button>'}<button class="quiet" data-act="report" data-pid="${p.pid}">Report a scam</button></div></div>`;
  }).join('');
}

function settingsView() {
  const m = S.member, t = m.trusted_contact;
  return `<div class="card"><h2>Protection</h2>
    <div class="switch"><label for="enroll">Watch for signs someone may be manipulating me, and let a Sound employee step in before money moves</label><input type="checkbox" id="enroll" ${m.enrolled ? 'checked' : ''}></div>
    <details><summary>What we use / what we never do</summary><p class="small"><b>We use</b> the payment details Sound already has: amount, recipient, how you usually pay, recent sign-in or contact changes. <b>We never</b> read your texts, calls, email or browsing, never freeze your account, and never make a decision about your own payment for you.</p></details>
    <button class="quiet" data-act="onboarding">Run setup again</button></div>
    <div class="card"><h2>Alerts</h2><p class="small">We stay quiet unless something is worth a look. When money is about to move, we always show it in the payment screen.</p>
    <fieldset style="border:0;padding:0;margin:0"><legend class="small muted">How many alerts</legend><div class="row">${['fewer', 'standard', 'more'].map(v => `<button data-act="sens" data-v="${v}" aria-pressed="${S.alerts.sensitivity === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></fieldset>
    <div class="switch" style="margin-top:var(--space-2)"><label for="quiet">Quiet hours, 9 pm to 7 am (a paused payment still reaches you)</label><input type="checkbox" id="quiet" ${S.alerts.quiet ? 'checked' : ''}></div></div>
    <div class="card"><h2>Trusted contact <span class="in-badge in-badge--neutral">optional</span></h2>
    ${t ? `<p>${esc(t.name)} (${esc(t.relation)}) is told when a payment is paused. They never see your balances and can never act on your account.</p><button data-act="tc_remove">Remove trusted contact</button>`
      : `<p class="small">Choose someone you trust who is <b>not involved</b> in your payments. They’re only informed, never given access or control. You can remove them any time.</p>
      <label for="tcname">Name</label><input type="text" id="tcname" data-keep><label for="tcrel">Relationship</label><input type="text" id="tcrel" data-keep>
      <div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="tc_add">Add trusted contact</button></div>`}</div>`;
}

function signInView() {
  const m = S.member;
  return `<div class="card signin"><h2>Sign in to Sound</h2>
    <p>Welcome back. Second Look lives inside the Sound app, so there is no new account or password.</p>
    <div class="stack"><button class="primary" data-act="sign_in">Sign in as ${esc(m.name)} (demo)</button>
      <button data-act="sign_in_setup">First time in the app? Sign in and set up</button></div>
    <p class="small muted">Demo sign-in. The real app would use Sound’s normal member sign-in; nothing here asks for a password.</p></div>`;
}

// Setup in short steps: Second Look (with a skip), alerts, trusted contact, then a summary.
// Each choice saves right away through the same settings the Settings page uses.
function onboardingView() {
  const m = S.member, t = m.trusted_contact, A = S.alerts;
  const progress = n => `<div class="ob-progress" aria-label="Step ${n} of 3"><span class="small">Step ${n} of 3</span><div class="ob-bar">${[1, 2, 3].map(i => `<span class="${i <= n ? 'on' : ''}"></span>`).join('')}</div></div>`;
  const back = `<button class="quiet" data-act="ob_back">Back</button>`;
  if (obStep === 0) return `<div class="card ob"><p class="eyebrow">Welcome, ${esc(m.name)}</p><h2>Let’s set up your app</h2>
    <p>Three short steps: scam protection, how often we alert you, and an optional trusted contact. You can change any of it later in Settings.</p>
    <div class="stack"><button class="primary" data-act="ob_next">Get started</button><button class="quiet" data-act="ob_done">Skip setup</button></div></div>`;
  if (obStep === 1) return `<div class="card ob">${progress(1)}<h2>Turn on Second Look?</h2>
    <p>We watch for signs someone may be manipulating you, and a Sound employee can step in before money moves.</p>
    <ul class="in-ul ob-list"><li>We use payment details Sound already has: amount, recipient, how you usually pay, recent sign-in or contact changes.</li><li>We never read your texts, email or browsing on our own, and never freeze your account. We only see an email when you forward it to Second Look, and only listen to a call when you bring us in: Call guardian, adding Second Look’s number to the call, or calling it.</li><li>Your own payments stay your decision.</li></ul>
    <div class="stack"><button class="primary" data-act="ob_on">Turn on Second Look</button><button data-act="ob_skip">Not now</button></div>
    <p class="small muted">If you choose not now, it stays off and we won’t keep asking.</p></div>`;
  if (obStep === 2) return `<div class="card ob">${progress(2)}<h2>How often should we alert you?</h2>
    <p class="small">We stay quiet unless something is worth a look. When money is about to move, we always show it in the payment screen.</p>
    <fieldset class="ob-field"><legend class="small muted">How many alerts</legend><div class="row">${['fewer', 'standard', 'more'].map(v => `<button data-act="sens" data-v="${v}" aria-pressed="${A.sensitivity === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></fieldset>
    <div class="switch ob-field"><label for="quiet">Quiet hours, 9 pm to 7 am (a paused payment still reaches you)</label><input type="checkbox" id="quiet" ${A.quiet ? 'checked' : ''}></div>
    <div class="row ob-nav">${back}<button class="primary" data-act="ob_next">Continue</button></div></div>`;
  if (obStep === 3) return `<div class="card ob">${progress(3)}<h2>Add a trusted contact? <span class="in-badge in-badge--neutral">optional</span></h2>
    ${t ? `<p>${esc(t.name)} (${esc(t.relation)}) will be told when a payment is paused.</p><div class="row ob-nav">${back}<button class="primary" data-act="ob_next">Continue</button></div>`
      : `<p class="small">Choose someone you trust who is <b>not involved</b> in your payments. They’re only informed when a payment is paused, never given access or control.</p>
    <label for="tcname">Name</label><input type="text" id="tcname" data-keep><label for="tcrel">Relationship</label><input type="text" id="tcrel" data-keep>
    <div class="row ob-nav">${back}<button class="primary" data-act="tc_add">Add and continue</button><button class="quiet" data-act="ob_next">Skip</button></div>`}</div>`;
  return `<div class="card ob"><h2>You’re all set</h2>
    <dl class="kv ob-summary"><dt>Second Look</dt><dd>${m.enrolled ? 'On' : 'Off'}</dd>${m.enrolled ? `<dt>Alerts</dt><dd>${A.sensitivity[0].toUpperCase() + A.sensitivity.slice(1)}${A.quiet ? ', quiet hours on' : ''}</dd><dt>Trusted contact</dt><dd>${t ? esc(t.name) : 'None'}</dd>` : ''}</dl>
    <p class="small muted">Change any of this in Settings, or run setup again from your profile.</p>
    <button class="primary" data-act="ob_done">Go to home</button></div>`;
}

function profileView() {
  const m = S.member, t = m.trusted_contact, A = S.alerts;
  const initials = m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return `<div class="card profile-head"><span class="avatar" aria-hidden="true">${esc(initials)}</span><div><h2>${esc(m.name)}</h2><div class="small muted">Member ${esc(m.id)} · synthetic kit member</div></div></div>
    <div class="card"><h3>Contact and sign-in</h3><dl class="kv"><dt>Phone on file</dt><dd>${esc(m.current_contact)}</dd><dt>Sign-in</dt><dd>Sound app sign-in (demo)</dd></dl></div>
    <div class="card"><h3>Second Look</h3><dl class="kv"><dt>Status</dt><dd>${m.enrolled ? 'On' : 'Off'}</dd><dt>Alerts</dt><dd>${A.sensitivity[0].toUpperCase() + A.sensitivity.slice(1)}${A.quiet ? ', quiet hours on' : ''}</dd><dt>Trusted contact</dt><dd>${t ? `${esc(t.name)} (${esc(t.relation)})` : 'None'}</dd></dl>
      <div class="row profile-actions"><button data-page="settings">Change settings</button><button class="quiet" data-act="onboarding">Run setup again</button></div></div>
    <div class="card"><button data-act="sign_out">Sign out</button><p class="small muted">Signing out only affects this demo tab.</p></div>`;
}

// Escape first, then allow only **bold** and line breaks (no raw HTML from the model).
// Escape first, then allow **bold**, and lines starting "- " as a bulleted list.
const fmtReply = t => {
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(`<ul class="msg-list">${list.map(x => `<li>${x}</li>`).join('')}</ul>`); list = []; } };
  for (const line of esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').split('\n')) {
    const m = line.match(/^\s*[-•]\s+(.*)$/);
    if (m) list.push(m[1]); else { flush(); out.push(line); }
  }
  flush();
  return out.join('\n').replace(/\n?(<ul class="msg-list">)/g, '$1').replace(/(<\/ul>)\n?/g, '$1');
};

const RECOVERY = `If money already went out, every hour matters:
- **Tell Sound now.** We can request a wire recall or an ACH return. These are possible but not guaranteed, and the chance falls with time.
- Person-to-person payments usually can’t be pulled back. Contact the app you used and report it there too.
- If you shared a password or one-time code, we’ll help you secure your account.
- You can also report it to the FTC (reportfraud.ftc.gov) and the FBI’s IC3 (ic3.gov).
You did the right thing by speaking up.`;

// A report Second Look filed for the member: what happened, in their words, ready for the callback.
function fraudDetail(r) {
  return `<div class="fraud-report"><p>${esc(r.summary)}</p>
    ${r.asked_for ? `<p class="small"><b>Asked for:</b> ${esc(r.asked_for)}</p>` : ''}
    ${r.tactics.length ? `<div class="row">${r.tactics.map(t => `<span class="in-badge in-badge--risk">${esc(t)}</span>`).join('')}</div>` : ''}
    ${r.quotes.length ? r.quotes.map(q => `<blockquote>“${esc(q)}”</blockquote>`).join('') : ''}
    <p class="small muted">Contact: ${esc(r.contact)}. Call on the number on file, never one from the scam.</p></div>`;
}

/* ---------------- Email check ---------------- */
// Members forward an email that feels off (or ask a question) to Second Look's inbox and get a reply.
// Only mail from the address they link here is read; everything else is left unread.
const emAgo = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
function emailReport(r, staff = false) {
  const flagged = r.links.filter(l => l.note && !l.note.startsWith('This is'));
  return `<li class="em-report">
    <div class="g-head"><b>${esc(r.subject || '(no subject)')}</b><span class="small muted">${r.kind === 'forwarded' ? 'Forwarded' : 'Question'} · ${emAgo(r.received)}</span></div>
    ${r.tactics.length ? `<div class="row">${r.tactics.map(t => `<span class="in-badge in-badge--risk">${esc(t.label)}</span>`).join('')}</div>` : ''}
    ${flagged.length ? `<ul class="em-links">${flagged.map(l => `<li><b>${esc(l.domain)}</b>: ${esc(l.note)}</li>`).join('')}</ul>` : ''}
    ${staff ? '' : r.reported ? '<span class="in-badge in-badge--safe">Reported to Sound</span>' : `<div class="row"><button data-act="em_report" data-id="${r.id}">Report to Sound</button></div>`}
    ${staff ? '' : det('em-' + r.id, r.sent ? 'Second Look’s reply (also in your email)' : 'Second Look’s reply', `<div class="msg assistant">${fmtReply(r.reply)}</div>`)}
  </li>`;
}
function emailView() {
  const e = S.email;
  if (!e) return `<div class="card"><h2>Email check</h2><p>Second Look’s inbox isn’t set up on this server.</p></div>`;
  const linkCard = e.linked
    ? `<p class="small">Your email: <b>${esc(e.linked)}</b> · ${e.share ? 'Sound can see these reports' : 'reports stay with you'} <button class="quiet" data-act="em_unlink">Change</button></p>`
    : `<div class="g-link"><label for="em-addr">Your email address</label><div class="row"><input type="email" id="em-addr" data-keep autocomplete="email" placeholder="you@example.com"><button class="primary" data-act="em_link">Link my email</button></div>
        <label class="check"><input type="checkbox" id="em-share" data-keep checked> Let Sound see what Second Look finds</label>
        <p class="small muted">Second Look only reads mail sent from this address. Anything else sent to it is left unread.</p></div>`;
  return `<div class="card guardian"><h2>Email check</h2>
    <p>Got an email or text that feels off? Forward it to Second Look. It replies within a minute with what the message is asking for, the warning signs, and what to do. You can also email it a question.</p>
    <p class="em-address"><span class="small muted">Second Look’s address</span><br><b>${esc(e.address)}</b></p>
    ${linkCard}</div>
    <div class="card g-way"><h3>How to forward</h3>
      <ol class="in-ol g-steps"><li><span>Open the email and tap <b>Forward</b>. For a text, copy it into a new email.</span></li><li><span>Send it to <b>${esc(e.address)}</b> from your linked email.</span></li><li><span>Read the reply in your email. It also shows up below.</span></li></ol>
      <p class="small muted">Don’t click links in the message first. Second Look never opens links and never asks for codes or passwords.</p></div>
    <div class="card"><h3>What Second Look found</h3>${e.reports.length ? `<ul class="em-list">${e.reports.map(r => emailReport(r)).join('')}</ul>` : `<p class="small muted">${e.linked ? 'Nothing yet. Forward an email and it will show up here.' : 'Link your email to see reports here.'}</p>`}</div>`;
}
// Staff see forwarded-email reports only if the member chose to share them.
function emailCard() {
  const e = S.email; if (!e || !e.share || !e.reports.length) return '';
  return `<div class="card guardian-console"><div class="console-head"><h2>Emails the member forwarded to Second Look</h2><span class="in-badge in-badge--neutral">Shared by the member</span></div>
    <p class="small muted">What the forwarded messages asked for, from automatic checks. Prompts for your outreach, not proof.</p>
    <ul class="em-list">${e.reports.slice(0, 3).map(r => emailReport(r, true)).join('')}</ul></div>`;
}

/* ---------------- Call guardian ---------------- */
// Second Look listens to a call on speaker: ~4 s chunks go to the server, which transcribes them (local Whisper,
// audio not kept) and returns any new warning signs. G holds the browser-side capture while a call is live.
let G = null, reportedCall = null;
// Call timer for any live call (speaker or phone), from the server's start time.
setInterval(() => { const el = $('#g-time'); if (el && el.dataset.since && !G) el.textContent = mmss((Date.now() - Number(el.dataset.since)) / 1000); }, 500);
const LEVEL = {
  listening: ['neutral', 'Listening', 'Nothing worrying so far'],
  careful: ['review', 'Be careful', 'Something on this call is worth a second look'],
  high: ['risk', 'High risk', 'This call matches common scam patterns'],
};
const gfetch = (p, b) => fetch('/api/guardian/' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf': csrf }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => ({}));

const fmtPhone = n => n ? n.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : '';
const SOURCE = { speaker: 'Listening on speaker', sample: 'Sample call', 'phone-in': 'Phone call · Second Look is on the line', 'phone-out': 'Second Look called you' };

// How to get Second Look on a call: add it to the call, call it, have it call you, or listen on speaker.
function guardianIntro() {
  const ph = S.phone, num = ph && fmtPhone(ph.number);
  const linkCard = !ph ? '' : ph.linked
    ? `<p class="small">Your phone: <b>${esc(ph.linked)}</b> · ${ph.share ? 'Sound can see warnings from your calls' : 'warnings stay on your device'} <button class="quiet" data-act="ph_unlink">Change</button></p>`
    : `<div class="g-link"><label for="ph-num">Your phone number</label><div class="row"><input type="tel" id="ph-num" data-keep inputmode="tel" autocomplete="tel" placeholder="(555) 555-0123"><button class="primary" data-act="ph_link">Link my phone</button></div>
        <label class="check"><input type="checkbox" id="ph-share" data-keep checked> Let Sound see warnings from these calls</label>
        <p class="small muted">Linking tells Second Look which calls are yours, so warnings show up here. Demo: use your own phone.</p></div>`;
  return `<div class="card guardian"><h2>Call guardian</h2>
    <p>On a call that feels off? Bring Second Look in. It listens for pressure tactics, like requests for codes, gift cards or secrecy, and warns you as the call happens.</p>
    <p class="small muted">Second Look never moves money or asks for codes. It only listens to calls you bring it into. Transcripts are used for warnings; audio isn’t kept.</p>
    ${linkCard}</div>
    ${ph ? `<div class="card g-way"><h3>Add Second Look to a call</h3>
      <p class="small">While someone is on the line with you:</p>
      <ol class="in-ol g-steps"><li><span>Tap <b>Add call</b>.</span></li><li><span>Dial <b>${num}</b>.</span></li><li><span>Tap <b>Merge calls</b>.</span></li></ol>
      <p class="small">Second Look says hello so everyone knows it’s there, then listens quietly. It speaks up only if someone asks for a code, gift cards or to move your money. Warnings appear on this screen.</p></div>
    <div class="card g-way"><h3>Call Second Look</h3><p class="small">After a call, or about a text or email, call and tell it what happened.</p>
      <div class="row"><a class="in-btn in-btn--secondary g-tel" href="tel:${esc(ph.number)}">Call ${num}</a></div></div>
    <div class="card g-way"><h3>Have Second Look call me</h3><p class="small">It calls your linked phone and already knows what this app saw, like a held payment or warnings from a call.</p>
      <div class="row"><button data-act="ph_call_me" ${ph.can_call_me ? '' : 'disabled'}>Call my phone</button></div>
      ${ph.linked && !ph.can_call_me ? '<p class="small muted">In this demo, Second Look only calls phones on the team’s list.</p>' : !ph.linked ? '<p class="small muted">Link your phone first.</p>' : ''}</div>` : ''}
    <div class="card g-way"><h3>Listen on speaker</h3><p class="small">Put the call on speaker near this device. Second Look listens through the microphone.</p>
      <label class="check"><input type="checkbox" id="g-share" data-keep> Let Sound see warnings during this call</label>
      <div class="row"><button class="primary" data-act="g_start" data-src="mic">Start listening</button><button data-act="g_start" data-src="sample">Play a sample scam call</button></div>
      <p class="small muted">The sample is a staged call for the demo.</p></div>`;
}

function guardianView() {
  const g = S.guardian;
  if (!g || (!g.live && !g.summary)) return guardianIntro();
  const [tone, word, line] = LEVEL[g.level];
  const latest = g.alerts.at(-1);
  const alertList = g.alerts.slice().reverse().map(a => `<li><span class="in-badge in-badge--risk">${esc(a.label)}</span><p>${esc(a.advice)}</p><blockquote>“${esc(a.quote)}”</blockquote></li>`).join('');
  if (g.live) return `<div class="card guardian live" aria-live="polite">
      <div class="g-head"><span class="in-badge in-badge--${tone}">${word}</span><span class="small muted">${SOURCE[g.source] || SOURCE.speaker} · <span id="g-time" data-since="${g.started}">0:00</span></span></div>
      <h2>${line}</h2>
      ${latest ? `<p class="g-now">${esc(latest.advice)}</p>` : '<p class="small muted">Warnings appear here as the call goes on.</p>'}
      <div class="row"><button class="primary" data-act="g_stop">Stop listening</button>${g.level === 'high' ? '<button data-act="g_hangup">Hang up and call Sound</button>' : ''}</div></div>
    ${g.alerts.length ? `<div class="card"><h3>What I’ve heard</h3><ul class="g-alerts">${alertList}</ul></div>` : ''}
    <div class="card"><h3>Live transcript</h3><div class="g-transcript" id="g-transcript">${g.lines.map(l => l.who === 'second-look' ? `<p class="g-sl"><b>Second Look:</b> ${esc(l.text)}</p>` : `<p>${esc(l.text)}</p>`).join('') || '<p class="muted">Waiting for speech…</p>'}</div><p class="small muted">Automatic transcript. It can mishear words.</p></div>`;
  return `<div class="card guardian"><div class="g-head"><span class="in-badge in-badge--${tone}">${word}</span><span class="small muted">Call ended · ${mmss((g.ended - g.started) / 1000)}</span></div>
      <h2>${g.alerts.length ? 'Before you do anything' : 'Call summary'}</h2>
      <div class="msg assistant">${fmtReply(g.summary)}</div>${g.summary_source === 'offline' ? '<p class="small muted">offline summary</p>' : ''}
      <div class="row">${g.alerts.length ? (reportedCall === g.started ? '<span class="in-badge in-badge--safe">Reported to Sound</span>' : '<button class="primary" data-act="g_report">Report this call to Sound</button>') : ''}<button ${g.alerts.length ? '' : 'class="primary"'} data-act="g_talk">Talk to a person at Sound</button>${S.phone && S.phone.can_call_me ? '<button data-act="ph_call_me">Have Second Look call me</button>' : ''}<button data-act="chat_general">Talk it through</button><button class="quiet" data-act="g_reset">Listen to another call</button></div></div>
    ${g.alerts.length ? `<div class="card"><h3>Warning signs I heard</h3><ul class="g-alerts">${alertList}</ul></div>` : ''}`;
}

// Staff see a live call only if the member ticked "Let Sound see warnings during this call".
function guardianCard() {
  const g = S.guardian; if (!g || !g.share) return '';
  const [tone, word] = LEVEL[g.level];
  return `<div class="card guardian-console" aria-live="polite"><div class="console-head"><h2>${g.live ? (g.source && g.source.startsWith('phone') ? 'Live phone call: Second Look is on the line' : 'Live call: member is listening with Second Look') : 'Call the member just had'}</h2><span class="in-badge in-badge--${tone}">${word}</span></div>
    <p class="small muted">Shared by the member. Patterns heard on the call, from an automatic transcript. Prompts for your outreach, not proof.</p>
    ${g.alerts.length ? `<ul class="shared-list">${g.alerts.map(a => `<li><span class="in-badge in-badge--risk">${esc(a.label)}</span><blockquote>“${esc(a.quote)}”</blockquote><span class="small muted">at ${mmss(a.at / 1000)}</span></li>`).join('')}</ul>` : '<p class="small">No warning signs yet.</p>'}
    ${g.level === 'high' ? '<p class="small"><b>Suggested:</b> call the member now on the number on file. Don’t use any number from the call.</p>' : ''}</div>`;
}

async function gStart(src) {
  if (G) return;
  if (!window.MediaRecorder) return toast('Listening isn’t available in this browser.');
  let stream, ctx = new (window.AudioContext || window.webkitAudioContext)(), player = null;
  try {
    if (src === 'sample') {
      const buf = await ctx.decodeAudioData(await (await fetch('/static/sample-call.m4a')).arrayBuffer());
      player = ctx.createBufferSource(); player.buffer = buf;
      const dest = ctx.createMediaStreamDestination(); player.connect(dest); player.connect(ctx.destination); stream = dest.stream;
    } else {
      // Raw mic: echo cancelling and noise suppression can erase a phone on speaker.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    }
  } catch { ctx.close(); return toast(src === 'sample' ? 'Couldn’t play the sample call.' : 'Microphone access is blocked. Allow it in your browser settings.'); }
  const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
  const share = !!$('#g-share')?.checked;
  await gfetch('start', { share, source: src === 'sample' ? 'sample' : 'speaker' });
  G = { src, stream, ctx, player, an, on: true, start: Date.now(), queue: Promise.resolve(), peak: 0 };
  // Track loudness so silent chunks are skipped (Whisper invents words on silence).
  const lvl = new Float32Array(an.fftSize);
  G.meter = setInterval(() => { an.getFloatTimeDomainData(lvl); let m = 0; for (const v of lvl) m = Math.max(m, Math.abs(v)); G.peak = Math.max(G.peak, m); const el = $('#g-time'); if (el) el.textContent = mmss((Date.now() - G.start) / 1000); }, 100);
  if (player) { player.onended = () => setTimeout(() => G && G.on && gStop(), 600); player.start(); }
  gCycle(); poll();
}

// A fresh recorder per chunk so every chunk is a complete file the server can decode on its own.
function gCycle() {
  if (!G || !G.on) return;
  const mr = new MediaRecorder(G.stream), parts = [];
  G.peak = 0;
  mr.ondataavailable = e => e.data.size && parts.push(e.data);
  mr.onstop = () => {
    const loud = G.peak > 0.02, blob = new Blob(parts, { type: mr.mimeType || 'audio/webm' });
    if (loud && blob.size > 1000) G.queue = G.queue.then(() => gSend(blob));
    if (G.on) gCycle(); else G.queue.then(gFinish);
  };
  mr.start(); G.mr = mr;
  G.timer = setTimeout(() => mr.state === 'recording' && mr.stop(), 4000);
}

async function gSend(blob) {
  const j = await gfetch('chunk', { data: (await readB64(blob)).split(',')[1] });
  if (S.guardian && j.line) {
    S.guardian.lines.push(j.line); S.guardian.alerts.push(...(j.alerts || [])); S.guardian.level = j.level;
    render(); const t = $('#g-transcript'); if (t) t.scrollTop = t.scrollHeight;
  }
}

function gStop() {
  if (!G || !G.on) return;
  G.on = false; clearTimeout(G.timer); clearInterval(G.meter);
  try { G.player?.stop(); } catch {}
  if (G.mr && G.mr.state === 'recording') G.mr.stop(); else G.queue.then(gFinish);
  toast('Finishing up…');
}

async function gFinish() {
  if (!G) return;
  G.stream.getTracks().forEach(t => t.stop()); G.ctx.close().catch(() => {});
  G = null;
  await gfetch('stop', {}); await poll(); render(true);
}

/* ---------------- Chat attachments ---------------- */
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const attLabel = a => a.kind === 'audio' ? `Voice note · ${mmss(a.seconds || 0)}` : a.kind === 'pdf' ? `PDF · ${a.name}` : a.name || 'Photo';
function attBlock(att) {
  return `<div class="msg-att">${att.map(a => a.kind === 'image' ? (a.src ? `<img src="${a.src}" alt="Photo you shared: ${esc(a.name)}">` : `<span class="att-file">Photo · ${esc(a.name)}</span>`)
    : a.kind === 'pdf' ? `<span class="att-file">${esc(attLabel(a))}</span>`
    : `<div class="att-voice"><span class="att-file">${esc(attLabel(a))}</span>${a.transcript ? `<p class="att-heard">“${esc(a.transcript)}”</p>` : a.transcript === '' ? '<p class="att-heard">Couldn’t make out the words.</p>' : ''}</div>`).join('')}</div>`;
}
const readB64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(blob); });
// Screenshots are scaled to 1600px on the long edge: plenty for Claude to read text, small enough to send fast.
async function shrinkImage(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { kind: 'image', name: file.name || 'Screenshot', media_type: 'image/jpeg', data: url.split(',')[1], preview: url };
}
const audioSeconds = url => new Promise(ok => { const a = new Audio(); a.onloadedmetadata = () => ok(isFinite(a.duration) ? a.duration : 0); a.onerror = () => ok(0); a.src = url; });
async function addFiles(files) {
  for (const f of files) {
    if (pendingAtt.length >= 3) { toast('You can add up to 3 files to one message.'); break; }
    try {
      if (f.type.startsWith('image/')) pendingAtt.push(await shrinkImage(f));
      else if (f.type === 'application/pdf') { if (f.size > 8e6) { toast('That PDF is too large (8 MB max).'); continue; } pendingAtt.push({ kind: 'pdf', name: f.name, media_type: f.type, data: (await readB64(f)).split(',')[1] }); }
      else if (f.type.startsWith('audio/') || /\.(m4a|mp3|wav|ogg|aac)$/i.test(f.name)) {
        if (f.size > 12e6) { toast('That recording is too large (12 MB max).'); continue; }
        const url = URL.createObjectURL(f); const seconds = await audioSeconds(url); URL.revokeObjectURL(url);
        pendingAtt.push({ kind: 'audio', name: f.name, seconds, data: (await readB64(f)).split(',')[1] });
      } else toast('Add a photo, a PDF or an audio file.');
    } catch { toast('Couldn’t read that file.'); }
  }
  render(true); $('#chatin')?.focus();
}
async function startRec() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Recording isn’t available in this browser. You can add an audio file instead.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone access is blocked. Allow it in your browser settings, or add an audio file.'); }
  const mr = new MediaRecorder(stream), chunks = [];
  rec = { mr, stream, start: Date.now(), keep: true };
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); clearInterval(rec?.timer);
    const r = rec; rec = null;
    if (r?.keep && chunks.length) {
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      pendingAtt.push({ kind: 'audio', name: 'Voice note', seconds: (Date.now() - r.start) / 1000, data: (await readB64(blob)).split(',')[1] });
    }
    render(true);
  };
  mr.start();
  rec.timer = setInterval(() => { const s = (Date.now() - rec.start) / 1000; const el = $('#rec-time'); if (el) el.textContent = mmss(s); if (s >= 180) mr.stop(); }, 250);
  render(true); $('[data-act="rec_stop"]')?.focus();
}

function chatView() {
  const general = chatCase === 'general';
  const c = general ? null : caseById(chatCase);
  if (!general && !c) { chatCase = 'general'; chatLog = []; return chatView(); }
  const asked = kind => S.callbacks.some(x => x.status === 'waiting' && x.source.includes(general ? 'feels off' : `case ${chatCase}`) && x.reason.toLowerCase().includes({ talk: 'talk to a person', sent: 'money already', report: 'reporting' }[kind]));
  const intro = general ? 'I’m here to help you think it through. What happened? For example: who contacted you, and what are they asking you to do? You can also add a screenshot of the text or email, or record a voice note.' : 'I’m here to help you think this through. You decide. What would you like to check first?';
  const subject = general ? 'Something feels off' : `About your ${usd0(payOf(c).amount)} ${esc(payOf(c).rail.toLowerCase())}`;
  const help = [['talk', 'Talk to a person at Sound', 'A person at Sound will call you'], ['sent', 'I already sent money', 'Recovery team notified'], ['report', 'Report a scam', 'Reported']];
  const starters = general ? ['Someone says they’re from my bank', 'I’m being asked to pay with gift cards', 'Someone I met online needs money'] : ['Who should I check this with?', 'Is this a common scam?', 'I know this person'];
  const msgs = [{ role: 'assistant', text: intro }, ...chatLog];
  const shareKey = general ? '0' : String(chatCase), shareOn = !!S.share_on?.[shareKey];
  const askShare = !shareOn && !shareAnswered.has(shareKey) && chatLog.some(m => m.role === 'user');
  const plusMenu = plusOpen ? `<div class="plus-menu" role="menu" aria-label="More">
      <button role="menuitem" data-act="attach">Add a photo, screenshot or PDF</button>
      <button role="menuitem" data-page="guardian">Listen to a call with me</button>
      <button role="menuitem" data-page="email">Forward an email to Second Look</button>
      <button role="menuitem" data-act="${shareOn ? 'share_stop' : 'share_yes'}">${shareOn ? 'Stop sharing with Sound' : 'Share this chat with Sound'}</button>
      <div class="plus-sep"></div>
      ${help.map(([k, label, done]) => `<button role="menuitem" data-act="cb" data-kind="${k}" ${asked(k) ? 'disabled' : ''}>${asked(k) ? done : label}</button>`).join('')}
      <p class="plus-note">Voice notes are transcribed on Sound’s server; the audio isn’t kept.</p></div>` : '';
  return `<div class="chat-screen">
    <div class="chat-top"><div class="chat-title"><div class="chat-name">Second Look</div><div class="chat-sub">${subject}</div></div>
      ${general ? '' : '<button class="quiet" data-act="chat_general">Something else</button>'}
      <button class="icon-btn" data-act="back" aria-label="Close chat">×</button></div>
    ${general ? '' : det('chat-ev-' + c.id, 'What Second Look can see', `<div class="chat-evidence">${reasonList(c)}</div>`)}
    <div class="chat-scroll" id="chatscroll"><div class="chat" aria-live="polite" aria-relevant="additions">${msgs.map(m => `<div class="msg ${m.role}${m.pending ? ' pending' : ''}">${m.att ? attBlock(m.att) : ''}${m.role === 'assistant' ? fmtReply(m.text) : esc(m.text)}${m.role === 'assistant' && m.source === 'offline' ? '<div class="small muted">offline reply</div>' : ''}</div>`).join('')}
      ${help.filter(([k]) => asked(k)).map(([, , done]) => `<div class="chat-status" role="status">${done}</div>`).join('')}
      ${shareOn ? `<div class="chat-status">Shared with the Sound employee helping you</div>` : askShare ? `<div class="consent-card" role="group" aria-label="Share this chat"><p><b>Let the Sound employee helping you see this chat?</b> They see what you write here, nothing else. You can stop any time.</p><div class="row"><button class="primary" data-act="share_yes">Share with Sound</button><button data-act="share_no">Keep private</button></div></div>` : ''}</div>
      ${chatLog.length ? '' : `<div class="chat-starters">${starters.map(t => `<button class="chat-starter" data-act="send" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}</div>
    <div class="chat-dock">
      ${plusMenu}
      ${pendingAtt.length ? `<ul class="att-tray" aria-label="Ready to send">${pendingAtt.map((a, i) => `<li class="att-chip">${a.kind === 'image' ? `<img src="${a.preview}" alt="">` : ''}<span>${esc(attLabel(a))}</span><button class="icon-btn" data-act="att_remove" data-i="${i}" aria-label="Remove ${esc(attLabel(a))}">×</button></li>`).join('')}</ul>` : ''}
      ${rec ? `<div class="rec-bar" role="status"><span class="rec-dot" aria-hidden="true"></span><span>Recording <span id="rec-time">0:00</span></span><button class="primary" data-act="rec_stop">Stop and add</button><button class="quiet" data-act="rec_cancel">Cancel</button></div>` : ''}
      <div class="composer">
        <button class="composer-icon" data-act="plus_menu" aria-haspopup="menu" aria-expanded="${plusOpen}" aria-label="More: files, calls, help" title="Files, calls and help">${ICON.plus}</button>
        <label for="chatin" class="sr">Message</label><textarea id="chatin" data-keep rows="1" placeholder="Ask Second Look"></textarea>
        <button class="composer-icon" data-act="rec_start" ${rec ? 'disabled' : ''} aria-label="Record a voice note" title="Record a voice note">${ICON.mic}</button>
        <button class="primary composer-send" data-act="send" aria-label="Send">${ICON.up}</button>
        <input type="file" id="chatfile" accept="image/*,application/pdf,audio/*,.m4a,.mp3,.wav" multiple hidden></div>
      <p class="chat-note">Second Look can’t move money. It tells Sound’s fraud team only if you say so. You decide.</p>
    </div></div>`;
}

/* ---------------- Employee console ---------------- */
const GUIDE = {
  R1: ['Can you tell me, in your own words, who asked you to make this payment?', 'Have you been able to reach them on a number you already had?', 'Has anyone asked you to keep this quiet, or told you what to say to us?', 'Is anyone on the phone with you right now?'],
  R2: ['(Call the pre-change number on file.) Did you change your password or contact details recently?', 'Did you add this recipient yourself?', 'Has anyone asked you for a one-time code?'],
  R3: ['How did you meet the person you’re sending to?', 'Have you met in person or on video?', 'Have you been able to withdraw any “investment” returns?'],
  R4: ['What is the cash for?', 'Has anyone told you your money is unsafe or under investigation?', 'Were you told not to tell bank staff or family?'],
  STD: ['Standard new-recipient check. No outreach needed unless the member asks.'],
};
const CUES = 'Red flags: secrecy, coaching (“they told me what to say”), a second person on the line, deadlines, gift cards / crypto / cash couriers. Script: “I want to share what I’m seeing, and then it’s your decision.”';

function employeeView() {
  const open = S.cases.filter(c => c.status === 'open').sort((a, b) => (payOf(a).hold_expires_at ?? Infinity) - (payOf(b).hold_expires_at ?? Infinity));
  const closed = S.cases.filter(c => c.status === 'closed');
  if (selCase == null && S.cases[0]) selCase = (open[0] || S.cases[0]).id;
  const c = caseById(selCase);
  const afterHours = p => { if (!p.hold_started_at) return false; const d = new Date(p.hold_started_at); const h = d.getUTCHours(), wd = d.getUTCDay(); return h < 9 || h >= 18 || wd === 0 || wd === 6; };
  const rowHtml = x => { const p = payOf(x); const left = p.status === 'Held' ? `<span data-expires="${p.hold_expires_at}">${hm(p.hold_expires_at - S.sim)}</span>` : '—';
    return `<tr class="click ${x.id === selCase ? 'sel' : ''}" data-act="select" data-case="${x.id}" tabindex="0"><td>${esc(S.member.id)}</td><td>${usd0(p.amount)} ${esc(p.rail)}</td><td>${esc(x.title)}</td><td>${esc(p.status === 'Held' ? 'On hold' : p.gate === 'presubmit_review' && p.status === 'Pending' ? 'Waiting: verify first' : p.gate === 'branch_conversation' && p.status === 'Pending' ? 'Branch conversation' : p.gate === 'banner_confirm' && p.status === 'Pending' ? 'Member confirming' : p.status)}${x.callback_requested ? ' · <b>member asked to talk</b>' : ''}${afterHours(p) ? ' · after hours' : ''}</td><td class="countdown">${left}</td></tr>`; };
  // One work queue: members asking to talk (urgent first), then payments waiting on people, then done.
  const waiting = S.callbacks.filter(x => x.status === 'waiting').sort((a, b) => b.urgent - a.urgent);
  const doneCb = S.callbacks.filter(x => x.status !== 'waiting');
  const cbRow = x => `<tr class="cbrow ${x.status}"><td>${esc(S.member.id)}</td><td>${x.urgent ? '<span class="in-badge in-badge--risk">Urgent</span>' : '<span class="in-badge in-badge--neutral">Asked to talk</span>'}</td><td>${esc(x.reason)}<div class="small muted">${esc(x.source)} · ${esc(x.ts_text.split(' ')[1])}${x.status === 'done' ? ` · done: ${esc(x.note)}` : ''}</div>${x.report ? fraudDetail(x.report) : ''}</td>
    <td colspan="2">${x.status === 'waiting' ? `<div class="row"><button data-act="cb_done" data-id="${x.id}">Called the member</button>${x.reason.includes('money already') ? '<button data-act="cb_done" data-id="' + x.id + '" data-note="Recovery request started">Start recovery</button>' : ''}</div>` : 'Done'}</td></tr>`;
  const n = waiting.length + open.length;
  let out = guardianCard() + emailCard() + sharedCard('general') + `<div class="card queue"><div class="console-head"><h2>Work queue <span class="in-badge in-badge--neutral">simulated</span></h2><span class="small muted">${n ? `${n} waiting on a person` : 'Nothing waiting'} · requests first, then by hold time left</span></div>
    <div class="table-wrap"><table><thead><tr><th>Member</th><th>Payment</th><th>Why</th><th>Status</th><th>Hold left</th></tr></thead><tbody>
    ${waiting.map(cbRow).join('')}${open.map(rowHtml).join('')}${n ? '' : '<tr><td colspan="5" class="muted">Nothing waiting on a person.</td></tr>'}
    ${closed.length || doneCb.length ? `<tr class="q-sep"><td colspan="5" class="muted small">Done</td></tr>` + closed.map(rowHtml).join('') + doneCb.map(cbRow).join('') : ''}</tbody></table></div></div>`;
  if (c) out += caseHead(c) + sharedCard(String(c.id)) + caseDetail(c);
  out += timelineCard(S.mode === 'as_is'); // the as-is replay is the timeline; otherwise folded
  return out;
}

// Case header: who, how to reach them, time left, and one Call action.
function caseHead(c) {
  const p = payOf(c), m = S.member, r2 = c.rule === 'R2';
  const left = p.status === 'Held' ? `<div class="case-left"><span class="small muted">Hold left</span><span class="countdown" data-expires="${p.hold_expires_at}">${hm(p.hold_expires_at - S.sim)}</span></div>` : '';
  return `<div class="card case-head"><div class="case-who"><span class="avatar" aria-hidden="true">${esc(m.name.trim()[0])}</span><div><div class="case-name">${esc(m.name)} <span class="small muted">${esc(m.id)}</span></div>
    <div class="small">${r2 ? `Call the <b>pre-change</b> number: ${esc(m.pre_change_contact)}` : `Phone on file: ${esc(m.current_contact)}`}</div></div></div>
    ${left}${c.status === 'open' && c.rule !== 'STD' ? `<button class="primary" data-act="e_outreach">Call ${esc(m.name.split(' ')[0])}</button>` : ''}</div>`;
}

// Chat the member chose to share: their words, with the pressure tactics they mention (prompts for the call, not proof).
const PROMOTE = { secrecy: /quiet|what to say|not to tell/i, coached: /phone with you|what to say/i, family: /own words|number you already/i, authority: /number you already|unsafe|investigation|not to tell/i, urgency: /own words/i, payment: /cash for|withdraw/i, code: /one-time code/i, online: /met|video|withdraw/i };
const sharedTactics = id => new Set((S.shared?.[id]?.messages || []).flatMap(m => m.tactics.map(t => t.key)));
function sharedCard(id) {
  const sh = S.shared?.[id]; if (!sh) return '';
  return `<div class="card shared-card" aria-live="polite"><div class="console-head"><h2>What the member told Second Look</h2><span class="in-badge in-badge--neutral">Shared by the member</span></div>
    <p class="small muted">The member chose to share this ${id === 'general' ? '“Something feels off”' : 'payment'} chat. Their own words, not verified. The patterns are prompts for your call, not proof.</p>
    ${sh.messages.length ? `<ul class="shared-list">${sh.messages.slice(-4).map(m => `<li><blockquote>“${esc(m.text)}”</blockquote>${m.tactics.length ? `<div class="row">${m.tactics.map(t => `<span class="in-badge in-badge--risk">${esc(t.label)}</span>`).join('')}</div>` : ''}</li>`).join('')}</ul>` : '<p class="small">Nothing typed yet.</p>'}</div>`;
}

const PRESETS = { Held: ['Member confirmed by phone: legitimate', 'Verified with a contact the member already had', 'Member reconfirmed in branch'] };

function caseDetail(c) {
  const p = payOf(c), r = p.row, open = c.status === 'open';
  const can = { release: p.status === 'Held', review: p.gate === 'presubmit_review' && p.status === 'Pending', branch: p.gate === 'branch_conversation' && p.status === 'Pending', verify: c.rule === 'R2' && open && !p.ato_verified, stop: open && p.ato_verified, cancel: open && (p.status === 'Held' || p.status === 'Pending') };
  const sig = reasons(c).filter(x => x.value);
  const kind = p.rail === 'P2P' ? 'P2P payment' : p.rail === 'Cash' ? 'cash withdrawal' : p.rail.toLowerCase();
  const state = !open ? `Closed: ${p.status}` : p.status === 'Held' ? 'On hold' : p.gate === 'presubmit_review' ? 'Waiting before submit' : p.gate === 'branch_conversation' ? 'Branch conversation' : p.gate === 'banner_confirm' ? 'Member is confirming' : p.status;
  const memberView = c.member_label === 'looks_fine' ? `Member marked it fine${c.label_seconds != null ? ` in ${c.label_seconds}s` : ''}` : c.member_label === 'reported' ? 'Member reported a scam' : c.callback_requested ? 'Member asked to talk' : '';
  // Questions matching what the member shared move up; secrecy and coaching first (they block checking with others).
  const W = { secrecy: 3, coached: 3, authority: 2, code: 2 };
  const tk = sharedTactics(String(c.id)), score = x => [...tk].reduce((n, k) => n + (PROMOTE[k]?.test(x) ? (W[k] || 1) : 0), 0), hit = x => score(x) > 0;
  const q = [...(GUIDE[c.rule] || GUIDE.STD)].sort((a, b) => score(b) - score(a));
  const qli = x => `<li>${hit(x) ? '<span class="in-badge in-badge--neutral">From the chat</span> ' : ''}${esc(x)}</li>`;
  let step2 = '';
  if (can.release) { const opts = [...PRESETS.Held, 'Member chose to cancel'], cancel = outcomeSel === 'Member chose to cancel';
    step2 = `<li><b>Record the outcome</b>
      <fieldset class="outcomes"><legend class="sr">Outcome</legend>${opts.map((t, i) => `<label class="outcome"><input type="radio" name="outcome" value="${esc(t)}" ${outcomeSel === t ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</fieldset>
      <label for="reason" class="small muted">Note (optional)</label><input type="text" id="reason" data-keep>
      <div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="e_outcome" ${outcomeSel ? '' : 'disabled'}>${cancel ? 'Record: member cancelled' : 'Release the payment'}</button></div></li>`; }
  else if (can.review) step2 = `<li><b>Verify using the pre-change contact</b><div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="e_clear">Member is in control: allow</button>${can.verify ? `<button data-act="e_verify">Takeover confirmed (scripted)</button>` : ''}${can.stop ? `<button class="danger" data-act="e_stop">Stop payment</button>` : ''}</div></li>`;
  else if (can.branch) step2 = `<li><b>Record the member’s decision</b><div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="e_branch_go">Member chose to proceed</button><button data-act="e_branch_cancel">Member chose not to</button></div></li>`;
  else if (open) step2 = `<li><b>No action needed</b> <span class="small muted">The member is confirming in the app.</span></li>`;
  return `<div class="two">
    <div class="card case-summary">
      <p class="eyebrow">Case ${c.id} · ${esc(S.member.id)} · ${state}</p>
      <h2>${usd0(p.amount)} ${esc(kind)}</h2>
      <p class="lede">${esc(c.title)}.</p>
      ${c.pids.length > 1 ? `<p class="small"><b>${c.pids.length} payments, one situation:</b> ${c.pids.map(id => { const x = S.payments.find(y => y.pid === id); return `${usd0(x.amount)} (${esc(x.status)})`; }).join(' · ')}</p>` : ''}
      <div class="signals">${sig.map(x => `<div class="signal"><div class="signal-label">${esc(x.label)}</div><div class="signal-value">${esc(x.value)}</div></div>`).join('')}</div>
      ${memberView ? `<p class="small"><span class="in-badge in-badge--neutral">${esc(memberView)}</span></p>` : ''}
      <p class="small muted">Signals to check, not proof. For the member’s own payment, Sound can delay and advise; the member decides.</p>
      ${det('e-fields-' + c.id, 'Kit fields and history', `<ul class="small">${c.evidence.map(e => `<li><code>${esc(e.field)}</code>: ${esc(e.value)}</li>`).join('')}</ul>
        <dl class="kv small"><dt>Amount vs usual</dt><dd>${r.ratio ?? '—'}x (${esc(r.band)})</dd><dt>Days since last ${esc(p.rail.toLowerCase())}</dt><dd>${r.gap ?? 'never'}</dd><dt>Recipient age</dt><dd>${r.recipient_age_days ?? '—'} days</dd><dt>Profile change (30d)</dt><dd>${esc(r.profile_change_recent)}</dd><dt>Password reset (7d)</dt><dd>${esc(r.password_reset_recent)}</dd><dt>Trusted contact</dt><dd>${S.member.trusted_contact ? 'Enrolled' : 'Not enrolled'}</dd><dt>Rule</dt><dd>${esc(c.rule)} · ${esc(c.output.replace('_', ' ').toLowerCase())} · tier ${esc(c.tier)}</dd></dl>`)}
    </div>
    <div class="card">
      <h2>What to do next</h2>
      <ol class="steps">
        ${open && c.rule !== 'STD' ? `<li><b>Call the member</b> <span class="small muted">on the number on file, not one given to you now</span>
          <ul class="questions">${q.slice(0, 2).map(qli).join('')}</ul>
          ${q.length > 2 ? det('e-q-' + c.id, `${q.length - 2} more questions and red flags`, `<ul class="questions">${q.slice(2).map(qli).join('')}</ul><p class="small">${esc(CUES)}</p>`) : ''}
          <div class="row" style="margin-top:var(--space-2)"><button data-act="e_outreach">Log the call</button></div></li>` : ''}
        ${step2}
      </ol>
      ${det('e-more-' + c.id, 'More actions', `<div class="row" style="margin-top:var(--space-2)">
        <button data-act="e_escalate" ${open ? '' : 'disabled'}>Escalate to fraud team</button>
        <button data-act="e_trusted" ${open ? '' : 'disabled'}>Notify trusted contact</button>
        <button data-act="e_recovery">Start recovery request</button>
        <button class="danger" data-act="e_stop" ${can.stop ? '' : 'disabled'} title="Only after a verified account takeover">Stop payment (takeover only)</button></div>`)}
      ${det('e-log-' + c.id, `Activity log (${c.actions.length})`, `<div class="timeline">${c.actions.slice().reverse().map(a => `<div>${esc(new Date(a.ts).toISOString().slice(11, 16))} · <b>${esc(a.actor)}</b> · ${esc(a.action.replace(/_/g, ' '))}${a.detail ? ' — ' + esc(a.detail) : ''}</div>`).join('')}</div>`)}
    </div></div>`;
}

/* ---------------- Events ---------------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act],[data-page]'); if (!b) return;
  if (b.dataset.page) { if (S) blurbSeen.add(S.scene.id); plusOpen = false; if (narrow() || joined) copilotOpen = false; page = b.dataset.page; if (narrow()) sideCollapsed = true; $('#main').scrollTo?.(0, 0); return render(); }
  const a = b.dataset.act, pid = b.dataset.pid, cid = Number(b.dataset.case || selCase);
  const reason = () => ($('#reason')?.value || '').trim();
  const E = (act, extra = {}) => post('employee/' + act, { caseId: selCase, reason: reason(), ...extra }).then(j => { if (j && j.ok && $('#reason')) $('#reason').value = ''; });
  switch (a) {
    case 'select': outcomeSel = ''; selCase = cid; return render();
    case 'more': showMore[cid] = !showMore[cid]; return render();
    case 'chat_general': chatAuto = false; chatCase = 'general'; openCopilot(); chatLog = await (await fetch('/api/chat/general')).json(); return render(true);
    case 'cb': { plusOpen = false;
      const kind = b.dataset.kind;
      const j = await post('callback', { kind, caseId: chatCase === 'general' ? 0 : chatCase });
      if (j && j.ok) {
        if (kind === 'sent') chatLog.push({ role: 'assistant', text: RECOVERY, source: 'guide' });
        toast(kind === 'talk' ? 'A Sound team member will call you at the number on file.' : kind === 'sent' ? 'Our recovery team has been told. They’ll call you.' : 'Thanks for reporting. A case is open and Sound will contact you.');
      }
      return render(true); }
    case 'cb_done': return post('callback/' + b.dataset.id + '/done', { note: b.dataset.note || 'Called the member' });
    case 'chat': chatCase = cid; openCopilot(); chatLog = await (await fetch('/api/chat/' + cid)).json(); return render(true);
    case 'back': copilotOpen = false; store('sl-copilot', '0'); return render(true);
    case 'send': { const t = (b.dataset.text || $('#chatin').value).trim(); const att = b.dataset.text ? [] : pendingAtt;
      if ((!t && !att.length) || rec) return; $('#chatin').value = ''; pendingAtt = [];
      const mine = { role: 'user', text: t, att: att.length ? att.map(a => ({ kind: a.kind, name: a.name, src: a.preview, seconds: a.seconds })) : undefined };
      chatLog.push(mine);
      const pend = { role: 'assistant', text: att.some(a => a.kind === 'audio') ? 'Listening to your voice note…' : att.length ? 'Looking at what you shared…' : 'Second Look is thinking…', pending: true }; chatLog.push(pend); render(true);
      const j = await post('chat/' + chatCase, { text: t, attachments: att.map(({ preview, ...a }) => a) });
      chatLog.splice(chatLog.indexOf(pend), 1);
      if (j && j.reply) { if (j.att && j.att.length) mine.att = j.att; chatLog.push({ role: 'assistant', text: j.reply, source: j.source }); if (j.reported) toast('Second Look reported this to Sound’s fraud team. Someone will call you.'); }
      else if (att.length) { chatLog.splice(chatLog.indexOf(mine), 1); pendingAtt = att; } // keep the files so the member can try again
      return render(true); }
    case 'g_start': return gStart(b.dataset.src);
    case 'ph_link': { const j = await post('phone/link', { number: $('#ph-num').value, share: $('#ph-share').checked }); if (j && j.ok) toast('Phone linked. Calls with Second Look will show up here.'); return; }
    case 'ph_unlink': return post('phone/unlink');
    case 'em_link': { const j = await post('email/link', { address: $('#em-addr').value, share: $('#em-share').checked }); if (j && j.ok) toast('Email linked. Forward a message to Second Look to try it.'); return; }
    case 'em_unlink': return post('email/unlink');
    case 'em_report': { const j = await post('report', { channel: 'email', id: Number(b.dataset.id) }); if (j && j.ok) toast('Reported. Sound’s fraud team has what Second Look found, and someone will call you.'); return; }
    case 'g_report': { const j = await post('report', { channel: 'call guardian' }); if (j && j.ok) { reportedCall = S.guardian.started; toast('Reported. Sound’s fraud team has the warnings from this call, and someone will call you.'); render(true); } return; }
    case 'ph_call_me': { const j = await post('phone/call_me', { caseId: S.cases.find(c => c.status === 'open')?.id }); if (j && j.ok) toast('Second Look is calling your phone now.'); return; }
    case 'g_stop': return gStop();
    case 'g_hangup': gStop(); await post('callback', { kind: 'talk', caseId: 0 }); return toast('Hang up now. A Sound team member will call you at the number on file.');
    case 'g_talk': { const j = await post('callback', { kind: 'talk', caseId: 0 }); if (j && j.ok) toast('A Sound team member will call you at the number on file.'); return; }
    case 'g_reset': await gfetch('reset', {}); S.guardian = null; return render(true);
    case 'attach': plusOpen = false; render(true); return $('#chatfile')?.click();
    case 'plus_menu': plusOpen = !plusOpen; return render(true);
    case 'ask': { const held = S.awaiting && S.payments.find(p => p.pid === S.awaiting); chatCase = held && held.case_id ? held.case_id : 'general'; openCopilot(); chatLog = await (await fetch('/api/chat/' + chatCase)).json(); return render(true); }
    case 'share_yes': case 'share_no': case 'share_stop': {
      const k = chatCase === 'general' ? '0' : String(chatCase); shareAnswered.add(k); plusOpen = false;
      if (a === 'share_no') return render(true);
      await post('chat/' + chatCase + '/share', { on: a === 'share_yes' });
      return toast(a === 'share_yes' ? 'Shared. The Sound employee helping you can see this chat.' : 'This chat is private again.'); }
    case 'att_remove': pendingAtt.splice(Number(b.dataset.i), 1); return render(true);
    case 'rec_start': return startRec();
    case 'rec_stop': if (rec) rec.mr.stop(); return;
    case 'rec_cancel': if (rec) { rec.keep = false; rec.mr.stop(); } return;
    case 'onboarding': page = 'onboarding'; obStep = 0; return render();
    case 'sign_in': signedIn = true; sessSet('sl-signed-in', '1'); page = 'home'; return render();
    case 'sign_in_setup': signedIn = true; sessSet('sl-signed-in', '1'); page = 'onboarding'; obStep = 0; return render();
    case 'sign_out': signedIn = false; sessSet('sl-signed-in', '0'); page = 'home'; return render();
    case 'ob_next': obStep = Math.min(obStep + 1, 4); return render();
    case 'ob_back': obStep = Math.max(obStep - 1, 0); return render();
    case 'ob_on': await post('member/enroll', { on: true }); obStep = 2; return render();
    case 'ob_skip': await post('member/enroll', { on: false }); obStep = 4; return render();
    case 'ob_done': markSetupDone(); page = 'home'; obStep = 0; return render();
    case 'setup_dismiss': markSetupDone(); return render();
    case 'enroll_on': page = 'home'; await post('member/enroll', { on: true }); return toast('Second Look is on. Turn it off any time in Settings.');
    case 'enroll_skip': page = 'home'; await post('member/enroll', { on: false }); return;
    case 'sens': return post('member/alert_settings', { sensitivity: b.dataset.v });
    case 'tc_add': { const j = await post('member/trusted_contact', { name: $('#tcname').value, relation: $('#tcrel').value }); if (j && j.ok && page === 'onboarding') { obStep = 4; render(); } return; }
    case 'tc_remove': return post('member/trusted_contact', { remove: true });
    case 'release': return post('member/override_release', { pid, code: $('#code').value });
    case 'looks_fine': case 'cancel': case 'request_code': case 'reconfirm': case 'callback': case 'report': {
      const j = await post('member/' + a, { pid });
      if (j && j.ok && a === 'report') toast('Reported. A case is open and Sound will contact you.');
      if (j && j.ok && a === 'callback') toast('A Sound team member will call you at the number on file.');
      return; }
    case 'preset': { const el = $('#reason'); if (el) { el.value = b.dataset.text; el.focus(); } return; }
    case 'e_member_cancel': return E('member_cancel');
    case 'e_outcome': { if (!outcomeSel) return; const note = reason(), text = outcomeSel + (note ? ' — ' + note : ''); const act = outcomeSel === 'Member chose to cancel' ? 'member_cancel' : 'release'; outcomeSel = ''; return E(act, { reason: text }); }
    case 'e_outreach': return E('outreach');
    case 'e_release': return E('release');
    case 'e_branch_go': return E('branch_outcome', { outcome: 'proceed' });
    case 'e_branch_cancel': return E('branch_outcome', { outcome: 'cancel' });
    case 'e_clear': return E('clear_review');
    case 'e_verify': return E('verify_ato');
    case 'e_stop': return E('stop');
    case 'e_escalate': return E('escalate');
    case 'e_trusted': return E('trusted_notify');
    case 'e_recovery': return E('recovery');
  }
});
document.addEventListener('toggle', e => { if (e.target.id) openDet.set(e.target.id, e.target.open); }, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click();
  // Chat composer: Enter sends, Shift+Enter adds a line.
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chatin') { e.preventDefault(); $('.composer-send')?.click(); }
});
// Composer grows with its text, up to a few lines.
document.addEventListener('input', e => { if (e.target.id === 'chatin') { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; } });
// Paste a screenshot into the message box, or drop files on the chat.
document.addEventListener('paste', e => { if (e.target.id === 'chatin' && e.clipboardData?.files.length) { e.preventDefault(); addFiles([...e.clipboardData.files]); } });
document.addEventListener('dragover', e => { if (e.target.closest?.('#copilot')) e.preventDefault(); });
document.addEventListener('drop', e => { if (e.target.closest?.('#copilot') && e.dataTransfer?.files.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
document.addEventListener('change', e => {
  if (e.target.name === 'outcome') { outcomeSel = e.target.value; return render(true); }
  if (e.target.id === 'chatfile') { addFiles([...e.target.files]); e.target.value = ''; }
  if (e.target.id === 'enroll') post('member/enroll', { on: e.target.checked });
  if (e.target.id === 'quiet') post('member/alert_settings', { quiet: e.target.checked });
  if (e.target.id === 'chatshare') post('chat/' + chatCase + '/share', { on: e.target.checked }).then(() => toast(e.target.checked ? 'Shared. The Sound employee can see what you type here.' : 'This chat is private again.'));
});
$('#scene').addEventListener('change', async e => { chatAuto = true; selCase = null; chatCase = 'general'; chatLog = []; showMore = {}; await post('scene/' + e.target.value); });
$('#play').addEventListener('click', () => post('control/' + (S.running ? 'pause' : 'play')));
$('#next').addEventListener('click', () => post('control/next'));
$('#faster').addEventListener('click', () => post('control/faster'));
$('#reset').addEventListener('click', () => { chatAuto = true; selCase = null; chatCase = 'general'; chatLog = []; post('control/reset'); });
function openCopilot() { copilotOpen = true; if (!narrow()) store('sl-copilot', '1'); }
$('#side-toggle').addEventListener('click', () => { sideCollapsed = !sideCollapsed; store('sl-side', sideCollapsed ? '1' : '0'); render(true); });
$('#copilot-toggle').addEventListener('click', async () => {
  copilotOpen = !copilotOpen; store('sl-copilot', copilotOpen ? '1' : '0');
  if (copilotOpen) chatLog = await (await fetch('/api/chat/' + chatCase)).json();
  render(true); if (copilotOpen) $('#chatin')?.focus();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && copilotOpen && narrow()) { copilotOpen = false; render(true); } });

// Theme toggle: light by default (Sound's brand); dark is opt-in and remembered per browser.
function syncTheme() { const d = document.documentElement.dataset.theme === 'dark'; $('#theme').setAttribute('aria-pressed', String(d)); $('#theme-state').textContent = d ? 'Dark' : 'Light'; }

// Account menu: opens from the account button, placed next to it (above on desktop, below on phones).
function setAcctMenu(open) {
  const menu = $('#acct-menu'), btn = $('#acct-btn');
  menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const r = btn.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  if (r.top > innerHeight / 2) { menu.style.top = 'auto'; menu.style.bottom = (innerHeight - r.top + 6) + 'px'; }
  else { menu.style.bottom = 'auto'; menu.style.top = (r.bottom + 6) + 'px'; }
  menu.querySelector('button').focus();
}
$('#acct-btn').addEventListener('click', () => setAcctMenu($('#acct-menu').hidden));
document.addEventListener('click', e => { if (!$('#acct-menu').hidden && !e.target.closest('#acct-btn') && !e.target.closest('#theme')) setAcctMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#acct-menu').hidden) { setAcctMenu(false); $('#acct-btn').focus(); } });
addEventListener('resize', () => setAcctMenu(false));
$('#theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('sl-theme', next); } catch {}
  syncTheme();
});
syncTheme();

// Invite a phone: a short join link (and QR code) into this demo's simulation.
let qrLib = null;
const loadQr = () => qrLib || (qrLib = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = () => ok(window.qrcode); s.onerror = no; document.head.append(s); }));
$('#invite').addEventListener('click', async () => {
  const j = await post('room'); if (!j || !j.code) return;
  const url = `${location.origin}/join/${j.code}`;
  $('#invite-url').textContent = url.replace(/^https?:\/\//, '');
  $('#invite-qr').innerHTML = '';
  $('#invite-dlg').showModal();
  try { const qr = (await loadQr())(0, 'M'); qr.addData(url); qr.make(); $('#invite-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  catch { $('#invite-qr').textContent = 'QR code unavailable offline. Type the link instead.'; }
});
$('#invite-close').addEventListener('click', () => $('#invite-dlg').close());

// Deep links for slides: /?scene=m1057&play=1&view=employee
(async () => {
  const q = new URLSearchParams(location.search);
  const v = q.get('view'), pg = q.get('page');
  if (v === 'member') page = 'home'; else if (v === 'employee') page = 'console'; else if (v === 'both') page = 'split';
  if (['home', 'inbox', 'settings', 'profile', 'onboarding', 'console', 'split', 'timeline'].includes(pg)) page = pg;
  if (q.get('joined') === '1') { joined = true; sessSet('sl-joined', '1'); page = 'home'; copilotOpen = false; setTimeout(() => toast('You’re on Linda’s phone in the presenter’s demo.'), 600); history.replaceState(null, '', '/'); }
  if (q.get('chat') === 'general') { chatAuto = false; chatCase = 'general'; copilotOpen = true; }
  await poll();
  if (q.get('scene') && S.scenes.some(x => x.id === q.get('scene'))) { await post('scene/' + q.get('scene')); if (q.get('jump') === '1') for (let i = 0; i < 60 && !S.awaiting && !S.ended; i++) await post('control/next');
    if (q.get('play') === '1') await post('control/play'); }
  setInterval(() => { if (!busy) poll(); }, 800);
})();
