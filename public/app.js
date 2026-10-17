// Second Look demo UI. Plain JS; polls /api/state and renders the member app + employee console.
const openDet = new Map();
let S = null, csrf = '', page = 'home', selCase = null, chatCase = 'general', chatLog = [], showMore = {}, busy = false;
// Shell state: left page list and right Second Look copilot, both collapsible and remembered per browser.
const stored = k => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const narrow = () => matchMedia('(max-width: 900px)').matches;
let sideCollapsed = stored('sl-side') === '1', copilotOpen = narrow() ? false : stored('sl-copilot') !== '0';
const MEMBER_PAGES = ['home', 'inbox', 'settings', 'onboarding', 'profile'];
// Demo-only sign-in, per tab: a cold visit starts signed in so links and scenes never hit a gate.
const sess = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const sessSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };
let signedIn = sess('sl-signed-in') !== '0', obStep = 0;
// The chat follows a held payment until the member picks "Something feels off" themselves.
let chatAuto = true;
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
function structuralKey() { const { sim, sim_text, csrf: _c, ...rest } = S; return JSON.stringify([rest, page, selCase, chatCase, chatLog.length, showMore, sideCollapsed, copilotOpen, signedIn, obStep]); }
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
  $('#blurb').textContent = (S.mode === 'as_is' ? 'Kit replay, as it happened. ' : 'With Second Look (proposed design). ') + S.scene.blurb;
  const shell = $('#shell');
  shell.classList.toggle('side-collapsed', sideCollapsed);
  shell.classList.toggle('copilot-closed', !copilotOpen);
  $('#side-toggle').setAttribute('aria-expanded', String(!sideCollapsed));
  $('#side-toggle').setAttribute('aria-label', sideCollapsed ? 'Expand page list' : 'Collapse page list');
  $('#copilot-toggle').setAttribute('aria-expanded', String(copilotOpen));
  $('#copilot-toggle').textContent = copilotOpen ? 'Hide chat' : 'Second Look chat';
  document.querySelectorAll('[data-page]').forEach(b => b.dataset.page === page || (page === 'onboarding' && b.dataset.page === 'settings') ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  // Account button at the bottom of the page list (member identity, sign-in state).
  const m = S.member;
  $('#acct-initial').textContent = signedIn ? m.name.trim()[0].toUpperCase() : '?';
  $('#acct-label').textContent = signedIn ? m.name : 'Signed out';
  $('#acct-name').textContent = signedIn ? `${m.name} · ${m.id}` : 'Signed out of the demo';
  $('#acct-sign').dataset.act = signedIn ? 'sign_out' : 'sign_in';
  $('#acct-sign-lbl').textContent = signedIn ? 'Sign out' : `Sign in as ${m.name} (demo)`;
  $('#acct-btn').classList.toggle('current', ['profile', 'settings', 'onboarding'].includes(page));
  const openCases = S.cases.filter(c => c.status === 'open').length;
  $('#count-console').textContent = openCases + S.callbacks.filter(x => x.status === 'waiting').length || '';
  $('#count-inbox').textContent = S.cases.length || '';
  keep(() => { $('#page').innerHTML = pageView(); $('#copilot-body').innerHTML = !copilotOpen ? '' : signedIn ? chatView() : '<p class="copilot-signedout small muted">Sign in to the Sound app to talk to Second Look.</p>'; });
  const cs = $('#chatscroll'); if (cs) cs.scrollTop = cs.scrollHeight;
  tickText();
}

/* ---------------- Pages ---------------- */
const phone = body => `<section class="phone" aria-label="Member app (concept mock of the Sound app)"><div class="app-head"><b>Sound</b><span class="small">Concept mock</span></div><div class="app-body">${body}</div><p class="footnote">Concept mock of the Sound app, not Sound software. Synthetic kit data; holds and releases change only this simulation.</p></section>`;
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
  return homeView();
}

function homeView() {
  const m = S.member;
  let out = `<div class="card"><div class="muted small">Welcome back</div><h2>${esc(m.name)}</h2>
    <div class="row small"><span class="in-badge in-badge--neutral">Second Look: ${m.enrolled ? 'On' : 'Off'}</span>${S.mode === 'as_is' ? '<span class="in-badge in-badge--neutral">Kit replay: Second Look not in use</span>' : ''}</div></div>`;
  if (S.notifications.length) { const n = S.notifications[0]; out = `<div class="lock" role="note" aria-label="Notification on the lock screen (simulated)"><div class="lock-app">Sound · ${esc(n.ts_text.split(' ')[1])}</div><div>${esc(n.text.replace(/^Sound: (.)/, (_, c) => c.toUpperCase()))}</div><div class="lock-cap">Simulated lock screen · no amounts or names shown</div></div>` + out; }
  const active = S.awaiting && S.payments.find(p => p.pid === S.awaiting);
  if (active) out += activePayment(active, caseById(active.case_id));
  out += `<div class="card feels-off"><h3>Something feels off?</h3><p class="small">A call, text or email asking for money or a code? Talk it through before you do anything. Second Look never moves money or contacts anyone for you.</p><button class="primary" data-act="chat_general">Talk to Second Look</button></div>`;
  const recent = S.payments.slice(0, 4);
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
  if (!S.cases.length) return `<div class="card"><h2>Second Look</h2><p class="muted">Nothing here. We stay quiet unless something is worth a second look.</p></div>`;
  return `<div class="card"><h2>Second Look</h2><p class="small muted">Items we noticed, with the evidence. We only interrupt you when money is about to move.</p></div>` + S.cases.map(c => {
    const p = payOf(c);
    return `<div class="card"><div class="row small"><span class="in-badge ${c.tier === 'T2' ? 'in-badge--risk' : 'in-badge--neutral'}">${c.tier === 'T2' ? 'Needs a look now' : c.tier === 'T1' ? 'Worth a second look' : 'Quiet'}</span><span class="in-badge in-badge--neutral">${esc(p.status)}</span>${c.member_label === 'looks_fine' ? `<span class="in-badge in-badge--neutral">You marked this fine${c.label_seconds != null ? ` (${c.label_seconds}s)` : ''}</span>` : ''}</div>
      <h3>${usd(p.amount)} ${esc(p.rail)} to ${esc(p.recipient)}</h3>${plainEvidence(c)}
      <details><summary>Why did I get this?</summary><p class="small">${esc(c.actions.find(a => a.action === 'case_opened')?.detail || '')}</p>${c.alert ? `<p class="small">How we told you: ${c.alert.interrupt ? 'a notification, because money was about to move' : c.alert.banner_in_place ? 'a note in the payment screen only, no notification' : 'quietly, here only'}${c.alert.suppressed ? ` (${esc(c.alert.suppressed)})` : ''}.</p>` : ''}</details>
      <div class="row">${'<button data-act="chat" data-case="' + c.id + '">Talk to Second Look</button>'}<button class="quiet" data-act="report" data-pid="${p.pid}">Report a scam</button></div></div>`;
  }).join('');
}

function settingsView() {
  const m = S.member, t = m.trusted_contact;
  return `<div class="card"><h2>Second Look</h2>
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
      <div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="tc_add">Add trusted contact</button></div>`}</div>
    <div class="card"><h2>Report a scam</h2><p class="small">If money already moved, tell us right away. Wire recalls and ACH returns can be requested but aren’t guaranteed, and the chance falls with time. Person-to-person payments can’t be recalled. You can also report to the FTC (reportfraud.ftc.gov) and the FBI’s IC3 (ic3.gov).</p>
    <div class="row">${S.cases[0] ? `<button class="primary" data-act="report" data-pid="${S.cases[0].pid}">Report the latest payment</button>` : ''}<button data-act="chat_general">Talk to Second Look</button></div></div>`;
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
    <ul class="in-ul ob-list"><li>We use payment details Sound already has: amount, recipient, how you usually pay, recent sign-in or contact changes.</li><li>We never read your texts, calls, email or browsing, and never freeze your account.</li><li>Your own payments stay your decision.</li></ul>
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
const fmtReply = t => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');

const RECOVERY = `If money already went out, every hour matters:
- **Tell Sound now.** We can request a wire recall or an ACH return. These are possible but not guaranteed, and the chance falls with time.
- Person-to-person payments usually can’t be pulled back. Contact the app you used and report it there too.
- If you shared a password or one-time code, we’ll help you secure your account.
- You can also report it to the FTC (reportfraud.ftc.gov) and the FBI’s IC3 (ic3.gov).
You did the right thing by speaking up.`;

function chatView() {
  const general = chatCase === 'general';
  const c = general ? null : caseById(chatCase);
  if (!general && !c) { chatCase = 'general'; chatLog = []; return chatView(); }
  const asked = kind => S.callbacks.some(x => x.status === 'waiting' && x.source.includes(general ? 'feels off' : `case ${chatCase}`) && x.reason.toLowerCase().includes({ talk: 'talk to a person', sent: 'money already', report: 'reporting' }[kind]));
  const intro = general ? 'I’m here to help you think it through. What happened? For example: who contacted you, and what are they asking you to do?' : 'I’m here to help you think this through. You decide. What would you like to check first?';
  const subject = general ? 'Something feels off' : `About your ${usd0(payOf(c).amount)} ${esc(payOf(c).rail.toLowerCase())}`;
  const help = [['talk', 'Talk to a person at Sound', 'A person at Sound will call you'], ['sent', 'I already sent money', 'Recovery team notified'], ['report', 'Report a scam', 'Reported']];
  const starters = general ? ['Someone says they’re from my bank', 'I’m being asked to pay with gift cards', 'Someone I met online needs money'] : ['Who should I check this with?', 'Is this a common scam?', 'I know this person'];
  const msgs = [{ role: 'assistant', text: intro }, ...chatLog];
  return `<div class="chat-screen">
    <div class="chat-top"><div class="chat-title"><div class="chat-name">Second Look</div><div class="chat-sub">${subject}</div></div>
      ${general ? '' : '<button class="quiet" data-act="chat_general">New chat</button>'}
      <button class="icon-btn" data-act="back" aria-label="Close chat">×</button></div>
    ${general ? '' : det('chat-ev-' + c.id, 'What Second Look can see', `<div class="chat-evidence">${plainEvidence(c)}</div>`)}
    <div class="chat-scroll" id="chatscroll"><div class="chat" aria-live="polite" aria-relevant="additions">${msgs.map(m => `<div class="msg ${m.role}${m.pending ? ' pending' : ''}">${m.role === 'assistant' ? fmtReply(m.text) : esc(m.text)}${m.role === 'assistant' && m.source === 'offline' ? '<div class="small muted">offline reply</div>' : ''}</div>`).join('')}</div>
      ${chatLog.length ? '' : `<div class="chat-starters">${starters.map(t => `<button class="chat-starter" data-act="send" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>`}</div>
    <div class="chat-dock">
      <div class="chat-chips" role="group" aria-label="Get help">${help.map(([k, label, done]) => `<button class="chat-chip" data-act="cb" data-kind="${k}" ${asked(k) ? 'disabled' : ''}>${asked(k) ? done : label}</button>`).join('')}</div>
      <div class="composer"><label for="chatin" class="sr">Message</label><textarea id="chatin" data-keep rows="1" placeholder="Message Second Look"></textarea>
        <button class="primary composer-send" data-act="send" aria-label="Send">↑</button></div>
      <p class="chat-note">Second Look can’t send money, release payments, click links or contact anyone. It only helps you decide.</p>
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
  const waiting = S.callbacks.filter(x => x.status === 'waiting').sort((a, b) => b.urgent - a.urgent);
  const cbCard = S.callbacks.length ? `<div class="card"><div class="console-head"><h2>Members asking to talk</h2><span class="small muted">${waiting.length} waiting · never quieted by alert limits</span></div>
    ${S.callbacks.map(x => `<div class="callback ${x.status}">${x.urgent ? '<span class="in-badge in-badge--risk">Urgent</span> ' : ''}<b>${esc(x.reason)}</b><div class="small muted">${esc(S.member.id)} · ${esc(x.source)} · ${esc(x.ts_text.split(' ')[1])}${x.status === 'done' ? ` · done: ${esc(x.note)}` : ''}</div>
      ${x.status === 'waiting' ? `<div class="row" style="margin-top:6px"><button class="primary" data-act="cb_done" data-id="${x.id}">Called the member</button>${x.reason.includes('money already') ? '<button data-act="cb_done" data-id="' + x.id + '" data-note="Recovery request started">Start recovery request</button>' : ''}</div>` : ''}</div>`).join('')}</div>` : '';
  let out = cbCard + `<div class="card"><div class="console-head"><h2>Sound employee console <span class="in-badge in-badge--neutral">simulated</span></h2><span class="small muted">Sorted by time left in hold (the 4-hour clock is the SLA)</span></div>
    <div class="table-wrap"><table><thead><tr><th>Member</th><th>Payment</th><th>Why</th><th>Status</th><th>Hold left</th></tr></thead><tbody>
    ${open.map(rowHtml).join('') || '<tr><td colspan="5" class="muted">No open items.</td></tr>'}
    ${closed.length ? `<tr><td colspan="5" class="muted small">Closed</td></tr>` + closed.map(rowHtml).join('') : ''}</tbody></table></div></div>`;
  if (c) out += caseDetail(c);
  if (S.mode === 'as_is') out += timelineCard(true); // the as-is replay is the timeline
  return out;
}

const PRESETS = { Held: ['Member confirmed by phone: legitimate', 'Verified with a contact the member already had', 'Member reconfirmed in branch'] };

function caseDetail(c) {
  const p = payOf(c), r = p.row, open = c.status === 'open';
  const can = { release: p.status === 'Held', review: p.gate === 'presubmit_review' && p.status === 'Pending', branch: p.gate === 'branch_conversation' && p.status === 'Pending', verify: c.rule === 'R2' && open && !p.ato_verified, stop: open && p.ato_verified, cancel: open && (p.status === 'Held' || p.status === 'Pending') };
  const sig = reasons(c).filter(x => x.value);
  const kind = p.rail === 'P2P' ? 'P2P payment' : p.rail === 'Cash' ? 'cash withdrawal' : p.rail.toLowerCase();
  const state = !open ? `Closed: ${p.status}` : p.status === 'Held' ? 'On hold' : p.gate === 'presubmit_review' ? 'Waiting before submit' : p.gate === 'branch_conversation' ? 'Branch conversation' : p.gate === 'banner_confirm' ? 'Member is confirming' : p.status;
  const memberView = c.member_label === 'looks_fine' ? `Member marked it fine${c.label_seconds != null ? ` in ${c.label_seconds}s` : ''}` : c.member_label === 'reported' ? 'Member reported a scam' : c.callback_requested ? 'Member asked to talk' : '';
  const q = GUIDE[c.rule] || GUIDE.STD;
  let step2 = '';
  if (can.release) step2 = `<li><b>Record the outcome</b>
      <div class="row presets">${PRESETS.Held.map(t => `<button class="chipbtn" data-act="preset" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <label for="reason" class="small muted">Reason (required to release)</label><input type="text" id="reason" data-keep>
      <div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="e_release">Release hold</button><button data-act="e_member_cancel">Member chose to cancel</button></div></li>`;
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
          <ul class="questions">${q.slice(0, 2).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          ${q.length > 2 ? det('e-q-' + c.id, `${q.length - 2} more questions and red flags`, `<ul class="questions">${q.slice(2).map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="small">${esc(CUES)}</p>`) : ''}
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
  if (b.dataset.page) { page = b.dataset.page; if (narrow()) sideCollapsed = true; $('#main').scrollTo?.(0, 0); return render(); }
  const a = b.dataset.act, pid = b.dataset.pid, cid = Number(b.dataset.case || selCase);
  const reason = () => ($('#reason')?.value || '').trim();
  const E = (act, extra = {}) => post('employee/' + act, { caseId: selCase, reason: reason(), ...extra }).then(j => { if (j && j.ok && $('#reason')) $('#reason').value = ''; });
  switch (a) {
    case 'select': selCase = cid; return render();
    case 'more': showMore[cid] = !showMore[cid]; return render();
    case 'chat_general': chatAuto = false; chatCase = 'general'; openCopilot(); chatLog = await (await fetch('/api/chat/general')).json(); return render(true);
    case 'cb': {
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
    case 'send': { const t = (b.dataset.text || $('#chatin').value).trim(); if (!t) return; $('#chatin').value = '';
      chatLog.push({ role: 'user', text: t }); const pend = { role: 'assistant', text: 'Second Look is thinking…', pending: true }; chatLog.push(pend); render(true);
      const j = await post('chat/' + chatCase, { text: t });
      chatLog.splice(chatLog.indexOf(pend), 1);
      if (j && j.reply) chatLog.push({ role: 'assistant', text: j.reply, source: j.source });
      return render(true); }
    case 'onboarding': page = 'onboarding'; obStep = 0; return render();
    case 'sign_in': signedIn = true; sessSet('sl-signed-in', '1'); page = 'home'; return render();
    case 'sign_in_setup': signedIn = true; sessSet('sl-signed-in', '1'); page = 'onboarding'; obStep = 0; return render();
    case 'sign_out': signedIn = false; sessSet('sl-signed-in', '0'); page = 'home'; return render();
    case 'ob_next': obStep = Math.min(obStep + 1, 4); return render();
    case 'ob_back': obStep = Math.max(obStep - 1, 0); return render();
    case 'ob_on': await post('member/enroll', { on: true }); obStep = 2; return render();
    case 'ob_skip': await post('member/enroll', { on: false }); obStep = 4; return render();
    case 'ob_done': page = 'home'; obStep = 0; return render();
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
document.addEventListener('change', e => {
  if (e.target.id === 'enroll') post('member/enroll', { on: e.target.checked });
  if (e.target.id === 'quiet') post('member/alert_settings', { quiet: e.target.checked });
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

// Deep links for slides: /?scene=m1057&play=1&view=employee
(async () => {
  const q = new URLSearchParams(location.search);
  const v = q.get('view'), pg = q.get('page');
  if (v === 'member') page = 'home'; else if (v === 'employee') page = 'console'; else if (v === 'both') page = 'split';
  if (['home', 'inbox', 'settings', 'profile', 'onboarding', 'console', 'split', 'timeline'].includes(pg)) page = pg;
  if (q.get('chat') === 'general') { chatAuto = false; chatCase = 'general'; copilotOpen = true; }
  await poll();
  if (q.get('scene') && S.scenes.some(x => x.id === q.get('scene'))) { await post('scene/' + q.get('scene')); if (q.get('jump') === '1') for (let i = 0; i < 60 && !S.awaiting && !S.ended; i++) await post('control/next');
    if (q.get('play') === '1') await post('control/play'); }
  setInterval(() => { if (!busy) poll(); }, 800);
})();
