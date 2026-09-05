// Gold — views, rendering, wiring. Rules live in logic.js, storage in db.js,
// the wheel in wheel.js.
"use strict";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let habits = [];
let days = [];
let tickets = [];
let prizes = [];
let wins = [];
let settings = null;
let today = Gold.todayStr();

let ticketQueue = [];
let wheelPrizes = [];
let pendingWin = null;

const RING_C = 2 * Math.PI * 60;
const ICON = {
  ticket: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 7h16a1.5 1.5 0 0 1 1.5 1.5V10a2 2 0 0 0 0 4v1.5A1.5 1.5 0 0 1 20 17H4a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4V8.5A1.5 1.5 0 0 1 4 7z"/>' +
    '<path d="M9.5 8.2v1.5M9.5 11.2v1.5M9.5 14.3v1.5"/></svg>',
  flame: '<svg class="ico flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2c.4 3-1.8 4.4-3 6.1' +
    '-1 1.4-1.6 2.7-1.6 4.2 0 .8.2 1.5.6 2.1-.9-.4-1.6-1.1-2-2C5.6 13.6 5 15 5 16.4 5 19.9 8.1 22 12 22s7-2.4 ' +
    '7-6.2c0-2.6-1.3-4.7-2.9-6.4-.3 1.3-1 2.1-1.9 2.5.7-2.9-.2-6.5-1.6-9.9z"/></svg>',
};
// deep jewel tones: saturated brights turn the wheel into clip art next to gold
const PRIZE_COLORS = ["#4C2A85", "#8E2743", "#A8541C", "#1F6B5B", "#23457A", "#6B2E6B", "#7A6A16", "#8C3520"];

// ---------- helpers ----------

const dayRecord = (date) => days.find((d) => d.date === date) || { date, counts: {} };
const activeHabits = () => Gold.habitsActiveOn(habits, today);
const activePrizes = () => Gold.activePrizes(prizes);
const unspent = () => Gold.unspentTickets(tickets);

function effTargetToday() {
  return Gold.effectiveTarget(settings.daily_points_target, Gold.maxPointsForDay(activeHabits()));
}

// ---------- views ----------

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  $(`#view-${name}`).hidden = false;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "today") {
    if (Gold.todayStr() !== today) today = Gold.todayStr();
    renderToday();
  }
  if (name === "wheel") renderWheel();
  if (name === "vault") renderVault();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

function renderBadge() {
  const n = unspent().length;
  document.querySelector('.tab[data-view="wheel"]').classList.toggle("badge", n > 0);
}

// ---------- today ----------

function renderToday() {
  const act = activeHabits();
  const day = dayRecord(today);
  const points = Gold.pointsForDay(day.counts, act);
  const max = Gold.maxPointsForDay(act);
  const target = effTargetToday();

  $("#hero-date").textContent = Gold.prettyDate(today);
  $("#ring-points").textContent = points;
  $("#ring-of").textContent = max ? `of ${max}` : "no habits";

  const pct = max ? Math.min(1, points / max) : 0;
  const fill = $("#ring-fill");
  fill.style.strokeDashoffset = String(RING_C * (1 - pct));
  // a round cap draws a dot even at zero length, which reads as false progress
  fill.style.opacity = pct > 0 ? "1" : "0";
  const mark = $("#ring-mark");
  if (max && target < max) {
    mark.hidden = false;
    // exactly one dash per revolution, parked at the payline
    mark.style.strokeDasharray = `3 ${RING_C - 3}`;
    mark.style.strokeDashoffset = String(-(target / max) * RING_C);
  } else {
    mark.hidden = true;
  }
  document.querySelector(".ring-wrap").classList.toggle("complete", target > 0 && points >= target);

  const streak = Gold.currentStreak(days, habits, settings.daily_points_target, today);
  $("#streak-num").textContent = streak;
  $("#streak-stat").classList.toggle("live", streak > 0);
  const spins = unspent().length;
  $("#tickets-num").textContent = spins;
  $("#tickets-stat").classList.toggle("live", spins > 0);
  renderBadge();

  const list = $("#habit-list");
  list.innerHTML = "";
  if (act.length === 0) {
    list.innerHTML = '<p class="empty">No habits yet. Add a few in Settings.</p>';
  }
  for (const h of act) {
    const n = day.counts[h.id] || 0;
    const t = Gold.targetOf(h);
    const row = document.createElement("div");
    row.className = "habit" + (n >= t ? " done" : "");
    row.innerHTML =
      '<div class="sweep"></div>' +
      `<div class="habit-emoji">${esc(h.emoji || "•")}</div>` +
      `<div class="habit-main"><div class="habit-name">${esc(h.name)}</div>` +
      (t > 1 ? `<div class="habit-meta">${n} of ${t} today</div>` : "") +
      "</div>" +
      (t <= 5
        ? `<div class="pips">${Array.from({ length: t }, (_, i) => `<span class="pip${i < n ? " on" : ""}"></span>`).join("")}</div>`
        : `<div class="pip-count">${n}/${t}</div>`) +
      (n > 0 ? '<button class="minus" type="button" aria-label="Undo one">−</button>' : "");

    row.addEventListener("click", (e) => {
      if (e.target.closest(".minus")) return;
      bump(h, +1, row);
    });
    const minus = row.querySelector(".minus");
    if (minus) minus.addEventListener("click", () => bump(h, -1, row));
    list.appendChild(row);
  }

  const left = Math.max(0, target - points);
  $("#today-hint").textContent = act.length === 0 ? ""
    : left > 0
      ? `${left} more point${left === 1 ? "" : "s"} for a spin — ${target} of ${max} possible.`
      : `Spin earned. ${points} of ${max} possible today.`;
}

async function bump(habit, delta, row) {
  const t = Gold.targetOf(habit);
  const day = dayRecord(today);
  const cur = day.counts[habit.id] || 0;
  const next = Math.max(0, Math.min(t, cur + delta));
  if (next === cur) return;

  const counts = Object.assign({}, day.counts, { [habit.id]: next });
  const rec = { date: today, counts };
  await Data.days.put(rec);
  days = days.filter((d) => d.date !== today).concat(rec);

  Wheel.vibrate(next > cur ? 12 : 6);
  if (row && next > cur) {
    if (next >= t) { row.classList.add("sweeping"); setTimeout(() => row.classList.remove("sweeping"), 800); }
    const pip = row.querySelectorAll(".pip")[next - 1];
    if (pip) { pip.classList.add("pop"); setTimeout(() => pip.classList.remove("pop"), 240); }
  }

  const added = await syncTickets();
  renderToday();
  if (added.length) setTimeout(() => announceTickets(added), 260);
}

// ---------- tickets ----------

// The ledger is rebuilt from the day history on every mutation, so a ticket can
// never be minted twice for the same day and an unspent one vanishes again if
// the day falls back below the threshold.
async function syncTickets() {
  const owed = Gold.ticketsOwed(days, habits, settings, today);
  const { toAdd, toDeleteIds } = Gold.reconcileTickets(tickets, owed);
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
  return rows.filter((r) => r.date === today);
}

function announceTickets(rows) {
  ticketQueue = rows.slice();
  showNextTicket();
}

function showNextTicket() {
  const t = ticketQueue.shift();
  if (!t) { $("#ticket-overlay").hidden = true; return; }
  const streak = t.reason === "streak";
  const card = $("#ticket-card");
  card.classList.toggle("streak", streak);
  card.querySelector(".ticket-stub").innerHTML = streak ? ICON.flame : ICON.ticket;
  $("#ticket-kicker").textContent = streak ? "STREAK BONUS" : "SPIN EARNED";
  $("#ticket-title").textContent = streak ? "Bonus spin" : "One spin of the wheel";
  $("#ticket-sub").textContent = streak
    ? `${Gold.currentStreak(days, habits, settings.daily_points_target, today)} days in a row`
    : `${effTargetToday()} points today`;
  $("#ticket-overlay").hidden = false;
  // restart the entrance and the shimmer sweep for a second ticket in a row
  [card, card.querySelector(".shimmer")].forEach((n) => {
    n.style.animation = "none";
    void n.offsetWidth;
    n.style.animation = "";
  });
  Wheel.vibrate([0, 30, 70, 30, 70, 60]);
}

$("#ticket-later").addEventListener("click", showNextTicket);
$("#ticket-spin").addEventListener("click", () => {
  ticketQueue = [];
  $("#ticket-overlay").hidden = true;
  showView("wheel");
});

// ---------- wheel ----------

function renderWheel() {
  wheelPrizes = activePrizes();
  Wheel.render($("#wheel-host"), wheelPrizes);

  const strip = $("#ticket-strip");
  const mine = unspent();
  strip.innerHTML = mine.length === 0
    ? '<span class="hint">No tickets yet</span>'
    : mine.slice(0, 2).map((t) =>
        `<span class="stub${t.reason === "streak" ? " streak" : ""}">${t.reason === "streak" ? ICON.flame : ICON.ticket} ${esc(Gold.prettyDate(t.date))}</span>`
      ).join("") + (mine.length > 2 ? `<span class="stub">+${mine.length - 2} more</span>` : "");

  const weighted = Gold.totalWeight(wheelPrizes) > 0;
  const btn = $("#spin-btn");
  btn.disabled = mine.length === 0 || !weighted;
  btn.textContent = mine.length === 0 ? "No tickets" : `Spin (${mine.length})`;
  $("#wheel-hint").textContent = !weighted
    ? "Add prizes with a weight above zero in Settings."
    : mine.length === 0
      ? `Hit ${effTargetToday()} points in a day to earn a spin.`
      : "";

  const odds = $("#odds-list");
  odds.innerHTML = wheelPrizes.map((p) =>
    '<div class="odds-row">' +
    `<span class="swatch" style="background:${esc(p.color)}"></span>` +
    `<span class="odds-name">${esc(p.emoji || "")} ${esc(p.name)}</span>` +
    `<span class="odds-pct">${Gold.probabilityFor(p, wheelPrizes).toFixed(1)}%</span></div>`
  ).join("");
  renderBadge();
}

$("#spin-btn").addEventListener("click", async () => {
  if (Wheel.isSpinning()) return;
  const ticket = unspent().sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const draw = Gold.drawPrize(wheelPrizes);
  if (!ticket || !draw) return;

  // Persisted before the animation: if the app dies mid-spin the ticket is
  // spent and the prize is already in the vault, never the other way round.
  const win = {
    id: Data.newId(),
    prize_name: draw.prize.name,
    prize_emoji: draw.prize.emoji,
    prize_color: draw.prize.color,
    won_at: new Date().toISOString(),
    redeemed_at: null,
  };
  await Data.wins.put(win);
  wins = wins.concat(win);
  const spentTicket = Object.assign({}, ticket, { spent_at: win.won_at, win_id: win.id });
  await Data.tickets.put(spentTicket);
  tickets = tickets.map((t) => (t.id === ticket.id ? spentTicket : t));

  $("#spin-btn").disabled = true;
  $("#ticket-strip").innerHTML = "";
  pendingWin = win;
  Wheel.spin(draw.index, () => {
    Wheel.burst(draw.prize.color);
    $("#win-emoji").textContent = draw.prize.emoji || "🎁";
    $("#win-name").textContent = draw.prize.name;
    $("#win-card").style.borderColor = draw.prize.color;
    $("#win-overlay").hidden = false;
  });
});

$("#win-ok").addEventListener("click", () => {
  $("#win-overlay").hidden = true;
  pendingWin = null;
  renderWheel();
});

// ---------- vault ----------

function renderVault() {
  const open = wins.filter((w) => !w.redeemed_at).sort((a, b) => b.won_at.localeCompare(a.won_at));
  const used = wins.filter((w) => w.redeemed_at).sort((a, b) => b.redeemed_at.localeCompare(a.redeemed_at));

  const host = $("#vault-open");
  host.innerHTML = "";
  if (open.length === 0) {
    host.innerHTML = '<p class="empty">Nothing waiting. Win something on the wheel.</p>';
  }
  for (const w of open) {
    const card = document.createElement("div");
    card.className = "prize-card open";
    card.innerHTML =
      `<div class="prize-emoji">${esc(w.prize_emoji || "🎁")}</div>` +
      `<div class="prize-main"><div class="prize-name">${esc(w.prize_name)}</div>` +
      `<div class="prize-date">Won ${esc(Gold.prettyDate(w.won_at.slice(0, 10)))}</div></div>` +
      '<button class="btn small" type="button">Mark used</button>';
    card.querySelector("button").addEventListener("click", async () => {
      const upd = Object.assign({}, w, { redeemed_at: new Date().toISOString() });
      await Data.wins.put(upd);
      wins = wins.map((x) => (x.id === w.id ? upd : x));
      Wheel.vibrate(10);
      renderVault();
    });
    host.appendChild(card);
  }

  $("#vault-past-head").hidden = used.length === 0;
  $("#vault-past").innerHTML = used.map((w) =>
    '<div class="prize-card used">' +
    `<div class="prize-emoji">${esc(w.prize_emoji || "🎁")}</div>` +
    `<div class="prize-main"><div class="prize-name">${esc(w.prize_name)}</div>` +
    `<div class="prize-date">Used ${esc(Gold.prettyDate(w.redeemed_at.slice(0, 10)))}</div></div></div>`
  ).join("");
}

// ---------- settings ----------

function renderSettings() {
  renderHabitsEditor();
  renderPrizesEditor();
  $("#set-target").value = settings.daily_points_target;
  $("#set-streak").value = settings.streak_length;
  const max = Gold.maxPointsForDay(Gold.activeHabits(habits));
  $("#target-hint").textContent = `${max} points possible per day right now.`;

  const last = Number(localStorage.getItem("gold_last_backup") || 0);
  const daysAgo = last ? Math.floor((Date.now() - last) / 86400000) : null;
  $("#backup-hint").textContent = last
    ? `Last export ${daysAgo === 0 ? "today" : daysAgo + " days ago"}.${daysAgo > 14 ? " Worth doing again." : ""}`
    : "Never exported. Your data only exists on this phone.";
}

function renderHabitsEditor() {
  const list = Gold.activeHabits(habits);
  const host = $("#habits-editor");
  host.innerHTML = "";
  if (list.length === 0) host.innerHTML = '<p class="hint">No habits yet.</p>';
  list.forEach((h, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      `<div class="row-emoji">${esc(h.emoji || "•")}</div>` +
      `<div class="row-main"><div class="row-name">${esc(h.name)}</div>` +
      `<div class="row-sub">${Gold.targetOf(h)}× per day</div></div>` +
      '<div class="row-move"><button type="button" data-move="-1">▲</button><button type="button" data-move="1">▼</button></div>' +
      '<button class="btn small" type="button" data-edit="1">Edit</button>';
    row.querySelector('[data-edit]').addEventListener("click", () => editHabit(h));
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

function editHabit(h) {
  const isNew = !h;
  const habit = h || {
    id: Data.newId(), name: "", emoji: "✅", target: 1,
    order: Gold.activeHabits(habits).length, created_at: new Date().toISOString(), archived_at: null,
  };
  openEditor({
    title: isNew ? "New habit" : "Edit habit",
    fields: [
      { key: "name", label: "Name", type: "text", value: habit.name },
      { key: "emoji", label: "Emoji", type: "text", value: habit.emoji },
      { key: "target", label: "Times per day", type: "number", value: Gold.targetOf(habit), min: 1 },
    ],
    canDelete: !isNew,
    onSave: async (v) => {
      if (!v.name.trim()) return false;
      const rec = Object.assign({}, habit, {
        name: v.name.trim(), emoji: v.emoji.trim() || "✅", target: Math.max(1, Number(v.target) || 1),
      });
      await Data.habits.put(rec);
      habits = habits.filter((x) => x.id !== rec.id).concat(rec);
      await syncTickets();
      renderHabitsEditor();
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

$("#save-deal-btn").addEventListener("click", async () => {
  settings = Object.assign({}, settings, {
    daily_points_target: Math.max(1, Number($("#set-target").value) || 1),
    streak_length: Math.max(2, Number($("#set-streak").value) || 7),
  });
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
    const row = document.createElement("div");
    row.className = "row";
    row.style.display = "block";
    row.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px">' +
      `<span class="swatch" style="background:${esc(p.color)}"></span>` +
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
    color: PRIZE_COLORS[activePrizes().length % PRIZE_COLORS.length],
    weight: 10, order: activePrizes().length, archived_at: null,
  };
  openEditor({
    title: isNew ? "New prize" : "Edit prize",
    fields: [
      { key: "name", label: "Name", type: "text", value: prize.name },
      { key: "emoji", label: "Emoji", type: "text", value: prize.emoji },
      { key: "color", label: "Colour", type: "color", value: prize.color },
      { key: "weight", label: "Weight (higher = more likely)", type: "number", value: prize.weight, min: 0 },
    ],
    canDelete: !isNew,
    onSave: async (v) => {
      if (!v.name.trim()) return false;
      const rec = Object.assign({}, prize, {
        name: v.name.trim(), emoji: v.emoji.trim(), color: v.color,
        weight: Math.max(0, Number(v.weight) || 0),
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

let editorCtx = null;

function openEditor(ctx) {
  editorCtx = ctx;
  $("#editor-title").textContent = ctx.title;
  $("#editor-fields").innerHTML = ctx.fields.map((f) =>
    `<label class="field"><span>${esc(f.label)}</span>` +
    `<input id="ed-${f.key}" type="${f.type}" value="${esc(f.value)}"` +
    (f.min != null ? ` min="${f.min}"` : "") +
    (f.type === "number" ? ' step="1" inputmode="numeric"' : "") + " /></label>"
  ).join("");
  $("#editor-delete").hidden = !ctx.canDelete;
  $("#editor-modal").hidden = false;
}

function closeEditor() {
  $("#editor-modal").hidden = true;
  editorCtx = null;
}

$("#editor-cancel").addEventListener("click", closeEditor);
$("#editor-modal").addEventListener("click", (e) => { if (e.target.id === "editor-modal") closeEditor(); });
$("#editor-save").addEventListener("click", async () => {
  const v = {};
  editorCtx.fields.forEach((f) => (v[f.key] = $(`#ed-${f.key}`).value));
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
    await reloadCaches();
    renderSettings();
    alert("Restored.");
  } catch (err) {
    alert("Restore failed: " + err.message);
  }
  e.target.value = "";
});

// ---------- init ----------

async function reloadCaches() {
  [habits, days, tickets, prizes, wins] = await Promise.all([
    Data.habits.all(), Data.days.all(), Data.tickets.all(), Data.prizes.all(), Data.wins.all(),
  ]);
  settings = await Data.getSettings();
  if (!settings) {
    settings = Gold.defaultSettings(habits);
    await Data.saveSettings(settings);
  }
}

(async function init() {
  await Data.init();
  await reloadCaches();
  today = Gold.todayStr();
  await syncTickets();
  showView("today");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    if (Gold.todayStr() === today) return;
    today = Gold.todayStr();
    await syncTickets();
    if (!$("#view-today").hidden) renderToday();
  });
})();
