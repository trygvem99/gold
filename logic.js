// Gold pure logic — shared by the browser (window.Gold) and node tests.
// Every rule of the economy lives here: points, qualifying days, streaks,
// ticket reconciliation, the moving bar, weighted draw, wheel geometry.
// No DOM, no IndexedDB.
(function (global) {
  "use strict";

  const DAY_MS = 86400000;
  // dates are "YYYY-MM-DD" strings; parse as UTC so DST never shifts a day
  const dayNum = (d) => Math.round(Date.parse(d + "T00:00:00Z") / DAY_MS);
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  const shiftDate = (date, days) => new Date((dayNum(date) + days) * DAY_MS).toISOString().slice(0, 10);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // local calendar day — never toISOString(), which would shift across UTC
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const prettyDate = (date) =>
    new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  function quarterOf(date) {
    const y = date.slice(0, 4);
    const m = Number(date.slice(5, 7));
    return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  }

  // ---------- habits ----------

  const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
  const activeHabits = (habits) => habits.filter((h) => !h.archived_at).slice().sort(byOrder);
  const targetOf = (h) => Math.max(1, h.target || 1);

  // A habit counts on a given day only if it existed then and was not yet
  // archived. Without this, adding a habit today would retroactively raise the
  // bar for past days and silently break a live streak.
  function habitsActiveOn(habits, date) {
    return habits
      .filter((h) => {
        const created = (h.created_at || "").slice(0, 10);
        const archived = h.archived_at ? h.archived_at.slice(0, 10) : null;
        return (!created || created <= date) && (!archived || archived > date);
      })
      .slice()
      .sort(byOrder);
  }

  const maxPointsForDay = (habits) => habits.reduce((s, h) => s + targetOf(h), 0);

  // Completions above a habit's own target earn nothing, so one easy habit
  // cannot be farmed to reach the daily threshold.
  function pointsForDay(counts, habits) {
    let s = 0;
    for (const h of habits) {
      const n = Math.max(0, (counts && counts[h.id]) || 0);
      s += Math.min(n, targetOf(h));
    }
    return s;
  }

  // ---------- goals ----------
  // kind "week": a one-off task. Worth the same as one habit completion, but
  // only on the day it is finished — an unfinished one must not raise the bar.
  // kind "quarter": a big goal that pays tickets outright.

  const openGoals = (goals, kind) =>
    goals.filter((g) => g.kind === kind && !g.archived_at && !g.done_at).slice().sort(byOrder);
  const doneGoals = (goals, kind) =>
    goals.filter((g) => g.kind === kind && !g.archived_at && g.done_at).slice().sort(byOrder);
  const goalsDoneOn = (goals, date) =>
    goals.filter((g) => g.kind === "week" && g.done_at && g.done_at.slice(0, 10) === date);
  const goalTickets = (g) => Math.max(1, g.tickets || 3);

  // ---------- the bar ----------

  // The target is dated: past days keep the bar that applied to them, so moving
  // it can never retroactively withdraw a ticket you already earned.
  function targetHistory(settings) {
    const h = (settings.target_history || []).slice().sort((a, b) => a.from.localeCompare(b.from));
    if (h.length) return h;
    return [{ from: "0000-01-01", target: settings.daily_points_target }];
  }

  function targetOn(settings, date) {
    const h = targetHistory(settings);
    let t = h[0].target;
    for (const e of h) if (e.from <= date) t = e.target;
    return Math.max(1, t);
  }

  // A day on which fewer points were even possible is judged against what was
  // possible then.
  function effectiveTarget(target, maxPoints) {
    if (maxPoints <= 0) return 0;
    return Math.max(1, Math.min(target, maxPoints));
  }

  function dayStats(day, habits, goals, settings) {
    const date = day.date;
    const act = habitsActiveOn(habits, date);
    const bonus = goalsDoneOn(goals, date).length;
    const max = maxPointsForDay(act) + bonus;
    const points = pointsForDay(day.counts, act) + bonus;
    const target = effectiveTarget(targetOn(settings, date), max);
    return { date, points, max, bonus, target, qualifies: target > 0 && points >= target };
  }

  const dayQualifies = (day, habits, goals, settings) => dayStats(day, habits, goals, settings).qualifies;

  // ---------- streaks ----------

  // Every date the app knows anything about, from either source.
  function activeDates(days, goals, today) {
    const s = new Set();
    for (const d of days) if (d.date <= today) s.add(d.date);
    for (const g of goals) {
      if (g.kind === "week" && g.done_at) {
        const d = g.done_at.slice(0, 10);
        if (d <= today) s.add(d);
      }
    }
    return Array.from(s).sort();
  }

  const indexDays = (days) => {
    const m = {};
    for (const d of days) m[d.date] = d;
    return m;
  };

  // Run lengths keyed by date: for every qualifying day, how many qualifying
  // days end there consecutively. Non-qualifying days are absent.
  function runLengths(days, habits, goals, settings, today) {
    const map = indexDays(days);
    const dates = activeDates(days, goals, today).filter((date) =>
      dayQualifies(map[date] || { date, counts: {} }, habits, goals, settings));
    const runs = {};
    let prev = null, run = 0;
    for (const date of dates) {
      run = prev !== null && daysBetween(prev, date) === 1 ? run + 1 : 1;
      runs[date] = run;
      prev = date;
    }
    return runs;
  }

  // The streak survives an unfinished today: it only breaks once yesterday is
  // over and unqualified.
  function currentStreak(days, habits, goals, settings, today) {
    const runs = runLengths(days, habits, goals, settings, today);
    return runs[today] || runs[shiftDate(today, -1)] || 0;
  }

  // ---------- tickets ----------

  const MANAGED = ["daily", "streak"];

  // The full set of day-derived tickets the history says should exist. One
  // daily and one streak ticket per date at most, so unchecking and rechecking
  // cannot mint a second. Goal tickets are not derived from days and are left
  // out of this entirely.
  function ticketsOwed(days, habits, goals, settings, today) {
    const streakLen = Math.max(2, settings.streak_length || 7);
    const runs = runLengths(days, habits, goals, settings, today);
    const owed = [];
    for (const date of Object.keys(runs).sort()) {
      owed.push({ date, reason: "daily" });
      if (runs[date] % streakLen === 0) owed.push({ date, reason: "streak" });
    }
    return owed;
  }

  const ticketKey = (t) => t.date + "|" + t.reason;

  // Spent tickets are never revoked: a reward already taken stays taken, and
  // its key keeps that date from paying out twice. Tickets from goals are not
  // day-derived, so they are ignored here rather than deleted as unowed.
  function reconcileTickets(existing, owed) {
    const managed = existing.filter((t) => MANAGED.indexOf(t.reason) !== -1);
    const have = new Set(managed.map(ticketKey));
    const want = new Set(owed.map(ticketKey));
    const toAdd = owed.filter((t) => !have.has(ticketKey(t)));
    const toDeleteIds = managed.filter((t) => !t.spent_at && !want.has(ticketKey(t))).map((t) => t.id);
    return { toAdd, toDeleteIds };
  }

  const unspentTickets = (tickets) => tickets.filter((t) => !t.spent_at);

  // ---------- the moving bar ----------

  const ADAPT = { window: 14, up: 12, down: 5, cooldown: 7 };

  // Hit it nearly every day and the bar goes up; miss it most of the time and
  // it comes down. Bounded, one step at a time, and never more often than the
  // cooldown, so a good or bad fortnight cannot run away with it.
  function adaptTarget(days, habits, goals, settings, today) {
    if (settings.adapt === false) return null;
    const dates = activeDates(days, goals, today);
    if (!dates.length || daysBetween(dates[0], today) < ADAPT.window) return null;

    const hist = targetHistory(settings);
    const last = hist[hist.length - 1].from;
    if (last !== "0000-01-01" && daysBetween(last, today) < ADAPT.cooldown) return null;

    const map = indexDays(days);
    let hit = 0;
    for (let i = 1; i <= ADAPT.window; i++) {
      const d = shiftDate(today, -i);
      if (dayQualifies(map[d] || { date: d, counts: {} }, habits, goals, settings)) hit++;
    }

    const cur = targetOn(settings, today);
    const ceiling = maxPointsForDay(activeHabits(habits));
    if (hit >= ADAPT.up && cur < ceiling) return { from: cur, to: cur + 1, hit, window: ADAPT.window, dir: "up" };
    if (hit <= ADAPT.down && cur > 1) return { from: cur, to: cur - 1, hit, window: ADAPT.window, dir: "down" };
    return null;
  }

  // Returns the settings object to save. Dated, so past days keep their bar.
  function applyTarget(settings, target, today) {
    const hist = (settings.target_history || []).filter((e) => e.from !== today);
    hist.push({ from: today, target });
    hist.sort((a, b) => a.from.localeCompare(b.from));
    return Object.assign({}, settings, { daily_points_target: target, target_history: hist });
  }

  // ---------- prizes ----------

  const activePrizes = (prizes) => prizes.filter((p) => !p.archived_at).slice().sort(byOrder);
  const totalWeight = (prizes) => prizes.reduce((s, p) => s + Math.max(0, p.weight), 0);

  function probabilityFor(prize, prizes) {
    const total = totalWeight(prizes);
    if (total <= 0) return 0;
    return (Math.max(0, prize.weight) / total) * 100;
  }

  function drawPrize(prizes, rand) {
    const r = (rand || Math.random)();
    const total = totalWeight(prizes);
    if (prizes.length === 0 || total <= 0) return null;
    let acc = 0;
    const x = r * total;
    for (let i = 0; i < prizes.length; i++) {
      acc += Math.max(0, prizes[i].weight);
      if (x < acc) return { prize: prizes[i], index: i };
    }
    return { prize: prizes[prizes.length - 1], index: prizes.length - 1 };
  }

  // ---------- wheel geometry ----------
  // Angles are degrees clockwise from the top, where the clapper sits.

  function segmentAngles(prizes) {
    const total = totalWeight(prizes);
    let cursor = 0;
    return prizes.map((p) => {
      const span = total <= 0 ? 0 : (Math.max(0, p.weight) / total) * 360;
      const seg = { start: cursor, end: cursor + span, mid: cursor + span / 2 };
      cursor += span;
      return seg;
    });
  }

  // Rotating the wheel by `rot` brings this local angle under the clapper.
  const angleUnderPointer = (rot) => (((360 - (rot % 360)) % 360) + 360) % 360;

  function segmentAt(angles, localAngle) {
    for (let i = 0; i < angles.length; i++) {
      if (localAngle >= angles[i].start && localAngle < angles[i].end) return i;
    }
    return angles.length - 1;
  }

  // Where the wheel must stop for `index` to win, and how far it has to creep
  // to get there from a near-stop just short of the segment.
  //
  // The clapper sweeps local angles downward as the wheel turns forward, so it
  // enters a segment across `end` and would leave across `start`. Resting
  // `depth` in from `end` means backing off `depth + gap` puts it outside the
  // segment entirely — which is the trick: the wheel can be brought to a near
  // halt one notch short and then creep across the divider.
  function landingPlan(index, angles, opts) {
    const o = opts || {};
    const rand = o.rand || Math.random;
    const turns = o.turns == null ? 6 + Math.floor(rand() * 3) : o.turns;
    const seg = angles[index];
    const span = seg.end - seg.start;
    const pad = Math.min(span * 0.2, 5);
    const frac = o.frac == null ? rand() : clamp(o.frac, 0, 1);
    // Rest shallow — within ~14 degrees of the leading edge — so the final
    // creep stays a crawl instead of becoming another roll. The odds are
    // untouched, only where inside the winning wedge it comes to rest.
    const maxDepth = Math.min(span - pad, Math.max(pad + 1, 14));
    const depth = pad + frac * Math.max(0, maxDepth - pad);
    const a = seg.end - depth;
    const gap = Math.min(6, Math.max(1.5, span * 0.12));
    return {
      rotation: turns * 360 + (((360 - (a % 360)) % 360) + 360) % 360,
      creep: depth + gap,
      angle: a,
    };
  }

  const landingRotation = (index, angles, opts) => landingPlan(index, angles, opts).rotation;

  // ---------- settings ----------

  function defaultSettings(habits, today) {
    const max = maxPointsForDay(activeHabits(habits));
    const target = Math.max(1, Math.ceil(max * 0.75));
    return {
      daily_points_target: target,
      target_history: [{ from: today || todayStr(), target }],
      streak_length: 7,
      adapt: true,
    };
  }

  const api = {
    dayNum, daysBetween, shiftDate, todayStr, prettyDate, quarterOf, clamp,
    activeHabits, habitsActiveOn, targetOf, maxPointsForDay, pointsForDay,
    openGoals, doneGoals, goalsDoneOn, goalTickets,
    targetHistory, targetOn, effectiveTarget, dayStats, dayQualifies,
    activeDates, runLengths, currentStreak,
    ticketsOwed, ticketKey, reconcileTickets, unspentTickets, MANAGED,
    ADAPT, adaptTarget, applyTarget,
    activePrizes, totalWeight, probabilityFor, drawPrize,
    segmentAngles, angleUnderPointer, segmentAt, landingPlan, landingRotation,
    defaultSettings,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Gold = api;
})(typeof window !== "undefined" ? window : globalThis);
