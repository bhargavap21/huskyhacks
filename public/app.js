// Second Look demo UI. Plain JS; polls /api/state and renders the member app + employee console.
const openDet = new Map();
let S = null, csrf = '', view = 'both', screen = 'home', selCase = null, chatCase = null, chatLog = [], showMore = {}, busy = false;
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
  const r = await fetch('/api/state'); S = await r.json(); csrf = S.csrf; render();
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
function structuralKey() { const { sim, sim_text, csrf: _c, ...rest } = S; return JSON.stringify([rest, view, screen, selCase, chatCase, chatLog.length, showMore]); }
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
  const g = $('#grid'); g.className = 'grid' + (view === 'member' ? ' only-member' : view === 'employee' ? ' only-employee' : '');
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  document.querySelectorAll('[data-screen]').forEach(b => b.dataset.screen === screen ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  keep(() => { $('#member').innerHTML = memberView(); $('#employee').innerHTML = employeeView(); });
  tickText();
}

/* ---------------- Member app ---------------- */
const caseById = id => S.cases.find(c => c.id === id);
const payOf = c => S.payments.find(p => p.pid === c.pid);
const plainEvidence = c => `<ul>${c.evidence.map(e => `<li>${esc(e.why)}: <b>${esc(e.value)}</b></li>`).join('')}</ul>`;

function memberView() {
  if (screen === 'chat' && chatCase) return chatView();
  if (screen === 'onboarding') return onboardingView();
  if (screen === 'settings') return settingsView();
  if (screen === 'inbox') return inboxView();
  return homeView();
}

function homeView() {
  const m = S.member;
  let out = `<div class="card"><div class="muted small">Welcome back</div><h2>${esc(m.name)}</h2>
    <div class="row small"><span class="in-badge in-badge--neutral">Second Look: ${m.enrolled ? 'On' : 'Off'}</span>${S.mode === 'as_is' ? '<span class="in-badge in-badge--neutral">Kit replay: Second Look not in use</span>' : ''}</div></div>`;
  if (S.notifications.length) { const n = S.notifications[0]; out = `<div class="lock" role="note" aria-label="Notification on the lock screen (simulated)"><div class="lock-app">Sound · ${esc(n.ts_text.split(' ')[1])}</div><div>${esc(n.text.replace(/^Sound: (.)/, (_, c) => c.toUpperCase()))}</div><div class="lock-cap">Simulated lock screen · no amounts or names shown</div></div>` + out; }
  const active = S.awaiting && S.payments.find(p => p.pid === S.awaiting);
  if (active) out += activePayment(active, caseById(active.case_id));
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
    <button class="quiet" data-act="onboarding">See the onboarding screen</button></div>
    <div class="card"><h2>Alerts</h2><p class="small">We stay quiet unless something is worth a look. When money is about to move, we always show it in the payment screen.</p>
    <fieldset style="border:0;padding:0;margin:0"><legend class="small muted">How many alerts</legend><div class="row">${['fewer', 'standard', 'more'].map(v => `<button data-act="sens" data-v="${v}" aria-pressed="${S.alerts.sensitivity === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></fieldset>
    <div class="switch" style="margin-top:var(--space-2)"><label for="quiet">Quiet hours, 9 pm to 7 am (a paused payment still reaches you)</label><input type="checkbox" id="quiet" ${S.alerts.quiet ? 'checked' : ''}></div></div>
    <div class="card"><h2>Trusted contact <span class="in-badge in-badge--neutral">optional</span></h2>
    ${t ? `<p>${esc(t.name)} (${esc(t.relation)}) is told when a payment is paused. They never see your balances and can never act on your account.</p><button data-act="tc_remove">Remove trusted contact</button>`
      : `<p class="small">Choose someone you trust who is <b>not involved</b> in your payments. They’re only informed, never given access or control. You can remove them any time.</p>
      <label for="tcname">Name</label><input type="text" id="tcname" data-keep><label for="tcrel">Relationship</label><input type="text" id="tcrel" data-keep>
      <div class="row" style="margin-top:var(--space-2)"><button class="primary" data-act="tc_add">Add trusted contact</button></div>`}</div>
    <div class="card"><h2>Report a scam</h2><p class="small">If money already moved, tell us right away. Wire recalls and ACH returns can be requested but aren’t guaranteed, and the chance falls with time. Person-to-person payments can’t be recalled. You can also report to the FTC (reportfraud.ftc.gov) and the FBI’s IC3 (ic3.gov).</p>
    ${S.cases[0] ? `<button class="primary" data-act="report" data-pid="${S.cases[0].pid}">Report the latest payment</button>` : ''}</div>`;
}

function onboardingView() {
  return `<div class="card"><h2>Turn on Second Look?</h2>
    <p>We watch for signs someone may be manipulating you, and a Sound employee can step in before money moves.</p>
    <details><summary>What we use / what we never do</summary><p class="small">We use the payment details Sound already has. We never read your texts, calls or email. Your own payments stay your decision.</p></details>
    <div class="stack"><button class="primary" data-act="enroll_on">Turn on</button><button data-act="enroll_skip">Not now</button></div>
    <p class="small muted">You can change this any time in Settings. We won’t keep asking.</p></div>`;
}

// Escape first, then allow only **bold** and line breaks (no raw HTML from the model).
const fmtReply = t => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');

function chatView() {
  const c = caseById(chatCase); if (!c) { screen = 'home'; return homeView(); }
  return `<div class="row"><button class="quiet" data-act="back">← Back</button><span class="in-badge in-badge--neutral">About: ${usd(payOf(c).amount)} ${esc(payOf(c).rail)}</span></div>
    <div class="card small"><b>Evidence I’m using</b>${plainEvidence(c)}</div>
    <div class="chat" aria-live="polite" aria-relevant="additions">${chatLog.map(m => `<div class="msg ${m.role}">${m.role === 'assistant' ? fmtReply(m.text) : esc(m.text)}${m.role === 'assistant' && m.source === 'offline' ? '<div class="small muted">offline reply</div>' : ''}</div>`).join('') || '<div class="msg assistant">I’m here to help you think this through. You decide. What would you like to check first?</div>'}</div>
    <p class="small muted">Second Look can’t send money, release payments, click links or contact anyone. It only helps you decide.</p>
    <label for="chatin" class="sr">Message</label><textarea id="chatin" data-keep rows="2" placeholder="Type a message"></textarea>
    <button class="primary" data-act="send">Send</button>`;
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
  let out = `<div class="card"><div class="console-head"><h2>Sound employee console <span class="in-badge in-badge--neutral">simulated</span></h2><span class="small muted">Sorted by time left in hold (the 4-hour clock is the SLA)</span></div>
    <div class="table-wrap"><table><thead><tr><th>Member</th><th>Payment</th><th>Why</th><th>Status</th><th>Hold left</th></tr></thead><tbody>
    ${open.map(rowHtml).join('') || '<tr><td colspan="5" class="muted">No open items.</td></tr>'}
    ${closed.length ? `<tr><td colspan="5" class="muted small">Closed</td></tr>` + closed.map(rowHtml).join('') : ''}</tbody></table></div></div>`;
  if (c) out += caseDetail(c);
  const tl = S.timeline.slice().reverse();
  out += `<div class="card">${det('kit-tl', `Kit timeline, ${S.mode === 'as_is' ? 'as it happened' : 'with Second Look'} <span class="muted small">(${tl.length} events${tl[0] ? ` · latest ${esc(tl[0].ts_text.split(' ')[1])}` : ''})</span>`, `<div class="timeline">${tl.map(t => `<div class="${t.kind}">${esc(t.ts_text)} · ${esc(t.text)}</div>`).join('') || '<div class="muted">Press Play to start the replay.</div>'}</div>`, S.mode === 'as_is')}</div>`;
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
  const b = e.target.closest('[data-act],[data-view],[data-screen]'); if (!b) return;
  if (b.dataset.view) { view = b.dataset.view; return render(); }
  if (b.dataset.screen) { screen = b.dataset.screen; return render(); }
  const a = b.dataset.act, pid = b.dataset.pid, cid = Number(b.dataset.case || selCase);
  const reason = () => ($('#reason')?.value || '').trim();
  const E = (act, extra = {}) => post('employee/' + act, { caseId: selCase, reason: reason(), ...extra }).then(j => { if (j && j.ok && $('#reason')) $('#reason').value = ''; });
  switch (a) {
    case 'select': selCase = cid; return render();
    case 'more': showMore[cid] = !showMore[cid]; return render();
    case 'chat': chatCase = cid; screen = 'chat'; chatLog = await (await fetch('/api/chat/' + cid)).json(); return render();
    case 'back': screen = 'home'; return render();
    case 'send': { const t = $('#chatin').value.trim(); if (!t) return; $('#chatin').value = ''; chatLog.push({ role: 'user', text: t }); render();
      const j = await post('chat/' + chatCase, { text: t }); if (j && j.reply) chatLog.push({ role: 'assistant', text: j.reply, source: j.source }); return render(); }
    case 'onboarding': screen = 'onboarding'; return render();
    case 'enroll_on': await post('member/enroll', { on: true }); screen = 'home'; return toast('Second Look is on. Turn it off any time in Settings.');
    case 'enroll_skip': await post('member/enroll', { on: false }); screen = 'home'; return;
    case 'sens': return post('member/alert_settings', { sensitivity: b.dataset.v });
    case 'tc_add': return post('member/trusted_contact', { name: $('#tcname').value, relation: $('#tcrel').value });
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
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('tr[data-act]')) e.target.click(); });
document.addEventListener('change', e => {
  if (e.target.id === 'enroll') post('member/enroll', { on: e.target.checked });
  if (e.target.id === 'quiet') post('member/alert_settings', { quiet: e.target.checked });
});
$('#scene').addEventListener('change', async e => { selCase = null; chatCase = null; screen = 'home'; showMore = {}; await post('scene/' + e.target.value); });
$('#play').addEventListener('click', () => post('control/' + (S.running ? 'pause' : 'play')));
$('#next').addEventListener('click', () => post('control/next'));
$('#faster').addEventListener('click', () => post('control/faster'));
$('#reset').addEventListener('click', () => { selCase = null; chatCase = null; screen = 'home'; post('control/reset'); });

// Deep links for slides: /?scene=m1057&play=1&view=employee
(async () => {
  const q = new URLSearchParams(location.search);
  if (['both', 'member', 'employee'].includes(q.get('view'))) view = q.get('view');
  await poll();
  if (q.get('scene') && S.scenes.some(x => x.id === q.get('scene'))) { await post('scene/' + q.get('scene')); if (q.get('jump') === '1') for (let i = 0; i < 60 && !S.awaiting && !S.ended; i++) await post('control/next');
    if (q.get('play') === '1') await post('control/play'); }
  setInterval(() => { if (!busy) poll(); }, 800);
})();
