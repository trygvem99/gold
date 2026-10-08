// Gold — views, rendering, wiring. Rules live in logic.js, storage in db.js,
// the ticket show in reveal.js, shared visuals in ui.js.
"use strict";

const BUILD = "2026-10-08 · steps";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let habits = [];
let goals = [];
let days = [];
let tickets = [];
let prizes = [];
let wins = [];
let settings = null;
let today = Gold.todayStr();
let viewDate = today;     // the day Today is showing; any of the last seven
let monthCursor = null;   // "YYYY-MM" on the Progress calendar

let ticketQueue = [];
let rewardPrizes = [];

const ICON = {
  ticket: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 7h16a1.5 1.5 0 0 1 1.5 1.5V10a2 2 0 0 0 0 4v1.5A1.5 1.5 0 0 1 20 17H4a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4V8.5A1.5 1.5 0 0 1 4 7z"/>' +
    '<path d="M9.5 8.2v1.5M9.5 11.2v1.5M9.5 14.3v1.5"/></svg>',
  flame: '<svg class="ico flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2c.4 3-1.8 4.4-3 6.1' +
    '-1 1.4-1.6 2.7-1.6 4.2 0 .8.2 1.5.6 2.1-.9-.4-1.6-1.1-2-2C5.6 13.6 5 15 5 16.4 5 19.9 8.1 22 12 22s7-2.4 ' +
    '7-6.2c0-2.6-1.3-4.7-2.9-6.4-.3 1.3-1 2.1-1.9 2.5.7-2.9-.2-6.5-1.6-9.9z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
  trophy: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.5h9v4.2a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.8a2.7 2.7 0 0 0 2.9 4M16.5 6h2.7a2.7 2.7 0 0 1-2.9 4M12 13.2v3.3M8.5 19.5h7M9.8 16.5h4.4"/></svg>',
  target: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><circle class="dot" cx="12" cy="12" r="1.4"/></svg>',
  gift: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3.5 9h17M12 9v11M12 9S10.6 4.5 8.2 5c-2 .4-1.4 4 3.8 4m0 0s1.4-4.5 3.8-4c2 .4 1.4 4-3.8 4"/></svg>',
};
const SLOT = {
  morning: { label: "Morning", icon: '<svg class="ico" viewBox="0 0 24 24"><path d="M5 16a7 7 0 0 1 14 0M3 19.5h18M12 4.5v2.5M5.6 9.6 7.3 11M18.4 9.6 16.7 11"/></svg>' },
  afternoon: { label: "Afternoon", icon: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>' },
  evening: { label: "Evening", icon: '<svg class="ico" viewBox="0 0 24 24"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>' },
  any: { label: "Anytime", icon: '<svg class="ico" viewBox="0 0 24 24"><path d="M7.5 8.5c-2.5 0-4 1.6-4 3.5s1.5 3.5 4 3.5c3.5 0 5.5-7 9-7 2.5 0 4 1.6 4 3.5s-1.5 3.5-4 3.5c-3.5 0-5.5-7-9-7z"/></svg>' },
};
const DAY_RING = ["#7B6CFF", "#5FD4FF"];
const GOLD_RING = ["#E9B949", "#FFF0C4"];

// ---------- helpers ----------

const dayRecord = (date) => days.find((d) => d.date === date) || { date, counts: {} };
const activePrizes = () => Gold.activePrizes(prizes);
const unspent = () => Gold.unspentTickets(tickets);
const statsOn = (date) => Gold.dayStats(dayRecord(date), habits, goals, settings);
const effTargetToday = () => statsOn(today).target;
const colorOf = (h) => h.color || Ui.PALETTE[0][0];
const fillRings = (root) => {
  const fill = () => root.querySelectorAll(".ring[data-p]").forEach((r) => Ui.setRing(r, r.dataset.p));
  // a hidden page gets no animation frames; the rings must still show the truth
  if (document.hidden) fill();
  else requestAnimationFrame(() => requestAnimationFrame(fill));
};
const ring = (o) => {
  // rings are born empty and filled a frame later, so every view entry animates
  const html = Ui.ring(Object.assign({}, o, { p: 0 }));
  return html.replace('<div class="ring', `<div data-p="${Math.max(0, Math.min(1, o.p || 0))}" class="ring`);
};
const shortDay = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }).replace(".", "").slice(0, 3);
const longDay = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function scheduleText(h) {
  const d = h.days && h.days.length && h.days.length < 7 ? h.days.slice().sort() : null;
  let s = !d ? "Every day"
    : d.join() === "1,2,3,4,5" ? "Weekdays"
      : d.join() === "0,6" ? "Weekends"
        : d.map((x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x]).join(", ");
  if (Gold.targetOf(h) > 1) s += ` · ${Gold.targetOf(h)}× a day`;
  if (Gold.slotOf(h) !== "any") s += ` · ${SLOT[Gold.slotOf(h)].label}`;
  return s;
}

// ---------- views ----------

function showView(name) {
  // the show covers the dock, but a stray tap must not rebuild what it reads
  if (Reveal.isPlaying()) return;
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  const view = $(`#view-${name}`);
  view.hidden = false;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "today") {
    today = Gold.todayStr();
    if (viewDate > today) viewDate = today;
    heroFor = null;
    renderToday();
  }
  if (name === "progress") renderProgress();
  if (name === "wheel") renderRewards();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
  Ui.rise(view);
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { Ui.vibrate(5); showView(t.dataset.view); }));

function renderBadge() {
  document.querySelector('.tab[data-view="wheel"]').classList.toggle("badge", unspent().length > 0);
}

// ---------- today ----------

function renderToday() {
  renderTodayHead();
  renderWeekStrip();
  renderHero();
  renderSections();
  renderGoalLists();
  $("#today-hint").textContent = viewDate === today ? ""
    : `Changes count for ${Gold.prettyDate(viewDate)}, and earn that day's ticket.`;
  renderBadge();
}

function renderTodayHead() {
  const isToday = viewDate === today;
  $("#today-eyebrow").textContent = isToday
    ? `${greeting()} · ${Gold.prettyDate(today)}`
    : Gold.prettyDate(viewDate);
  $("#today-title").textContent = isToday ? "Today"
    : viewDate === Gold.shiftDate(today, -1) ? "Yesterday" : longDay(viewDate);
}

function renderWeekStrip() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = Gold.shiftDate(today, -i);
    const st = statsOn(d);
    const p = st.max ? st.points / st.max : 0;
    const paid = tickets.some((t) => t.date === d && t.reason === "daily");
    const [c1, c2] = st.qualifies ? GOLD_RING : DAY_RING;
    out.push(
      `<button class="wday${d === viewDate ? " sel" : ""}${d === today ? " today" : ""}${paid ? " paid" : ""}" data-date="${d}" type="button">` +
      `<span class="wd">${esc(shortDay(d))}</span>` +
      Ui.ring({ size: 36, width: 3.5, p, c1, c2, inner: String(Number(d.slice(8))) }) + "</button>");
  }
  const host = $("#week-strip");
  host.innerHTML = out.join("");
  host.querySelectorAll(".wday").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.date === viewDate) return;
    viewDate = b.dataset.date;
    Ui.vibrate(6);
    heroFor = null;
    renderToday();
  }));
}

// The hero is built once per day shown and updated in place after that, so its
// rings animate from where they were rather than redrawing from nothing.
let heroFor = null;
function renderHero() {
  const st = statsOn(viewDate);
  const won = st.target > 0 && st.points >= st.target;
  const spinP = st.target ? st.points / st.target : 0;
  const dayP = st.max ? st.points / st.max : 0;
  const streak = Gold.currentStreak(days, habits, goals, settings, today);
  const spins = unspent().length;
  const hero = $("#hero");

  if (heroFor !== viewDate) {
    heroFor = viewDate;
    hero.innerHTML =
      '<div class="hero-rings">' +
      ring({ size: 150, width: 13, p: spinP, c1: GOLD_RING[0], c2: GOLD_RING[1], cls: "r-spin" }) +
      ring({ size: 110, width: 10, p: dayP, c1: DAY_RING[0], c2: DAY_RING[1], cls: "r-day" }) +
      '<div class="hero-center"><div class="hero-num" data-v="0">0</div><div class="hero-of"></div></div></div>' +
      '<div class="hero-side">' +
      `<button class="hstat streak" type="button" data-go="progress"><span class="hstat-ico">${ICON.flame}</span>` +
      '<span><span class="hstat-num" data-v="0">0</span><span class="hstat-label">day streak</span></span></button>' +
      `<button class="hstat tickets" type="button" data-go="wheel"><span class="hstat-ico">${ICON.ticket}</span>` +
      '<span><span class="hstat-num" data-v="0">0</span><span class="hstat-label">tickets ready</span></span></button></div>';
    hero.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.go)));
    fillRings(hero);
  } else {
    Ui.setRing(hero.querySelector(".r-spin"), spinP);
    Ui.setRing(hero.querySelector(".r-day"), dayP);
  }
  Ui.countTo(hero.querySelector(".hero-num"), st.points);
  hero.querySelector(".hero-of").textContent = !st.max ? "nothing scheduled"
    : won ? "ticket earned" : `of ${st.target} for a ticket`;
  hero.classList.toggle("won", won);
  hero.style.setProperty("--won", won ? "1" : "0");
  const [sEl, tEl] = hero.querySelectorAll(".hstat-num");
  Ui.countTo(sEl, streak);
  Ui.countTo(tEl, spins);
  hero.querySelector(".hstat.streak").classList.toggle("live", streak > 0);
  hero.querySelector(".hstat.tickets").classList.toggle("live", spins > 0);
}

function tileMeta(h, n) {
  const t = Gold.targetOf(h);
  const s = Gold.habitStats(h, days, today);
  const parts = [];
  if (t > 1) parts.push(`<span>${n}/${t}</span>`);
  if (s.current > 0) parts.push(`<span class="flame-mini">${ICON.flame}${s.current}</span>`);
  else if (s.total === 0) parts.push("<span>New</span>");
  else parts.push(`<span>${Math.round(s.rate * 100)}%</span>`);
  return parts.join("");
}

function tileHtml(h) {
  const n = dayRecord(viewDate).counts[h.id] || 0;
  const t = Gold.targetOf(h);
  const c1 = colorOf(h), c2 = Ui.tipFor(c1);
  return `<div class="tile glass${n >= t ? " done" : ""}" data-id="${h.id}" style="--c1:${c1};--c2:${c2}">` +
    `<span class="tile-check">${ICON.check}</span>` +
    (n > 0 ? '<button class="tile-undo" type="button" aria-label="Undo one">−</button>' : "") +
    ring({ size: 88, width: 8, p: n / t, c1, c2, inner: `<span class="tile-emoji">${esc(h.emoji || "•")}</span>` }) +
    `<div class="tile-name">${esc(h.name)}</div>` +
    `<div class="tile-meta">${tileMeta(h, n)}</div></div>`;
}

function renderSections() {
  const host = $("#today-sections");
  const act = Gold.habitsActiveOn(habits, viewDate);
  if (!act.length) {
    host.innerHTML = Gold.activeHabits(habits).length
      ? '<p class="empty">Nothing scheduled for this day. A rest day — it won\'t break your streak.</p>'
      : '<div class="empty"><p>No habits yet.</p><button class="btn primary" type="button" id="first-habit">Add your first habit</button></div>';
    const b = $("#first-habit");
    if (b) b.addEventListener("click", () => editHabit(null));
    return;
  }
  const groups = Gold.SLOTS.map((slot) => ({ slot, list: act.filter((h) => Gold.slotOf(h) === slot) }))
    .filter((g) => g.list.length);
  const nowSlot = viewDate === today ? Gold.slotForHour(new Date().getHours()) : null;
  const plain = groups.length === 1 && groups[0].slot === "any";
  host.innerHTML = groups.map((g) =>
    `<section class="slot${g.slot === nowSlot ? " now" : ""}" data-slot="${g.slot}">` +
    '<div class="slot-head">' +
    (plain ? "" : `<span class="slot-ico">${SLOT[g.slot].icon}</span>`) +
    `<span class="slot-name">${plain ? "Habits" : SLOT[g.slot].label}</span>` +
    `<span class="slot-count"></span></div>` +
    `<div class="tiles">${g.list.map(tileHtml).join("")}</div></section>`).join("");
  host.querySelectorAll(".tile").forEach(wireTile);
  updateSlotCounts();
  fillRings(host);
}

function wireTile(el) {
  const h = habits.find((x) => x.id === el.dataset.id);
  el.addEventListener("click", (e) => {
    if (e.target.closest(".tile-undo")) { bump(h, -1, el); return; }
    bump(h, +1, el);
  });
}

function updateSlotCounts() {
  const rec = dayRecord(viewDate);
  document.querySelectorAll("#today-sections .slot").forEach((s) => {
    const list = Gold.habitsActiveOn(habits, viewDate).filter((h) => Gold.slotOf(h) === s.dataset.slot);
    const done = list.filter((h) => (rec.counts[h.id] || 0) >= Gold.targetOf(h)).length;
    s.querySelector(".slot-count").textContent = `${done}/${list.length}`;
  });
}

// update one tile in place, so its ring animates instead of being redrawn
function refreshTile(el, h) {
  const n = dayRecord(viewDate).counts[h.id] || 0;
  const t = Gold.targetOf(h);
  Ui.setRing(el.querySelector(".ring"), n / t);
  el.classList.toggle("done", n >= t);
  let undo = el.querySelector(".tile-undo");
  if (n > 0 && !undo) {
    el.insertAdjacentHTML("afterbegin", '<button class="tile-undo" type="button" aria-label="Undo one">−</button>');
  } else if (n === 0 && undo) undo.remove();
  el.querySelector(".tile-meta").innerHTML = tileMeta(h, n);
}

async function bump(habit, delta, el) {
  const date = viewDate;
  const t = Gold.targetOf(habit);
  const day = dayRecord(date);
  const cur = day.counts[habit.id] || 0;
  const next = Math.max(0, Math.min(t, cur + delta));
  if (next === cur) {
    if (delta > 0 && el) { el.animate([{ transform: "scale(1)" }, { transform: "scale(0.97)" }, { transform: "scale(1)" }], 240); }
    return;
  }

  const counts = Object.assign({}, day.counts, { [habit.id]: next });
  const rec = { date, counts };
  await Data.days.put(rec);
  days = days.filter((d) => d.date !== date).concat(rec);

  const st = statsOn(date);
  if (next > cur) {
    Ui.vibrate(next >= t ? [0, 18, 40, 26] : 12);
    Sfx.blip(st.target ? st.points / st.target : 0);
  } else {
    Ui.vibrate(6);
    Sfx.thunk();
  }
  if (el) {
    refreshTile(el, habit);
    if (next >= t && cur < t) {
      Ui.burst(el.querySelector(".ring"), colorOf(habit), 18);
      el.classList.add("pop");
      setTimeout(() => el.classList.remove("pop"), 380);
    }
  }
  updateSlotCounts();
  renderHero();
  renderWeekStrip();

  const added = await syncTickets(next < cur ? date : null);
  renderHero();
  renderWeekStrip();
  if (added.length) setTimeout(() => announceTickets(added), 520);
}

// ---------- goals on Today ----------

const openDetail = new Set(); // goals expanded on Today

function goalMeta(g) {
  const n = Gold.goalTickets(g);
  const sp = Gold.stepProgress(g);
  return (g.kind === "quarter" ? `${esc(g.period || Gold.quarterOf(today))} · pays ${n} ticket${n === 1 ? "" : "s"}` : "One-off · 1 point") +
    (sp.total ? ` · ${sp.done}/${sp.total} steps` : "");
}

// A goal with a description or steps opens like a To Do task: tap the card to
// see them, tap the box to finish it.
function goalCard(g) {
  const big = g.kind === "quarter";
  const sp = Gold.stepProgress(g);
  const rich = !!(g.note || sp.total);
  const open = rich && openDetail.has(g.id);
  const cls = (big ? " big" : "") + (open ? " open" : "") + (sp.total && sp.done === sp.total ? " ready" : "");
  return `<div class="goal-card glass${cls}" data-goal="${g.id}" style="--gp:${sp.total ? sp.done / sp.total : 0}">` +
    '<div class="goal-head">' +
    `<div class="goal-ico">${esc(g.emoji || (big ? "◆" : "◇"))}</div>` +
    `<div class="goal-main"><div class="goal-name">${esc(g.name)}</div><div class="goal-meta">${goalMeta(g)}</div></div>` +
    (rich ? `<span class="goal-more">${ICON.chev}</span>` : "") +
    `<button class="goal-box" type="button" aria-label="Finish goal">${ICON.check}</button></div>` +
    (sp.total ? '<div class="goal-bar"><i></i></div>' : "") +
    (open ? goalDetail(g) : "") + "</div>";
}

function goalDetail(g) {
  return '<div class="goal-detail">' +
    (g.note ? `<p class="goal-note">${esc(g.note)}</p>` : "") +
    (g.steps || []).map((st) =>
      `<button class="step${st.done_at ? " done" : ""}" type="button" data-step="${st.id}">` +
      `<span class="step-box">${ICON.check}</span><span class="step-name">${esc(st.name)}</span></button>`).join("") +
    '<button class="linkish goal-edit" type="button">Edit</button></div>';
}

function renderGoalLists() {
  const host = $("#goal-sections");
  if (viewDate !== today) { host.innerHTML = ""; return; }
  const week = Gold.openGoals(goals, "week");
  const quarter = Gold.openGoals(goals, "quarter");
  host.innerHTML =
    (week.length ? `<h3 class="section-label">This week</h3>${week.map(goalCard).join("")}` : "") +
    (quarter.length ? `<h3 class="section-label">This quarter</h3>${quarter.map(goalCard).join("")}` : "");
  host.querySelectorAll(".goal-card").forEach((el) => {
    const find = () => goals.find((x) => x.id === el.dataset.goal);
    el.querySelector(".goal-box").addEventListener("click", (e) => {
      e.stopPropagation();
      const g = find();
      if (g && !g.done_at) finishGoal(g, el);
    });
    el.querySelectorAll(".step").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleStep(find(), b.dataset.step, b, el);
    }));
    const edit = el.querySelector(".goal-edit");
    if (edit) edit.addEventListener("click", (e) => { e.stopPropagation(); const g = find(); if (g) editGoal(g.kind, g); });
    el.addEventListener("click", () => {
      const g = find();
      if (!g || g.done_at) return;
      if (!el.querySelector(".goal-more")) { finishGoal(g, el); return; }
      if (openDetail.has(g.id)) openDetail.delete(g.id); else openDetail.add(g.id);
      Ui.vibrate(5);
      renderGoalLists();
    });
  });
}

// A step is progress you can see and feel, and nothing more: no point, no ticket.
async function toggleStep(goal, stepId, btn, card) {
  if (!goal) return;
  const now = new Date().toISOString();
  const steps = (goal.steps || []).map((st) => (st.id === stepId ? Object.assign({}, st, { done_at: st.done_at ? null : now }) : st));
  const rec = Object.assign({}, goal, { steps });
  await Data.goals.put(rec);
  goals = goals.map((x) => (x.id === rec.id ? rec : x));

  const done = !!steps.find((st) => st.id === stepId).done_at;
  const sp = Gold.stepProgress(rec);
  btn.classList.toggle("done", done);
  card.style.setProperty("--gp", String(sp.done / sp.total));
  card.classList.toggle("ready", sp.done === sp.total);
  card.querySelector(".goal-meta").innerHTML = goalMeta(rec);
  if (done) {
    Ui.burst(btn.querySelector(".step-box"), goal.kind === "quarter" ? "#E9B949" : "#3DDC97", 8);
    Sfx.blip(sp.done / sp.total);
    Ui.vibrate(8);
  } else {
    Ui.vibrate(4);
  }
}

// A one-off is worth a point on the day it is finished. A quarterly goal pays
// tickets outright, tagged with its id so undoing it takes them back.
async function finishGoal(goal, el) {
  const rec = Object.assign({}, goal, { done_at: new Date().toISOString() });
  await Data.goals.put(rec);
  goals = goals.map((g) => (g.id === rec.id ? rec : g));

  if (el) {
    el.classList.add("done");
    Ui.burst(el.querySelector(".goal-box"), goal.kind === "quarter" ? "#E9B949" : "#3DDC97", 16);
  }
  Ui.vibrate(goal.kind === "quarter" ? [0, 40, 60, 40, 60, 120] : [0, 16, 40, 22]);

  let announce = [];
  if (goal.kind === "quarter") {
    const n = Gold.goalTickets(goal);
    const now = new Date().toISOString();
    const rows = Array.from({ length: n }, () => ({
      id: Data.newId(), date: today, reason: "goal", source: goal.id,
      created_at: now, spent_at: null, win_id: null,
    }));
    await Data.tickets.bulkPut(rows);
    tickets = tickets.concat(rows);
    announce = rows.slice(0, 1).map((r) => Object.assign({}, r, { count: n, goal: goal.name }));
  } else {
    Sfx.blip(1);
    announce = await syncTickets();
  }
  setTimeout(() => { renderToday(); if (announce.length) announceTickets(announce); }, 650);
}

async function reopenGoal(goal) {
  const doneOn = goal.done_at ? goal.done_at.slice(0, 10) : null;
  const rec = Object.assign({}, goal, { done_at: null });
  await Data.goals.put(rec);
  goals = goals.map((g) => (g.id === rec.id ? rec : g));
  // unspent tickets that goal paid for are taken back; spent ones are not
  const revoke = tickets.filter((t) => t.source === goal.id && !t.spent_at).map((t) => t.id);
  if (revoke.length) {
    await Data.tickets.bulkDel(revoke);
    tickets = tickets.filter((t) => revoke.indexOf(t.id) === -1);
  }
  // a reopened one-off un-checks the day it was finished on
  await syncTickets(goal.kind === "week" ? doneOn : null);
}

// ---------- progress ----------

function windowRate(n) {
  let hit = 0, eligible = 0;
  for (let i = 0; i < n; i++) {
    const d = Gold.shiftDate(today, -i);
    if (Gold.isRestDay(habits, goals, d)) continue;
    const q = statsOn(d).qualifies;
    if (i === 0 && !q) continue; // an unfinished today counts against nothing
    eligible++;
    if (q) hit++;
  }
  return eligible ? hit / eligible : 0;
}

function renderProgress() {
  const root = $("#progress-root");
  const cur = Gold.currentStreak(days, habits, goals, settings, today);
  const best = Gold.bestStreak(days, habits, goals, settings, today);
  const rate = Math.round(windowRate(30) * 100);
  const all = habits.map((h) => ({ h, s: Gold.habitStats(h, days, today) }));
  const reps = all.reduce((a, x) => a + x.s.completions, 0);
  const spun = tickets.filter((t) => t.spent_at).length;
  const quarters = goals.filter((g) => g.kind === "quarter" && g.done_at && !g.archived_at).length;

  const stat = (tone, icon, num, label, unit) =>
    `<div class="stat-card glass" style="--tone:${tone}" data-rise><div class="sc-ico">${icon}</div>` +
    `<div class="sc-num" data-count="${num}">0${unit ? `<small>${unit}</small>` : ""}</div><div class="sc-label">${label}</div></div>`;

  const active = Gold.activeHabits(habits);
  root.innerHTML =
    '<div class="stat-grid">' +
    stat("#FF8A4C", ICON.flame, cur, "current streak") +
    stat("#E9B949", ICON.trophy, best, "best streak") +
    stat("#8B7CFF", ICON.target, rate, "days on target, last 30", "%") +
    stat("#FF6FAE", ICON.gift, wins.length, "prizes won") +
    "</div>" +
    `<div class="month glass" data-rise>${monthHtml()}</div>` +
    '<h3 class="section-label" data-rise>Milestones</h3>' +
    `<div class="medals" data-rise>${medalsHtml(Gold.milestones({ best, reps, spins: spun, quarters }))}</div>` +
    (active.length ? '<h3 class="section-label" data-rise>Habits</h3>' : "") +
    active.map((h) => habitCardHtml(h, all.find((x) => x.h.id === h.id).s)).join("");

  root.querySelectorAll("[data-count]").forEach((n) => {
    const small = n.querySelector("small");
    const to = Number(n.dataset.count);
    const span = document.createElement("span");
    span.textContent = "0";
    n.textContent = "";
    n.appendChild(span);
    if (small) n.appendChild(small);
    Ui.countTo(span, to, 900);
  });
  wireMonth(root);
  fillRings(root);
}

function monthHtml() {
  const thisMonth = today.slice(0, 7);
  if (!monthCursor) monthCursor = thisMonth;
  const [y, m] = monthCursor.split("-").map(Number);
  const first = `${monthCursor}-01`;
  const lead = (Gold.weekdayOf(first) + 6) % 7; // Monday first
  const len = new Date(y, m, 0).getDate();
  const title = new Date(first + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const earliest = (Gold.activeDates(days, goals, today)[0] || today).slice(0, 7);

  const cells = [];
  ["M", "T", "W", "T", "F", "S", "S"].forEach((d) => cells.push(`<div class="dow">${d}</div>`));
  for (let i = 0; i < lead; i++) cells.push('<div class="mday blank"></div>');
  for (let i = 1; i <= len; i++) {
    const d = `${monthCursor}-${String(i).padStart(2, "0")}`;
    const cls = ["mday"];
    let style = "";
    if (d > today) cls.push("future");
    else if (Gold.isRestDay(habits, goals, d)) cls.push("rest");
    else {
      const st = statsOn(d);
      const l = st.max ? st.points / st.max : 0;
      if (l > 0) { cls.push("lvl"); style = ` style="--l:${(0.2 + l * 0.8).toFixed(2)}"`; }
      if (l >= 1) cls.push("full");
    }
    if (tickets.some((t) => t.date === d && t.reason === "daily")) cls.push("paid");
    if (d === today) cls.push("today");
    cells.push(`<div class="${cls.join(" ")}"${style}>${i}</div>`);
  }
  return '<div class="month-head">' +
    `<div class="month-title">${esc(title)}</div><div class="month-nav">` +
    `<button type="button" data-month="-1"${monthCursor <= earliest ? " disabled" : ""} aria-label="Previous month">‹</button>` +
    `<button type="button" data-month="1"${monthCursor >= thisMonth ? " disabled" : ""} aria-label="Next month">›</button>` +
    `</div></div><div class="month-grid">${cells.join("")}</div>` +
    '<div class="legend"><span><i style="background:color-mix(in oklab,#8B7CFF 55%,transparent)"></i>Some</span>' +
    '<span><i style="background:linear-gradient(140deg,#9C8CFF,#4CC9FF)"></i>All done</span>' +
    '<span><i style="box-shadow:inset 0 0 0 1.5px #E9B949"></i>Ticket earned</span></div>';
}

function wireMonth(root) {
  root.querySelectorAll("[data-month]").forEach((b) => b.addEventListener("click", () => {
    const [y, m] = monthCursor.split("-").map(Number);
    const dt = new Date(y, m - 1 + Number(b.dataset.month), 1);
    monthCursor = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    const box = root.querySelector(".month");
    box.innerHTML = monthHtml();
    wireMonth(root);
    Ui.vibrate(5);
  }));
}

function medalsHtml(list) {
  const tier = { streak: "gold", reps: "plat", spin: "rose", quarter: "iris" };
  const unit = { streak: "DAYS", reps: "REPS", spin: "DRAW", quarter: "GOAL" };
  // earned first, then the nearest to being earned
  const sorted = list.slice().sort((a, b) => (b.earned - a.earned) || (b.progress - a.progress));
  return sorted.map((m) =>
    `<div class="medal ${tier[m.kind]}${m.earned ? "" : " locked"}"><div class="medal-disc">` +
    (m.earned ? "" : `<div class="medal-prog">${ring({ size: 82, width: 3, p: m.progress, c1: "#8F8B9B", c2: "#E8E4F0" })}</div>`) +
    `<span class="medal-val">${m.value}<small>${unit[m.kind]}</small></span></div>` +
    `<div class="medal-label">${esc(m.label)}</div>` +
    `<div class="medal-sub">${m.earned ? "Earned" : Math.round(m.progress * 100) + "%"}</div></div>`).join("");
}

function habitCardHtml(h, s) {
  const c1 = colorOf(h), c2 = Ui.tipFor(c1);
  // eighteen weeks of Monday-to-Sunday columns, ending with this week
  const monday = Gold.shiftDate(today, -((Gold.weekdayOf(today) + 6) % 7));
  const from = Gold.shiftDate(monday, -7 * 17);
  const start = (h.created_at || "").slice(0, 10);
  const cells = Gold.habitGrid(h, days, from, Gold.shiftDate(monday, 6)).map((c) => {
    // before the habit existed is an empty cell, so the grid always reads as
    // a whole calendar; days it did not ask for, and the future, are gaps
    if (c.date > today) return '<i class="off"></i>';
    if (start && c.date < start) return "<i></i>";
    if (c.value === null) return '<i class="off"></i>';
    const now = c.date === today ? " now" : "";
    if (c.value >= 1) return `<i class="full${now}"></i>`;
    if (c.value > 0) return `<i class="on${now}" style="--v:${c.value.toFixed(2)}"></i>`;
    return `<i class="${now.trim()}"></i>`;
  }).join("");
  const strength = Math.round(s.strength * 100);
  return `<div class="habit-card glass" style="--c1:${c1};--c2:${c2}" data-rise>` +
    `<div class="hc-head"><div class="hc-ico">${esc(h.emoji || "•")}</div>` +
    `<div class="hc-title"><div class="hc-name">${esc(h.name)}</div><div class="hc-sched">${esc(scheduleText(h))}</div></div>` +
    `<div class="hc-strength">${ring({ size: 56, width: 5, p: s.strength, c1, c2, inner: `${strength}<small>strength</small>` })}</div></div>` +
    '<div class="hc-stats">' +
    `<div class="hc-stat"><b>${s.current}</b><span>current streak</span></div>` +
    `<div class="hc-stat"><b>${s.best}</b><span>best streak</span></div>` +
    `<div class="hc-stat"><b>${Math.round(s.rate * 100)}%</b><span>last 30 days</span></div></div>` +
    `<div class="cgrid">${cells}</div></div>`;
}

// ---------- tickets ----------

// The ledger is rebuilt from the day history on every mutation, so a ticket can
// never be minted twice for the same day and an unspent one vanishes again if
// the day falls back below the threshold. Returns what was newly minted.
// `withdrawFrom` is the day just un-checked; only from there on can an unspent
// ticket be taken back. Every other caller passes nothing, so a settings change
// can add tickets but never remove ones already earned.
async function syncTickets(withdrawFrom) {
  const owed = Gold.ticketsOwed(days, habits, goals, settings, today);
  const { toAdd, toDeleteIds } = Gold.reconcileTickets(tickets, owed, withdrawFrom);
  const now = new Date().toISOString();
  const rows = toAdd.map((t) => ({
    id: Data.newId(), date: t.date, reason: t.reason, created_at: now, spent_at: null, win_id: null,
  }));
  if (rows.length) { await Data.tickets.bulkPut(rows); tickets = tickets.concat(rows); }
  if (toDeleteIds.length) {
    await Data.tickets.bulkDel(toDeleteIds);
    tickets = tickets.filter((t) => toDeleteIds.indexOf(t.id) === -1);
  }
  renderBadge();
  return rows;
}

function announceTickets(rows) {
  ticketQueue = rows.slice();
  showNextTicket();
}

function showNextTicket() {
  const t = ticketQueue.shift();
  if (!t) { $("#ticket-overlay").hidden = true; return; }
  const streak = t.reason === "streak";
  const goal = t.reason === "goal";
  const card = $("#ticket-card");
  card.classList.toggle("streak", streak);
  card.classList.toggle("goal", goal);
  card.querySelector(".ticket-stub").innerHTML = streak ? ICON.flame : ICON.ticket;
  $("#ticket-kicker").textContent = goal ? "GOAL COMPLETE" : streak ? "STREAK BONUS" : "TICKET EARNED";
  $("#ticket-title").textContent = goal
    ? `${t.count} tickets`
    : streak ? "Bonus ticket" : "One ticket";
  $("#ticket-sub").textContent = goal
    ? t.goal
    : streak
      ? `${Gold.currentStreak(days, habits, goals, settings, today)} days in a row`
      : t.date === today ? `${statsOn(t.date).target} points today` : `Earned on ${Gold.prettyDate(t.date)}`;
  $("#ticket-overlay").hidden = false;
  Sfx.earned(streak);
  // restart the entrance and the shimmer sweep for a second ticket in a row
  [card, card.querySelector(".shimmer")].forEach((n) => {
    n.style.animation = "none";
    void n.offsetWidth;
    n.style.animation = "";
  });
  Ui.vibrate([0, 30, 70, 30, 70, 60]);
}

$("#ticket-later").addEventListener("click", showNextTicket);
$("#ticket-spin").addEventListener("click", () => {
  ticketQueue = [];
  $("#ticket-overlay").hidden = true;
  showView("wheel");
});

// ---------- rewards: the core, the pool and the vault ----------

const TIER_ORDER = ["legendary", "epic", "rare", "common", "blank"];

function renderRewards() {
  rewardPrizes = activePrizes();
  const mine = unspent();
  const weighted = Gold.totalWeight(rewardPrizes) > 0;

  const core = Reveal.idle($("#reward-core"), mine.length);
  core.classList.toggle("empty", mine.length === 0 || !weighted);
  core.addEventListener("click", startReveal);

  const strip = $("#ticket-strip");
  const stub = (t) => {
    const cls = t.reason === "streak" ? " streak" : t.reason === "goal" ? " goal" : "";
    return `<span class="stub${cls}">${t.reason === "streak" ? ICON.flame : ICON.ticket} ${esc(Gold.prettyDate(t.date))}</span>`;
  };
  strip.innerHTML = mine.length === 0
    ? ""
    : mine.slice(0, 2).map(stub).join("") + (mine.length > 2 ? `<span class="stub">+${mine.length - 2} more</span>` : "");

  const btn = $("#spin-btn");
  btn.disabled = mine.length === 0 || !weighted;
  btn.textContent = mine.length === 0 ? "No tickets" : "Use a ticket";
  $("#wheel-hint").textContent = !weighted
    ? "Add prizes with a weight above zero in Settings."
    : mine.length === 0
      ? `Hit ${effTargetToday()} points in a day to earn a ticket.`
      : "Hold the screen during the show to speed it up.";

  // the pool, rarest first, so the odds read as a ladder
  const groups = TIER_ORDER.map((t) => ({ t, list: rewardPrizes.filter((p) => p.weight > 0 && Gold.rarityOf(p, rewardPrizes) === t) }))
    .filter((g) => g.list.length);
  $("#odds-list").innerHTML = groups.map((g) => {
    const pct = g.list.reduce((a, p) => a + Gold.probabilityFor(p, rewardPrizes), 0);
    return `<div class="odds-tier t-${g.t}" style="--cc:${Reveal.TIER[g.t].c}">` +
      `<span class="tier-chip">${Reveal.TIER[g.t].label}</span><span class="odds-pct">${pct.toFixed(0)}%</span></div>` +
      g.list.map((p) => '<div class="odds-row">' +
        `<span class="odds-emoji">${esc(p.emoji || "")}</span>` +
        `<span class="odds-name">${esc(p.name)}</span>` +
        `<span class="odds-pct">${Gold.probabilityFor(p, rewardPrizes).toFixed(1)}%</span></div>`).join("");
  }).join("");
  renderVault();
  renderBadge();
}

function startReveal() {
  if (Reveal.isPlaying()) return;
  const ticket = unspent().sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const draw = Gold.drawPrize(rewardPrizes);
  if (!ticket || !draw) return;
  Sfx.unlock();
  runReveal(ticket, draw);
}
$("#spin-btn").addEventListener("click", startReveal);

async function runReveal(ticket, draw) {
  const at = new Date().toISOString();

  // Persisted before the show: if the app dies mid-reveal the ticket is spent
  // and the prize is already in the vault, never the other way round.
  let win = null;
  if (!draw.prize.blank) {
    win = {
      id: Data.newId(),
      prize_name: draw.prize.name,
      prize_emoji: draw.prize.emoji,
      prize_color: draw.prize.color,
      won_at: at,
      redeemed_at: null,
    };
    await Data.wins.put(win);
    wins = wins.concat(win);
  }
  const spentTicket = Object.assign({}, ticket, { spent_at: at, win_id: win ? win.id : null });
  await Data.tickets.put(spentTicket);
  tickets = tickets.map((t) => (t.id === ticket.id ? spentTicket : t));

  await Reveal.play({ prizes: rewardPrizes, index: draw.index });
  renderRewards();
}

function renderVault() {
  const open = wins.filter((w) => !w.redeemed_at).sort((a, b) => b.won_at.localeCompare(a.won_at));
  const used = wins.filter((w) => w.redeemed_at).sort((a, b) => b.redeemed_at.localeCompare(a.redeemed_at));
  const pc = (w) => Ui.luminous(w.prize_color || "#E9B949", 64);

  const host = $("#vault-open");
  host.innerHTML = "";
  if (open.length === 0) {
    host.innerHTML = '<p class="empty">Nothing waiting. Use a ticket to win something.</p>';
  }
  for (const w of open) {
    const card = document.createElement("div");
    card.className = "prize-card glass open";
    card.style.setProperty("--pc", pc(w));
    card.innerHTML =
      `<div class="prize-emoji">${esc(w.prize_emoji || "🎁")}</div>` +
      `<div class="prize-main"><div class="prize-name">${esc(w.prize_name)}</div>` +
      `<div class="prize-date">Won ${esc(Gold.prettyDate(w.won_at.slice(0, 10)))}</div></div>` +
      '<button class="btn small" type="button">Use it</button>';
    card.querySelector("button").addEventListener("click", async () => {
      const upd = Object.assign({}, w, { redeemed_at: new Date().toISOString() });
      await Data.wins.put(upd);
      wins = wins.map((x) => (x.id === w.id ? upd : x));
      Ui.vibrate([0, 14, 40, 20]);
      Ui.burst(card.querySelector(".prize-emoji"), pc(w), 14);
      setTimeout(renderVault, 450);
    });
    host.appendChild(card);
  }

  $("#vault-past-head").hidden = used.length === 0;
  $("#vault-past").innerHTML = used.map((w) =>
    `<div class="prize-card glass used" style="--pc:${pc(w)}">` +
    `<div class="prize-emoji">${esc(w.prize_emoji || "🎁")}</div>` +
    `<div class="prize-main"><div class="prize-name">${esc(w.prize_name)}</div>` +
    `<div class="prize-date">Used ${esc(Gold.prettyDate(w.redeemed_at.slice(0, 10)))}</div></div></div>`
  ).join("");
}

// ---------- settings ----------

function renderSettings() {
  renderHabitsEditor();
  renderGoalEditor("week");
  renderGoalEditor("quarter");
  renderPrizesEditor();
  $("#set-target").value = settings.daily_points_target;
  $("#set-streak").value = settings.streak_length;
  $("#set-adapt").checked = settings.adapt !== false;
  const max = Math.max(...[0, 1, 2, 3, 4, 5, 6].map((k) =>
    Gold.maxPointsForDay(Gold.habitsActiveOn(habits, Gold.shiftDate(today, k)))));
  $("#target-hint").textContent = `Up to ${max} points are possible on your busiest day.`;
  $("#adapt-hint").textContent =
    `Hit it ${Gold.ADAPT.up} of ${Gold.ADAPT.window} days and it rises by one; ` +
    `${Gold.ADAPT.down} or fewer and it drops. Rest days are not counted. At most once every ${Gold.ADAPT.cooldown} days.`;

  $("#set-sound").checked = !Sfx.isMuted();

  const last = Number(localStorage.getItem("gold_last_backup") || 0);
  const daysAgo = last ? Math.floor((Date.now() - last) / 86400000) : null;
  $("#backup-hint").textContent = last
    ? `Last export ${daysAgo === 0 ? "today" : daysAgo + " days ago"}.${daysAgo > 14 ? " Worth doing again." : ""}`
    : "Never exported. Your data only exists on this phone.";
  $("#build").textContent = `Gold · build ${BUILD}`;
}

function renderHabitsEditor() {
  const list = Gold.activeHabits(habits);
  const host = $("#habits-editor");
  host.innerHTML = "";
  if (list.length === 0) host.innerHTML = '<p class="hint">No habits yet.</p>';
  list.forEach((h, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.style.setProperty("--c1", colorOf(h));
    row.innerHTML =
      `<div class="row-emoji">${esc(h.emoji || "•")}</div>` +
      `<div class="row-main"><div class="row-name">${esc(h.name)}</div>` +
      `<div class="row-sub">${esc(scheduleText(h))}</div></div>` +
      '<div class="row-move"><button type="button" data-move="-1">▲</button><button type="button" data-move="1">▼</button></div>' +
      '<button class="btn small" type="button" data-edit="1">Edit</button>';
    row.querySelector("[data-edit]").addEventListener("click", () => editHabit(h));
    row.querySelectorAll("[data-move]").forEach((b) =>
      b.addEventListener("click", () => moveHabit(i, Number(b.dataset.move))));
    host.appendChild(row);
  });
}

async function moveHabit(i, dir) {
  const list = Gold.activeHabits(habits);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  const ao = a.order, bo = b.order;
  a.order = bo; b.order = ao;
  await Data.habits.put(a);
  await Data.habits.put(b);
  renderHabitsEditor();
}

// the first palette colour no live habit is using yet
function freeColor() {
  const used = new Set(Gold.activeHabits(habits).map((h) => (h.color || "").toLowerCase()));
  const free = Ui.PALETTE.find((p) => !used.has(p[0].toLowerCase()));
  return (free || Ui.PALETTE[habits.length % Ui.PALETTE.length])[0];
}

function editHabit(h) {
  const isNew = !h;
  const habit = h || {
    id: Data.newId(), name: "", emoji: "✅", target: 1, color: freeColor(), time: "any", days: null,
    order: Gold.activeHabits(habits).length, created_at: new Date().toISOString(), archived_at: null,
  };
  openEditor({
    title: isNew ? "New habit" : "Edit habit",
    fields: [
      { key: "name", label: "Name", type: "text", value: habit.name },
      { key: "emoji", label: "Icon", type: "icon", value: habit.emoji, autoFollow: isNew },
      { key: "color", label: "Colour", type: "swatches", value: colorOf(habit) },
      { key: "target", label: "Times per day", type: "stepper", value: Gold.targetOf(habit), min: 1, max: 20 },
      { key: "time", label: "Time of day", type: "segmented", value: Gold.slotOf(habit),
        options: Gold.SLOTS.map((s) => ({ v: s, label: SLOT[s].label })) },
      { key: "days", label: "Repeat on", type: "weekdays", value: habit.days },
    ],
    canDelete: !isNew,
    onSave: async (v) => {
      if (!v.name.trim()) return false;
      const picked = v.days ? v.days.split(",").map(Number) : [];
      const rec = Object.assign({}, habit, {
        name: v.name.trim(), emoji: v.emoji.trim() || "✅",
        target: Math.max(1, Number(v.target) || 1),
        color: v.color || freeColor(),
        time: v.time || "any",
        days: picked.length && picked.length < 7 ? picked : null,
      });
      await Data.habits.put(rec);
      habits = habits.filter((x) => x.id !== rec.id).concat(rec);
      await syncTickets();
      renderSettings();
      return true;
    },
    // Archived, never deleted: past days and the streak they carry stay readable.
    onDelete: async () => {
      const rec = Object.assign({}, habit, { archived_at: new Date().toISOString() });
      await Data.habits.put(rec);
      habits = habits.map((x) => (x.id === rec.id ? rec : x));
      await syncTickets();
      renderSettings();
    },
  });
}

$("#add-habit-btn").addEventListener("click", () => editHabit(null));

// ---------- goal editors ----------

function renderGoalEditor(kind) {
  const host = $(kind === "week" ? "#week-editor" : "#quarter-editor");
  const open = Gold.openGoals(goals, kind);
  const done = Gold.doneGoals(goals, kind);
  host.innerHTML = "";
  if (!open.length && !done.length) {
    host.innerHTML = '<p class="hint">Nothing here yet.</p>';
    return;
  }
  for (const g of open.concat(done)) {
    const row = document.createElement("div");
    row.className = "row" + (g.done_at ? " struck" : "");
    if (kind === "quarter") row.style.setProperty("--c1", "#E9B949");
    const sub = g.done_at
      ? `done ${esc(Gold.prettyDate(g.done_at.slice(0, 10)))}`
      : (kind === "quarter" ? `${Gold.goalTickets(g)} tickets · ${esc(g.period || "")}` : "1 point when finished") +
        (Gold.stepProgress(g).total ? ` · ${Gold.stepProgress(g).done}/${Gold.stepProgress(g).total} steps` : "");
    row.innerHTML =
      `<div class="row-emoji">${esc(g.emoji || (kind === "quarter" ? "◆" : "◇"))}</div>` +
      `<div class="row-main"><div class="row-name">${esc(g.name)}</div><div class="row-sub">${sub}</div></div>` +
      (g.done_at ? '<button class="btn small" type="button" data-reopen="1">Undo</button>' : "") +
      '<button class="btn small" type="button" data-edit="1">Edit</button>';
    row.querySelector("[data-edit]").addEventListener("click", () => editGoal(kind, g));
    const re = row.querySelector("[data-reopen]");
    if (re) re.addEventListener("click", async () => { await reopenGoal(g); renderSettings(); });
    host.appendChild(row);
  }
}

function editGoal(kind, g) {
  const isNew = !g;
  const goal = g || {
    id: Data.newId(), kind, name: "", emoji: kind === "quarter" ? "◆" : "◇",
    tickets: 3, period: kind === "quarter" ? Gold.quarterOf(today) : null,
    order: Gold.openGoals(goals, kind).length,
    created_at: new Date().toISOString(), archived_at: null, done_at: null,
    note: "", steps: [],
  };
  const fields = [
    { key: "name", label: "Name", type: "text", value: goal.name },
    { key: "emoji", label: "Icon", type: "icon", value: goal.emoji, autoFollow: isNew },
    { key: "note", label: "Description", type: "textarea", value: goal.note || "" },
    { key: "steps", label: "Steps", type: "steps", value: goal.steps || [] },
  ];
  if (kind === "quarter") {
    fields.push({ key: "tickets", label: "Tickets it pays", type: "stepper", value: Gold.goalTickets(goal), min: 1, max: 20 });
    fields.push({ key: "period", label: "Quarter", type: "text", value: goal.period || Gold.quarterOf(today) });
  }
  openEditor({
    title: isNew ? (kind === "quarter" ? "New quarterly goal" : "New one-off goal") : "Edit goal",
    fields,
    canDelete: !isNew,
    onSave: async (v) => {
      if (!v.name.trim()) return false;
      const rec = Object.assign({}, goal, {
        name: v.name.trim(),
        emoji: v.emoji.trim() || (kind === "quarter" ? "◆" : "◇"),
        note: v.note.trim(),
        steps: v.steps,
      });
      if (kind === "quarter") {
        rec.tickets = Math.max(1, Number(v.tickets) || 3);
        rec.period = (v.period || "").trim() || Gold.quarterOf(today);
      }
      await Data.goals.put(rec);
      goals = goals.filter((x) => x.id !== rec.id).concat(rec);
      await syncTickets();
      renderSettings();
      return true;
    },
    // archived, never deleted: a finished goal's day still has to add up
    onDelete: async () => {
      const rec = Object.assign({}, goal, { archived_at: new Date().toISOString() });
      await Data.goals.put(rec);
      goals = goals.map((x) => (x.id === rec.id ? rec : x));
      await syncTickets();
      renderSettings();
    },
  });
}

$("#add-week-btn").addEventListener("click", () => editGoal("week", null));
$("#add-quarter-btn").addEventListener("click", () => editGoal("quarter", null));

$("#set-sound").addEventListener("change", (e) => {
  Sfx.setMuted(!e.target.checked);
  if (e.target.checked) { Sfx.unlock(); Sfx.earned(false); }
});

$("#save-deal-btn").addEventListener("click", async () => {
  const target = Math.max(1, Number($("#set-target").value) || 1);
  settings = Object.assign({}, settings, {
    streak_length: Math.max(2, Number($("#set-streak").value) || 7),
    adapt: $("#set-adapt").checked,
  });
  // dated, so setting it by hand does not re-judge days already banked
  if (target !== settings.daily_points_target) settings = Gold.applyTarget(settings, target, today);
  await Data.saveSettings(settings);
  await syncTickets();
  renderSettings();
  const flag = $("#deal-saved");
  flag.hidden = false;
  setTimeout(() => (flag.hidden = true), 1500);
});

function renderPrizesEditor() {
  const list = activePrizes();
  const host = $("#prizes-editor");
  host.innerHTML = "";
  if (list.length === 0) host.innerHTML = '<p class="hint">No prizes yet.</p>';
  for (const p of list) {
    const c = p.blank ? "#55525F" : Ui.luminous(p.color, 66);
    const row = document.createElement("div");
    row.className = "row";
    row.style.display = "block";
    row.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px">' +
      `<span class="swatch" style="background:${c};color:${c}"></span>` +
      `<div class="row-main"><div class="row-name">${esc(p.emoji || "")} ${esc(p.name)}</div></div>` +
      `<span class="pct">${Gold.probabilityFor(p, list).toFixed(1)}%</span>` +
      '<button class="btn small" type="button" data-edit="1">Edit</button></div>' +
      `<input class="weight-slider" type="range" min="0" max="30" step="1" value="${Math.max(0, p.weight)}" />`;
    row.querySelector("[data-edit]").addEventListener("click", () => editPrize(p));
    const slider = row.querySelector(".weight-slider");
    slider.addEventListener("input", () => {
      p.weight = Number(slider.value);
      const cur = activePrizes();
      host.querySelectorAll(".row").forEach((r, i) => {
        const q = cur[i];
        if (q) r.querySelector(".pct").textContent = Gold.probabilityFor(q, cur).toFixed(1) + "%";
      });
    });
    slider.addEventListener("change", async () => {
      await Data.prizes.put(p);
      renderPrizesEditor();
    });
    host.appendChild(row);
  }
}

function editPrize(p) {
  const isNew = !p;
  const prize = p || {
    id: Data.newId(), name: "", emoji: "🎁",
    color: Ui.PALETTE[activePrizes().length % Ui.PALETTE.length][0],
    weight: 10, order: activePrizes().length, archived_at: null,
  };
  openEditor({
    title: isNew ? "New prize" : "Edit prize",
    fields: [
      { key: "name", label: "Name", type: "text", value: prize.name },
      { key: "emoji", label: "Icon", type: "icon", value: prize.emoji, autoFollow: isNew },
      { key: "color", label: "Colour", type: "swatches", value: prize.color },
      { key: "weight", label: "Weight (higher = more likely)", type: "number", value: prize.weight, min: 0 },
      { key: "rarity", label: "Rarity", type: "segmented", value: prize.rarity || "auto",
        options: ["auto", "common", "rare", "epic", "legendary"].map((v) => ({ v, label: v === "auto" ? "Auto" : Reveal.TIER[v].label })) },
      { key: "blank", label: "Wins nothing", type: "checkbox", value: !!prize.blank },
    ],
    canDelete: !isNew,
    onSave: async (v) => {
      if (!v.name.trim()) return false;
      const rec = Object.assign({}, prize, {
        name: v.name.trim(), emoji: v.emoji.trim(), color: v.color || prize.color,
        weight: Math.max(0, Number(v.weight) || 0),
        rarity: v.rarity === "auto" ? null : v.rarity,
        blank: !!v.blank,
      });
      await Data.prizes.put(rec);
      prizes = prizes.filter((x) => x.id !== rec.id).concat(rec);
      renderPrizesEditor();
      return true;
    },
    // Wins copy the prize in, so archiving here cannot corrupt the vault.
    onDelete: async () => {
      const rec = Object.assign({}, prize, { archived_at: new Date().toISOString() });
      await Data.prizes.put(rec);
      prizes = prizes.map((x) => (x.id === rec.id ? rec : x));
      renderPrizesEditor();
    },
  });
}

$("#add-prize-btn").addEventListener("click", () => editPrize(null));

// ---------- generic editor sheet ----------
// Every field reads back through an input with id ed-<key>; the richer
// controls keep their value in a hidden one.

let editorCtx = null;

function fieldHtml(f) {
  const hidden = (val) => `<input id="ed-${f.key}" type="hidden" value="${esc(val == null ? "" : val)}" />`;
  switch (f.type) {
    case "checkbox":
      return `<label class="field row-field"><span>${esc(f.label)}</span>` +
        `<input id="ed-${f.key}" type="checkbox" class="switch"${f.value ? " checked" : ""} /></label>`;
    case "icon":
      return `<div class="field"><span>${esc(f.label)}</span>` +
        `<div class="icon-row" id="ed-${f.key}-row"></div>` +
        `<input id="ed-${f.key}" type="text" value="${esc(f.value)}" class="icon-custom" placeholder="or type one" /></div>`;
    case "swatches":
      return `<div class="field"><span>${esc(f.label)}</span><div class="swatches" data-for="${f.key}">` +
        Ui.PALETTE.map(([c1, c2]) =>
          `<button type="button" class="swatch-btn${c1.toLowerCase() === String(f.value || "").toLowerCase() ? " on" : ""}" data-v="${c1}" style="--c1:${c1};--c2:${c2}" aria-label="${c1}"></button>`).join("") +
        `</div>${hidden(f.value)}</div>`;
    case "segmented":
      return `<div class="field"><span>${esc(f.label)}</span><div class="segmented" data-for="${f.key}" style="--n:${f.options.length}">` +
        f.options.map((o) => `<button type="button" data-v="${o.v}" class="${o.v === f.value ? "on" : ""}">${esc(o.label)}</button>`).join("") +
        `</div>${hidden(f.value)}</div>`;
    case "weekdays": {
      const on = f.value && f.value.length ? f.value : [0, 1, 2, 3, 4, 5, 6];
      const order = [1, 2, 3, 4, 5, 6, 0];
      return `<div class="field"><span>${esc(f.label)}</span><div class="weekdays" data-for="${f.key}">` +
        order.map((d) => `<button type="button" data-v="${d}" class="${on.indexOf(d) !== -1 ? "on" : ""}">${"SMTWTFS"[d]}</button>`).join("") +
        `</div>${hidden(on.join(","))}</div>`;
    }
    case "textarea":
      return `<label class="field"><span>${esc(f.label)}</span>` +
        `<textarea id="ed-${f.key}" rows="3" placeholder="What it means, why it matters">${esc(f.value)}</textarea></label>`;
    case "steps":
      return `<div class="field"><span>${esc(f.label)}</span><div class="steps-edit" id="ed-${f.key}">` +
        f.value.map(stepRowHtml).join("") +
        '<div class="step-add"><input type="text" placeholder="Add a step" enterkeyhint="done" />' +
        '<button type="button" class="btn small" aria-label="Add step">+</button></div></div></div>';
    case "stepper":
      return `<div class="field"><span>${esc(f.label)}</span><div class="stepper" data-for="${f.key}" data-min="${f.min || 0}" data-max="${f.max || 99}">` +
        `<button type="button" data-d="-1" aria-label="Less">−</button><output>${esc(f.value)}</output>` +
        `<button type="button" data-d="1" aria-label="More">+</button></div>${hidden(f.value)}</div>`;
    default:
      return `<label class="field"><span>${esc(f.label)}</span>` +
        `<input id="ed-${f.key}" type="${f.type}" value="${esc(f.value)}"` +
        (f.min != null ? ` min="${f.min}"` : "") +
        (f.type === "number" ? ' step="1" inputmode="numeric"' : "") + " /></label>";
  }
}

const stepRowHtml = (st) =>
  `<div class="step-row" data-id="${esc(st.id)}" data-done="${esc(st.done_at || "")}">` +
  `<input type="text" value="${esc(st.name)}" /><button type="button" class="step-del" aria-label="Remove step">×</button></div>`;

// Steps in the editor: rows keep their id, so a renamed step stays ticked.
// Text left in the add box counts as a step too.
function readSteps(box) {
  const rows = Array.from(box.querySelectorAll(".step-row")).map((r) => ({
    id: r.dataset.id, name: r.querySelector("input").value.trim(), done_at: r.dataset.done || null,
  }));
  const pending = box.querySelector(".step-add input").value.trim();
  if (pending) rows.push({ id: Data.newId(), name: pending, done_at: null });
  return rows.filter((r) => r.name);
}

function wireControls() {
  const box = $("#editor-fields");
  const sheet = box.closest(".sheet");
  box.querySelectorAll(".swatches").forEach((w) => {
    const input = $(`#ed-${w.dataset.for}`);
    sheet.style.setProperty("--c1", input.value || Ui.PALETTE[0][0]);
    w.querySelectorAll(".swatch-btn").forEach((b) => b.addEventListener("click", () => {
      w.querySelectorAll(".swatch-btn").forEach((x) => x.classList.toggle("on", x === b));
      input.value = b.dataset.v;
      sheet.style.setProperty("--c1", b.dataset.v);
      Ui.vibrate(6);
    }));
  });
  box.querySelectorAll(".segmented").forEach((w) => {
    const input = $(`#ed-${w.dataset.for}`);
    w.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      w.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      input.value = b.dataset.v;
      Ui.vibrate(5);
    }));
  });
  box.querySelectorAll(".weekdays").forEach((w) => {
    const input = $(`#ed-${w.dataset.for}`);
    w.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const on = w.querySelectorAll("button.on");
      if (b.classList.contains("on") && on.length === 1) return; // at least one day
      b.classList.toggle("on");
      input.value = Array.from(w.querySelectorAll("button.on")).map((x) => x.dataset.v).join(",");
      Ui.vibrate(5);
    }));
  });
  box.querySelectorAll(".steps-edit").forEach((w) => {
    const input = w.querySelector(".step-add input");
    const wireRow = (row) => row.querySelector(".step-del").addEventListener("click", () => { row.remove(); Ui.vibrate(5); });
    w.querySelectorAll(".step-row").forEach(wireRow);
    const add = () => {
      const name = input.value.trim();
      if (!name) return;
      const tmp = document.createElement("div");
      tmp.innerHTML = stepRowHtml({ id: Data.newId(), name, done_at: null });
      const row = tmp.firstChild;
      w.insertBefore(row, w.querySelector(".step-add"));
      wireRow(row);
      input.value = "";
      input.focus();
      Ui.vibrate(5);
    };
    w.querySelector(".step-add .btn").addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  });
  box.querySelectorAll(".stepper").forEach((w) => {
    const input = $(`#ed-${w.dataset.for}`);
    const out = w.querySelector("output");
    w.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const v = Math.min(Number(w.dataset.max), Math.max(Number(w.dataset.min), Number(input.value) + Number(b.dataset.d)));
      input.value = String(v);
      out.textContent = String(v);
      Ui.vibrate(5);
    }));
  });
}

function openEditor(ctx) {
  editorCtx = ctx;
  $("#editor-title").textContent = ctx.title;
  $("#editor-fields").innerHTML = ctx.fields.map(fieldHtml).join("");
  wireIconPickers(ctx);
  wireControls();
  $("#editor-delete").hidden = !ctx.canDelete;
  $("#editor-modal").hidden = false;
}

// The icon follows what you type in the name field until you overrule it, so
// most of the time you never touch it at all.
function wireIconPickers(ctx) {
  for (const f of ctx.fields) {
    if (f.type !== "icon") continue;
    const input = $(`#ed-${f.key}`);
    const row = $(`#ed-${f.key}-row`);
    const nameInput = $(`#ed-${f.from || "name"}`);
    let chosen = !!f.value && !f.autoFollow;

    const paint = () => {
      const picks = Gold.suggestIcons(nameInput ? nameInput.value : "", 6);
      if (!chosen && picks.length) input.value = picks[0];
      row.innerHTML = picks
        .map((e) => `<button type="button" class="icon-chip${e === input.value ? " on" : ""}">${esc(e)}</button>`)
        .join("");
      row.querySelectorAll(".icon-chip").forEach((b) => b.addEventListener("click", () => {
        chosen = true;
        input.value = b.textContent;
        paint();
        Sfx.blip(0.5);
      }));
    };

    if (nameInput) nameInput.addEventListener("input", paint);
    input.addEventListener("input", () => { chosen = true; paint(); });
    paint();
  }
}

function closeEditor() {
  $("#editor-modal").hidden = true;
  editorCtx = null;
  if (!$("#view-today").hidden) { heroFor = null; renderToday(); }
}

$("#editor-cancel").addEventListener("click", closeEditor);
$("#editor-modal").addEventListener("click", (e) => { if (e.target.id === "editor-modal") closeEditor(); });
$("#editor-save").addEventListener("click", async () => {
  const v = {};
  editorCtx.fields.forEach((f) => {
    const n = $(`#ed-${f.key}`);
    v[f.key] = f.type === "checkbox" ? n.checked : f.type === "steps" ? readSteps(n) : n.value;
  });
  const ok = await editorCtx.onSave(v);
  if (ok !== false) closeEditor();
});
$("#editor-delete").addEventListener("click", async () => {
  if (!confirm("Remove this? Past history is kept.")) return;
  await editorCtx.onDelete();
  closeEditor();
});

// ---------- backup / restore ----------

$("#backup-btn").addEventListener("click", async () => {
  await Data.exportBackup();
  renderSettings();
});
$("#restore-btn").addEventListener("click", () => $("#restore-file").click());
$("#restore-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm("Restore replaces everything currently in the app. Continue?")) { e.target.value = ""; return; }
  try {
    const json = JSON.parse(await file.text());
    await Data.restoreBackup(json);
    await reloadCaches(); // records the restored counts as what this phone holds
    alert("Restored.");
    location.reload();   // boot again on the restored data, from any screen
    return;
  } catch (err) {
    alert("Restore failed: " + err.message);
  }
  e.target.value = "";
});

// ---------- the moving bar ----------

// Checked once a day, not on every mutation: the bar is allowed to move on its
// own, but you are always told, and you can put it back.
async function checkBar() {
  const move = Gold.adaptTarget(days, habits, goals, settings, today);
  if (!move) return;
  const prev = settings;
  settings = Gold.applyTarget(settings, move.to, today);
  await Data.saveSettings(settings);
  await syncTickets();
  showBarNotice(move, prev);
}

function showBarNotice(move, prev) {
  const up = move.dir === "up";
  $("#bar-notice-text").innerHTML =
    `<strong>The bar moved ${up ? "up" : "down"}: ${move.from} → ${move.to} points.</strong><br>` +
    `You hit it ${move.hit} of the last ${move.window} days that asked for something.`;
  $("#bar-notice").classList.toggle("down", !up);
  $("#bar-notice").hidden = false;
  $("#bar-notice-undo").onclick = async () => {
    settings = prev;
    await Data.saveSettings(settings);
    await syncTickets();
    $("#bar-notice").hidden = true;
    heroFor = null;
    renderToday();
  };
}

// ---------- init ----------

const counts = () => ({
  habits: habits.length, goals: goals.length, days: days.length, prizes: prizes.length, wins: wins.length,
});
const shortOf = (want) => {
  const have = counts();
  return Object.keys(have).filter((k) => have[k] < (want[k] || 0));
};

async function loadOnce() {
  [habits, goals, days, tickets, prizes, wins] = await DB.withTimeout(Promise.all([
    Data.habits.all(), Data.goals.all(), Data.days.all(),
    Data.tickets.all(), Data.prizes.all(), Data.wins.all(),
  ]), 4000, "Loading your data");
  settings = await DB.withTimeout(Data.getSettings(), 4000, "Loading your settings");
}

async function ensureSettings() {
  if (!settings) {
    settings = Gold.defaultSettings(habits, Gold.todayStr());
    await Data.saveSettings(settings);
  }
  // installs from before the bar was dated
  if (!settings.target_history) {
    settings = Gold.applyTarget(settings, settings.daily_points_target, Gold.todayStr());
    await Data.saveSettings(settings);
  }
}

// Habits from before the redesign have no colour; give each its own, once.
async function ensureColors() {
  const missing = Gold.activeHabits(habits).filter((h) => !h.color);
  for (const h of missing) {
    h.color = freeColor();
    await Data.habits.put(h);
  }
}

// After a restore or any deliberate reload: trust what is read.
async function reloadCaches() {
  await loadOnce();
  await ensureSettings();
  Data.remember(counts());
}

// At startup, a read that comes back short of what this phone is known to hold
// is a failed read. Re-open and retry; if it stays short, return false and
// write nothing — no seed, no default settings, no ticket reconciliation —
// because every one of those would make the bad read permanent.
async function bootLoad() {
  const want = Data.known();
  let failed = null;
  for (let i = 0; i < 4; i++) {
    try {
      await loadOnce();
      failed = null;
      if (!shortOf(want).length && (settings || !want.seeded)) break;
    } catch (e) {
      failed = e;
    }
    if (i < 3) {
      DB.close();
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  if (failed) throw failed;
  const missing = shortOf(want);
  if (missing.length || (!settings && want.seeded)) {
    return { ok: false, want, missing };
  }
  await ensureSettings();
  await ensureColors();
  Data.remember(counts());
  return { ok: true };
}

function showLoadProblem(msg) {
  const box = $("#load-problem");
  $("#load-problem-text").textContent = msg;
  box.hidden = false;
  $("#boot").hidden = true;
}
$("#load-problem-retry").addEventListener("click", () => location.reload());
$("#load-problem-restore").addEventListener("click", () => $("#restore-file").click());
// The only path that lets a phone known to hold data be seeded again, and it
// takes an explicit yes.
$("#load-problem-fresh").addEventListener("click", () => {
  if (!confirm("Start over with a fresh setup? Only do this if your data is really gone — try again first.")) return;
  localStorage.removeItem("gold_known");
  location.reload();
});

Ui.grain();

(async function init() {
  try {
    await DB.withTimeout(Data.init(), 6000, "Opening storage");
    const res = await bootLoad();
    if (!res.ok) {
      const have = counts();
      const lines = res.missing.map((k) => `${have[k]} of ${res.want[k]} ${k}`).join(", ");
      showLoadProblem(`Only part of your data loaded (${lines}). Nothing has been changed or deleted.`);
      return;
    }
  } catch (e) {
    console.error(e);
    showLoadProblem(`${e.message}. Nothing has been changed or deleted.`);
    return;
  }
  today = Gold.todayStr();
  viewDate = today;
  await syncTickets();
  await checkBar();
  // first paint in the real typefaces, but never wait long for them
  if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
  showView("today");
  $("#boot").hidden = true;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    if (Gold.todayStr() === today) return;
    today = Gold.todayStr();
    viewDate = today;
    await syncTickets();
    await checkBar();
    if (!$("#view-today").hidden) { heroFor = null; renderToday(); }
  });
})();
