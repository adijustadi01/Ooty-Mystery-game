// Ooty Mysteries — game shell: menus, case loading, investigation loop, accusation and scoring.
// All case content lives in cases/caseNN.json; nothing here is specific to one case.
import * as THREE from '../lib/three.module.min.js';
import { World } from './world.js';
import { Controls } from './controls.js';
import { Ambience } from './audio.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = s => esc(s).replace(/\n/g, '<br>');
const initials = name => name.replace(/^(Dr|Mr|Mrs|Miss|Capt|Col)\.?\s+/i, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

const PLAYER_R = 0.3, EYE = 1.62, REACH = 3.2;
const STORE = 'ootyMysteries.v1';

// ---------- persistence ----------
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { cases: {}, saves: {} }; }
  catch { return { cases: {}, saves: {} }; }
}
function saveProgress() {
  try { localStorage.setItem(STORE, JSON.stringify(state.progress)); } catch {}
}

const state = {
  cases: [],
  progress: loadProgress(),
  data: null,          // current case
  index: -1,
  found: new Set(),    // clue ids
  statements: new Set(), // dialogue topic ids
  seenTimeline: 0,
  unseenClues: 0,
  overlay: null,
  playing: false,
  hovered: null,
  room: null
};
state.progress.cases ||= {};
state.progress.saves ||= {};

// ---------- three.js setup ----------
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
camera.rotation.order = 'YXZ';
const world = new World(scene);
const audio = new Ambience();
const raycaster = new THREE.Raycaster();
const player = new THREE.Vector3();

const controls = new Controls(canvas, {
  onInteract: point => interact(point),
  onUnlock: () => { if (state.playing && !state.overlay) showPause(); },
  onLockChange: () => updateLockHint(),
  onKey: (code, e) => onKey(code, e)
});
if (controls.isTouch) document.body.classList.add('touch');

function resize() {
  const touch = controls.isTouch;
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = innerWidth < innerHeight ? 80 : 70;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- screens ----------
const screens = ['menu', 'cases', 'intro', 'result'];
function show(name) {
  for (const s of screens) $('#screen-' + s).classList.toggle('hidden', s !== name);
  $('#hud').classList.toggle('hidden', name !== 'game');
  state.playing = name === 'game';
  controls.enabled = state.playing && !state.overlay;
  if (!state.playing) { controls.unlock(); audio.stop(); }
}

function soundLabel() { $('#btn-sound').textContent = audio.enabled ? '🔊 Sound: On' : '🔇 Sound: Off'; }
$('#btn-sound').onclick = () => { audio.setEnabled(!audio.enabled); soundLabel(); };
soundLabel();
$('#btn-cases').onclick = () => { renderCaseList(); show('cases'); };
$('#btn-howto').onclick = () => howTo();
$('#btn-reset').onclick = () => {
  if (!confirm('Erase all solved cases and saved investigations?')) return;
  state.progress = { cases: {}, saves: {} };
  saveProgress();
  toast('Progress reset');
};
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => show(b.dataset.back));

// ---------- case discovery: cases/case01.json, case02.json, ... until one is missing ----------
async function discoverCases() {
  const list = [];
  for (let i = 1; i <= 99; i++) {
    const id = 'case' + String(i).padStart(2, '0');
    let res;
    try { res = await fetch(`cases/${id}.json`, { cache: 'no-cache' }); } catch { break; }
    if (!res.ok) break;
    try {
      const data = await res.json();
      data.id ||= id;
      data.number = i;
      list.push(data);
    } catch (err) {
      console.error(`cases/${id}.json is not valid JSON`, err);
      list.push({ id, number: i, title: 'Damaged case file', subtitle: `cases/${id}.json could not be read`, broken: true });
    }
  }
  return list;
}

function isUnlocked(i) {
  if (i === 0) return true;
  const prev = state.cases[i - 1];
  return !!state.progress.cases[prev.id]?.solved;
}

function renderCaseList() {
  const el = $('#case-list');
  el.innerHTML = state.cases.map((c, i) => {
    const p = state.progress.cases[c.id];
    const unlocked = isUnlocked(i) && !c.broken;
    const inProgress = state.progress.saves[c.id];
    let stamp = '', status = '';
    if (!unlocked) status = '🔒 Locked — solve the previous case';
    else if (p?.solved) { stamp = '<span class="stamp solved">SOLVED</span>'; status = `★ Best score: ${p.best}/100`; }
    else if (inProgress) status = '🔎 Investigation in progress';
    else if (p?.attempts) status = `Unsolved — best ${p.best}/100. Try again.`;
    else { stamp = '<span class="stamp">NEW</span>'; status = 'Open the file →'; }
    return `<button class="case-card ${unlocked ? '' : 'locked'}" data-i="${i}" ${unlocked ? '' : 'aria-disabled="true"'}>
      ${stamp}<span class="num">CASE ${String(c.number).padStart(2, '0')}</span>
      <h3>${esc(c.title)}</h3><p>${esc(c.subtitle || '')}</p><span class="status">${status}</span></button>`;
  }).join('') || '<p class="empty">No case files found in /cases.</p>';
  el.querySelectorAll('.case-card').forEach(b => b.onclick = () => {
    const i = +b.dataset.i;
    if (!isUnlocked(i) || state.cases[i].broken) { toast('Solve the previous case to unlock this one'); return; }
    openIntro(i);
  });
}

function openIntro(i) {
  const c = state.cases[i];
  state.index = i;
  $('#intro-number').textContent = `Case ${String(c.number).padStart(2, '0')}`;
  $('#intro-title').textContent = c.title;
  $('#intro-subtitle').textContent = c.subtitle || '';
  $('#intro-text').innerHTML = (c.intro || []).map(p => `<p>${para(p)}</p>`).join('');
  const b = c.briefing || {};
  const rows = [['Victim', b.victim], ['Discovered', b.found], ['Location', b.location], ['Notes', b.notes]].filter(r => r[1]);
  $('#intro-briefing').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  $('#intro-briefing').classList.toggle('hidden', !rows.length);
  const save = state.progress.saves[c.id];
  $('#intro-buttons').innerHTML = (save
    ? `<button class="btn primary" id="go-resume">Resume Investigation</button><button class="btn" id="go-new">Start Over</button>`
    : `<button class="btn primary" id="go-new">Begin Investigation</button>`) + `<button class="btn ghost" id="go-back">Back</button>`;
  $('#go-new').onclick = () => startCase(i, false);
  if (save) $('#go-resume').onclick = () => startCase(i, true);
  $('#go-back').onclick = () => { renderCaseList(); show('cases'); };
  show('intro');
  $('#screen-intro').scrollTop = 0;
}

// ---------- starting / saving a case ----------
function startCase(i, resume) {
  const data = state.data = state.cases[i];
  state.index = i;
  const save = resume ? state.progress.saves[data.id] : null;
  state.found = new Set(save?.found || []);
  state.statements = new Set(save?.statements || []);
  state.unseenClues = 0;
  if (!resume) delete state.progress.saves[data.id];
  world.build(data);
  for (const id of state.found) {
    const c = clue(id);
    if (c) world.markClueFound(id, c.pickup !== false);
  }
  state.seenTimeline = unlockedTimeline().length;
  const st = save?.player || data.start || {};
  const [x, z] = save?.player ? [st.x, st.z] : world.toWorld(st.room || data.rooms[0].id, st.pos || [0, 0]);
  player.set(x, 0, z);
  controls.yaw = save?.player ? st.yaw : (st.facing || 0) * Math.PI / 180;
  controls.pitch = 0;
  controls.reset();
  state.room = null;
  $('#hud-case').textContent = data.title;
  updateBadges();
  show('game');
  audio.start(data.setting?.weather);
  updateLockHint();
  if (!controls.isTouch) controls.lock();
  if (!resume) setTimeout(() => toast('Search the rooms. Question everyone. Then accuse.'), 900);
}

function persist() {
  if (!state.data) return;
  state.progress.saves[state.data.id] = {
    found: [...state.found], statements: [...state.statements],
    player: { x: +player.x.toFixed(2), z: +player.z.toFixed(2), yaw: +controls.yaw.toFixed(3) }
  };
  saveProgress();
}
setInterval(() => { if (state.playing) persist(); }, 5000);

// ---------- case data helpers ----------
const clue = id => state.data.clues.find(c => c.id === id);
const suspect = id => state.data.suspects.find(s => s.id === id);
const known = () => new Set([...state.found, ...state.statements]);
function unlockedTimeline() {
  const k = known();
  return (state.data.timeline || []).filter(t => !t.unlockedBy?.length || t.unlockedBy.some(id => k.has(id)));
}
function topicStatement(id) {
  for (const s of state.data.suspects) {
    const t = (s.dialogue || []).find(d => d.id === id);
    if (t) return { suspect: s, topic: t };
  }
  return null;
}
function checkTimeline() {
  const n = unlockedTimeline().length;
  if (n > state.seenTimeline) {
    toast(`🕰️ Timeline updated (+${n - state.seenTimeline})`);
    audio.chime('timeline');
    state.timelineBadge = (state.timelineBadge || 0) + n - state.seenTimeline;
    state.seenTimeline = n;
  }
  updateBadges();
}
function updateBadges() {
  const nb = $('#badge-notebook'), tb = $('#badge-timeline');
  nb.textContent = state.unseenClues; nb.classList.toggle('hidden', !state.unseenClues);
  tb.textContent = state.timelineBadge || 0; tb.classList.toggle('hidden', !state.timelineBadge);
  if (state.data) $('#clue-count').textContent = `Clues ${state.found.size}/${state.data.clues.length}`;
}

// ---------- overlays ----------
function openOverlay(html, cls = '') {
  const ov = $('#overlay'), panel = $('#overlay-panel');
  panel.className = 'panel ' + cls;
  panel.innerHTML = html;
  ov.classList.remove('hidden');
  state.overlay = true;
  state.overlayAt = performance.now();
  controls.enabled = false;
  controls.reset();
  controls.unlock();
  $('#prompt').classList.add('hidden');
  panel.querySelectorAll('[data-close]').forEach(b => b.onclick = closeOverlay);
  return panel;
}
function closeOverlay() {
  $('#overlay').classList.add('hidden');
  state.overlay = null;
  if (state.playing) {
    controls.enabled = true;
    if (!controls.isTouch) controls.lock();
    updateLockHint();
  }
}
$('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay' && state.playing) closeOverlay(); });

function updateLockHint() {
  const el = $('#lock-hint');
  const show = state.playing && !state.overlay && !controls.isTouch && !controls.locked;
  el.classList.toggle('hidden', !show);
  el.innerHTML = controls.usesCursor
    ? 'Drag to look · <kbd>W A S D</kbd> to move · Click objects and people to examine'
    : '<b>Click to look around</b> · <kbd>W A S D</kbd> move · <kbd>Shift</kbd> run · Click to examine · <kbd>N</kbd> notebook · <kbd>T</kbd> timeline';
  el.className = show ? 'hint' : 'hint hidden';
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3300);
}

// ---------- interaction ----------
const ndc = new THREE.Vector2();
function pick(point) {
  if (!world.root) return null;
  if (point) ndc.set(point.x / innerWidth * 2 - 1, -(point.y / innerHeight) * 2 + 1);
  else ndc.set(0, 0);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = REACH + 1;
  const hits = raycaster.intersectObject(world.root, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.interact) o = o.parent;
    if (o) return h.distance <= REACH ? o.userData.interact : null;
    if (h.object.material && h.object.material.transparent && h.object.material.opacity < 0.5) continue; // see through glass
    return null; // something solid is in the way
  }
  return null;
}

function interact(point) {
  if (!state.playing || state.overlay) return;
  const target = point ? pick(point) : state.hovered;
  if (!target) return;
  if (target.kind === 'clue') showClue(target.id);
  else if (target.kind === 'suspect') showDialogue(target.id);
  else if (target.kind === 'prop') openOverlay(`
    <div class="panel-head"><h3>${esc(target.name)}</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="panel-body"><p>${para(target.text)}</p></div>
    <div class="panel-foot"><button class="btn primary" data-close>Continue</button></div>`, 'narrow');
}

function clueIcon(c) {
  return { paper: '📜', slate: '🪧', book: '📕', glass: '🥃', bottle: '🧪', watch: '⌚', bag: '💼', umbrella: '☂️', lantern: '🏮', necklace: '💎' }[c.shape] || '🔎';
}

function showClue(id) {
  const c = clue(id);
  const isNew = !state.found.has(id);
  if (isNew) {
    state.found.add(id);
    state.unseenClues++;
    world.markClueFound(id, c.pickup !== false);
    audio.chime('clue');
    persist();
  }
  openOverlay(`
    <div class="panel-head"><h3>${esc(c.name)}</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="panel-body"><div class="clue-card"><div class="swatch" style="background:${esc(c.color || '#888')}">${clueIcon(c)}</div>
      <div>${isNew ? '<span class="new-tag">NEW CLUE — ADDED TO NOTEBOOK</span>' : '<span class="new-tag">IN YOUR NOTEBOOK</span>'}<p>${para(c.description)}</p></div></div></div>
    <div class="panel-foot"><button class="btn primary" data-close>Continue</button></div>`, 'narrow');
  checkTimeline();
}

function portrait(s) {
  return `<div class="portrait" style="background:${esc(s.color || '#555')}">${esc(initials(s.name))}</div>`;
}

function showDialogue(id, line) {
  const s = suspect(id);
  const k = known();
  const topics = (s.dialogue || []).filter(t => (t.requires || []).every(r => k.has(r)));
  const lockedCount = (s.dialogue || []).length - topics.length;
  const panel = openOverlay(`
    <div class="panel-head"><h3>${esc(s.name)}</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="panel-body">
      <div class="dialogue">${portrait(s)}
        <div style="flex:1;width:100%">
          <p class="speech"><span class="who">${esc(s.name.toUpperCase())} — ${esc(s.role || '')}</span><span id="speech-text"></span></p>
          <div class="topics">${topics.map(t => `<button class="topic ${state.statements.has(t.id) ? 'asked' : ''} ${t.requires?.length ? 'evidence' : ''}" data-topic="${esc(t.id)}">${esc(t.ask)}</button>`).join('')}</div>
          ${lockedCount ? `<p class="meta" style="color:var(--ink-faint);font-size:.85rem;font-style:italic;margin-top:12px">Find more evidence to unlock ${lockedCount} more question${lockedCount > 1 ? 's' : ''}.</p>` : ''}
        </div>
      </div>
    </div>
    <div class="panel-foot"><button class="btn" data-close>Goodbye</button></div>`);
  typeText(panel.querySelector('#speech-text'), line || s.greeting || '…');
  panel.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => {
    const t = s.dialogue.find(d => d.id === b.dataset.topic);
    const isNew = !state.statements.has(t.id);
    if (isNew) {
      state.statements.add(t.id);
      if (t.statement) { state.unseenClues++; toast('📓 Statement noted'); }
      audio.chime('talk');
      persist();
    }
    const before = topics.length;
    checkTimeline();
    // newly unlocked questions (e.g. from statements) need a re-render
    const now = (s.dialogue || []).filter(d => (d.requires || []).every(r => known().has(r))).length;
    if (now !== before || isNew) showDialogue(id, t.answer);
    else typeText(panel.querySelector('#speech-text'), t.answer);
  });
}

let typer = null;
function typeText(el, text) {
  clearInterval(typer);
  let i = 0;
  el.textContent = '';
  const step = Math.max(1, Math.round(text.length / 90));
  typer = setInterval(() => {
    i += step;
    el.textContent = text.slice(0, i);
    if (i >= text.length) clearInterval(typer);
  }, 16);
  el.closest('.speech').onclick = () => { clearInterval(typer); el.textContent = text; };
}

// ---------- notebook ----------
function showNotebook(tab = 'clues') {
  state.unseenClues = 0;
  updateBadges();
  const d = state.data, b = d.briefing || {};
  const tabs = { case: 'Case File', clues: `Clues (${state.found.size})`, statements: `Statements (${[...state.statements].filter(id => topicStatement(id)?.topic.statement).length})`, suspects: 'Suspects' };
  let body = '';
  if (tab === 'case') {
    body = `<div class="entry"><h4>${esc(d.title)}</h4><p class="meta">${esc(d.subtitle || '')}</p></div>` +
      [['Victim', b.victim], ['Discovered', b.found], ['Location', b.location], ['Notes', b.notes]].filter(r => r[1])
        .map(([k, v]) => `<div class="entry"><h4>${k}</h4><p>${esc(v)}</p></div>`).join('');
  } else if (tab === 'clues') {
    const list = d.clues.filter(c => state.found.has(c.id));
    body = list.length ? list.map(c => `<div class="entry"><h4>${clueIcon(c)} ${esc(c.name)}</h4><p class="meta">Found in: ${esc(world.room(c.room)?.name || c.room)}</p><p>${para(c.description)}</p></div>`).join('')
      : '<p class="empty">No clues yet. Walk the rooms and look for glinting objects.</p>';
    body += `<p class="meta" style="margin-top:12px">${d.clues.length - list.length} clue(s) still undiscovered.</p>`;
  } else if (tab === 'statements') {
    const list = [...state.statements].map(topicStatement).filter(x => x?.topic.statement);
    body = list.length ? list.map(({ suspect: s, topic: t }) => `<div class="entry"><h4>${esc(s.name)}</h4><p>${esc(t.statement)}</p></div>`).join('')
      : '<p class="empty">Nobody has told you anything yet. Talk to the suspects.</p>';
  } else {
    body = d.suspects.map(s => {
      const asked = (s.dialogue || []).filter(t => state.statements.has(t.id)).length;
      return `<div class="entry" style="display:flex;gap:12px;align-items:flex-start">${portrait(s)}<div><h4>${esc(s.name)}</h4><p class="meta">${esc(s.role || '')} · ${asked}/${(s.dialogue || []).length} questions asked</p><p>${esc(s.bio || '')}</p></div></div>`;
    }).join('');
  }
  const panel = openOverlay(`
    <div class="panel-head"><h3>📓 Notebook</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div class="panel-body">${body}</div>
    <div class="panel-foot"><button class="btn" data-close>Close</button></div>`);
  panel.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showNotebook(b.dataset.tab));
}

function showTimeline() {
  state.timelineBadge = 0;
  updateBadges();
  const k = known();
  const items = (state.data.timeline || []).map(t => {
    const open = !t.unlockedBy?.length || t.unlockedBy.some(id => k.has(id));
    return open ? `<li><span class="time">${esc(t.time)}</span><p>${esc(t.text)}</p></li>`
      : `<li class="locked"><span class="time">${esc(t.time)}</span><p>? ? ? — find more clues or testimony</p></li>`;
  }).join('');
  openOverlay(`
    <div class="panel-head"><h3>🕰️ Timeline of the Night</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="panel-body"><ul class="timeline">${items}</ul></div>
    <div class="panel-foot"><button class="btn" data-close>Close</button></div>`);
}

// ---------- accusation ----------
function showAccuse(sel = { culprit: null, motive: null, evidence: [] }) {
  const d = state.data, sol = d.solution;
  const slots = sol.evidenceSlots || sol.evidence.length;
  const found = d.clues.filter(c => state.found.has(c.id));
  const panel = openOverlay(`
    <div class="panel-head"><h3>⚖️ Make Your Accusation</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="panel-body">
      <p class="step-title">1 · ${esc(d.accuseQuestion || 'Who killed the victim?')}</p>
      <div class="choices">${d.suspects.map(s => `<button class="choice ${sel.culprit === s.id ? 'selected' : ''}" data-culprit="${esc(s.id)}">${portrait(s)}<span>${esc(s.name)}<small>${esc(s.role || '')}</small></span></button>`).join('')}</div>
      <p class="step-title">2 · What was the motive?</p>
      <div class="choices list">${(d.motives || []).map(m => `<button class="choice ${sel.motive === m.id ? 'selected' : ''}" data-motive="${esc(m.id)}">${esc(m.text)}</button>`).join('')}</div>
      <p class="step-title">3 · Key evidence (choose up to ${slots})</p>
      ${found.length ? `<div class="choices">${found.map(c => `<button class="choice ${sel.evidence.includes(c.id) ? 'selected' : ''}" data-ev="${esc(c.id)}">${clueIcon(c)} <span>${esc(c.name)}</span></button>`).join('')}</div>`
        : '<p class="empty">You have not collected any evidence yet.</p>'}
    </div>
    <div class="panel-foot"><button class="btn ghost" data-close>Keep investigating</button><button class="btn primary" id="accuse-go" ${sel.culprit && sel.motive && sel.evidence.length ? '' : 'disabled'}>Accuse</button></div>`);
  const body = panel.querySelector('.panel-body'), scroll = () => body.scrollTop;
  const rerender = () => { const y = scroll(); showAccuse(sel); $('#overlay-panel .panel-body').scrollTop = y; };
  panel.querySelectorAll('[data-culprit]').forEach(b => b.onclick = () => { sel.culprit = b.dataset.culprit; rerender(); });
  panel.querySelectorAll('[data-motive]').forEach(b => b.onclick = () => { sel.motive = b.dataset.motive; rerender(); });
  panel.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => {
    const id = b.dataset.ev;
    if (sel.evidence.includes(id)) sel.evidence = sel.evidence.filter(e => e !== id);
    else if (sel.evidence.length < slots) sel.evidence.push(id);
    else { toast(`You can present at most ${slots} pieces of evidence`); return; }
    rerender();
  });
  panel.querySelector('#accuse-go').onclick = () => {
    const s = suspect(sel.culprit);
    if (!confirm(`Accuse ${s.name}? This ends the investigation.`)) return;
    finishCase(sel);
  };
}

function score(sel) {
  const d = state.data, sol = d.solution;
  const culpritOk = sel.culprit === sol.culprit;
  const motiveOk = sel.motive === sol.motive;
  const right = sel.evidence.filter(e => sol.evidence.includes(e)).length;
  const wrong = sel.evidence.length - right;
  const evidence = Math.max(0, Math.round(20 * right / sol.evidence.length - 5 * wrong));
  const thorough = Math.round(10 * state.found.size / d.clues.length);
  const total = (culpritOk ? 50 : 0) + (motiveOk ? 20 : 0) + evidence + thorough;
  return { culpritOk, motiveOk, right, wrong, evidence, thorough, total, solved: culpritOk && motiveOk && right > 0 };
}

function rank(r) {
  if (!r.solved) return 'The guilty party walks free… for now.';
  if (r.total >= 95) return 'Master Detective — Poirot would tip his hat.';
  if (r.total >= 80) return 'Chief Inspector — sharp, thorough work.';
  if (r.total >= 65) return 'Inspector — you got your man.';
  return 'Constable — right answer, thin case.';
}

function finishCase(sel) {
  state.playing = false;
  closeOverlay();
  const d = state.data, r = score(sel);
  const rec = state.progress.cases[d.id] ||= { solved: false, best: 0, attempts: 0 };
  rec.attempts++;
  rec.best = Math.max(rec.best, r.total);
  rec.solved ||= r.solved;
  delete state.progress.saves[d.id];
  saveProgress();
  audio.chime(r.solved ? 'win' : 'lose');
  const next = state.cases[state.index + 1];
  const nextUnlocked = r.solved && next && !next.broken;
  const sus = suspect(sel.culprit), mot = d.motives.find(m => m.id === sel.motive);
  $('#result-body').innerHTML = `
    <div class="result-head">
      <p class="eyebrow">Case ${String(d.number).padStart(2, '0')} · ${esc(d.title)}</p>
      <p class="verdict ${r.solved ? 'win' : 'lose'}">${r.solved ? 'CASE SOLVED' : 'CASE UNSOLVED'}</p>
      <p class="score-big">${r.total}<span style="font-size:1.2rem">/100</span></p>
      <p class="rank">${rank(r)}</p>
    </div>
    <table class="breakdown">
      <tr><td>Accused: ${esc(sus.name)} ${r.culpritOk ? '✔' : '✘'}</td><td>${r.culpritOk ? 50 : 0}/50</td></tr>
      <tr><td>Motive: ${esc(mot?.text || '')} ${r.motiveOk ? '✔' : '✘'}</td><td>${r.motiveOk ? 20 : 0}/20</td></tr>
      <tr><td>Key evidence: ${r.right}/${d.solution.evidence.length} correct${r.wrong ? `, ${r.wrong} irrelevant` : ''}</td><td>${r.evidence}/20</td></tr>
      <tr><td>Thoroughness: ${state.found.size}/${d.clues.length} clues found</td><td>${r.thorough}/10</td></tr>
    </table>
    ${r.solved ? `<div class="truth">${(d.solution.explanation || []).map(p => `<p>${para(p)}</p>`).join('')}</div>` : `<p style="text-align:center">Your accusation didn't hold up. Review your notebook and the timeline — the truth is in there.</p><div id="truth" class="truth hidden">${(d.solution.explanation || []).map(p => `<p>${para(p)}</p>`).join('')}</div>`}
    ${nextUnlocked ? `<p style="text-align:center" class="new-tag">🔓 NEW CASE UNLOCKED: ${esc(next.title)}</p>` : ''}
    <div class="row-buttons">
      ${nextUnlocked ? '<button class="btn primary" id="res-next">Next Case →</button>' : ''}
      ${!r.solved ? '<button class="btn primary" id="res-retry">Try Again</button><button class="btn" id="res-reveal">Reveal the Truth</button>' : '<button class="btn" id="res-retry">Replay Case</button>'}
      <button class="btn ghost" id="res-cases">Case Files</button>
    </div>`;
  show('result');
  $('#screen-result').scrollTop = 0;
  if (nextUnlocked) $('#res-next').onclick = () => openIntro(state.index + 1);
  $('#res-retry').onclick = () => openIntro(state.index);
  $('#res-cases').onclick = () => { renderCaseList(); show('cases'); };
  const rev = $('#res-reveal');
  if (rev) rev.onclick = () => { $('#truth').classList.remove('hidden'); rev.remove(); };
}

// ---------- pause & help ----------
function showPause() {
  const panel = openOverlay(`
    <div class="panel-head"><h3>Paused</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="panel-body" style="display:flex;flex-direction:column;gap:10px">
      <button class="btn primary" data-close>Resume</button>
      <button class="btn" id="p-help">How to Play</button>
      <button class="btn" id="p-sound">${audio.enabled ? '🔊 Sound: On' : '🔇 Sound: Off'}</button>
      <button class="btn" id="p-restart">Restart Case</button>
      <button class="btn ghost" id="p-quit">Save &amp; Quit to Case Files</button>
    </div>`, 'narrow');
  panel.querySelector('#p-help').onclick = () => howTo(true);
  panel.querySelector('#p-sound').onclick = () => { audio.setEnabled(!audio.enabled); soundLabel(); showPause(); };
  panel.querySelector('#p-restart').onclick = () => { if (confirm('Restart this case? Your clues will be lost.')) { closeOverlay(); startCase(state.index, false); } };
  panel.querySelector('#p-quit').onclick = () => { persist(); closeOverlay(); renderCaseList(); show('cases'); };
}

function howTo(inGame) {
  const touch = controls.isTouch;
  const html = `
    <div class="panel-head"><h3>How to Play</h3><button class="close-x" data-close aria-label="Close">×</button></div>
    <div class="panel-body"><ol class="howto">
      <li><b>Move:</b> ${touch ? 'use the joystick (bottom-left)' : '<kbd>W A S D</kbd> or arrow keys, <kbd>Shift</kbd> to run'}.</li>
      <li><b>Look:</b> ${touch ? 'drag anywhere on the screen' : 'click the scene to capture the mouse, then move it. <kbd>Esc</kbd> releases it'}.</li>
      <li><b>Examine & talk:</b> ${touch ? 'tap an object or person, or aim and press the gold button' : 'aim the dot at a glinting clue or a person and click (or press <kbd>E</kbd>)'}.</li>
      <li><b>Notebook</b> ${touch ? '' : '(<kbd>N</kbd>)'} keeps every clue and statement. <b>Timeline</b> ${touch ? '' : '(<kbd>T</kbd>)'} fills in as you learn when things happened.</li>
      <li>Some questions only appear once you hold the right evidence. Contradictions matter.</li>
      <li>When you're ready, press <b>Accuse</b>: name the culprit, the motive and the key evidence. Solve the case to unlock the next one.</li>
    </ol></div>
    <div class="panel-foot"><button class="btn primary" data-close>${inGame ? 'Back to the case' : 'Got it'}</button></div>`;
  if (inGame) openOverlay(html, 'narrow');
  else {
    const ov = $('#overlay'), panel = $('#overlay-panel');
    panel.className = 'panel narrow';
    panel.innerHTML = html;
    ov.classList.remove('hidden');
    panel.querySelectorAll('[data-close]').forEach(b => b.onclick = () => ov.classList.add('hidden'));
  }
}

// ---------- HUD buttons & keys ----------
document.querySelectorAll('#hud [data-action]').forEach(b => b.onclick = e => {
  e.stopPropagation();
  ({ notebook: () => showNotebook(), timeline: showTimeline, accuse: () => showAccuse(), pause: showPause })[b.dataset.action]();
});
$('#touch-interact').addEventListener('click', () => interact(null));

function onKey(code, e) {
  if (!state.playing) return;
  if (state.overlay) {
    if (code === 'Escape' && performance.now() - state.overlayAt > 400) closeOverlay();
    return;
  }
  if (code === 'KeyE' || code === 'Enter' || code === 'Space') { e.preventDefault(); interact(null); }
  else if (code === 'KeyN') showNotebook();
  else if (code === 'KeyT') showTimeline();
  else if (code === 'Escape' || code === 'KeyP') showPause();
}

// ---------- movement & collision ----------
function blocked(x, z) {
  for (const c of world.colliders) {
    const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < PLAYER_R * PLAYER_R) return true;
  }
  return false;
}

let bob = 0;
function step(dt) {
  const m = controls.enabled ? controls.move() : { f: 0, s: 0 };
  const speed = (m.run ? 4.6 : 2.8) * dt;
  const sy = Math.sin(controls.yaw), cy = Math.cos(controls.yaw);
  const dx = (-sy * m.f + cy * m.s) * speed, dz = (-cy * m.f - sy * m.s) * speed;
  if (dx && !blocked(player.x + dx, player.z)) player.x += dx;
  if (dz && !blocked(player.x, player.z + dz)) player.z += dz;
  const moving = Math.abs(m.f) + Math.abs(m.s) > 0.1;
  bob += moving ? dt * (m.run ? 11 : 8) : 0;
  camera.position.set(player.x, EYE + (moving ? Math.sin(bob) * 0.035 : 0), player.z);
  camera.rotation.set(controls.pitch, controls.yaw, 0);

  const r = world.roomAt(player.x, player.z);
  if (r && r.id !== state.room?.id) {
    state.room = r;
    $('#hud-room').textContent = r.name;
    const rt = $('#room-toast');
    rt.textContent = r.name;
    rt.classList.add('show');
    clearTimeout(step.rt);
    step.rt = setTimeout(() => rt.classList.remove('show'), 1800);
  }
}

function updateHover() {
  const target = state.overlay ? null : pick(controls.usesCursor ? controls.mouse : null);
  state.hovered = target;
  const prompt = $('#prompt'), btn = $('#touch-interact');
  $('#crosshair').classList.toggle('active', !!target);
  if (target) {
    const verb = target.kind === 'suspect' ? 'Talk to' : 'Examine';
    const seen = target.kind === 'clue' && state.found.has(target.id) ? ' ✓' : '';
    prompt.innerHTML = controls.isTouch ? `${verb} ${esc(target.name)}${seen}` : `<kbd>E</kbd> / Click — ${verb} ${esc(target.name)}${seen}`;
    btn.textContent = target.kind === 'suspect' ? '💬 Talk' : '🔍 Examine';
  }
  prompt.classList.toggle('hidden', !target || controls.usesCursor && !controls.mouse);
  btn.classList.toggle('hidden', !target);
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!state.playing || !world.root) return;
  step(dt);
  if (world.update(dt, clock.elapsedTime, player)) audio.thunder();
  updateHover();
  renderer.render(scene, camera);
}

// ---------- boot ----------
(async function boot() {
  state.cases = await discoverCases();
  $('#loading').classList.add('hidden');
  if (!state.cases.length) toast('No case files found in /cases');
  show('menu');
  loop();
})();
document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) persist(); });
if (new URLSearchParams(location.search).has('debug')) window.__game = { state, world, player, controls, camera, raycaster, pick, showClue, showDialogue, finishCase, startCase, interact };
