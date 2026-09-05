// Gold pure logic — shared by the browser (window.Gold) and node tests.
// Every rule of the economy lives here: points, qualifying days, streaks,
// ticket reconciliation, weighted draw, wheel geometry. No DOM, no IndexedDB.
(function (global) {
  "use strict";

  const DAY_MS = 86400000;
  // dates are "YYYY-MM-DD" strings; parse as UTC so DST never shifts a day
  const dayNum = (d) => Math.round(Date.parse(d + "T00:00:00Z") / DAY_MS);
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  const shiftDate = (date, days) => new Date((dayNum(date) + days) * DAY_MS).toISOString().slice(0, 10);

  // local calendar day — never toISOString(), which would shift across UTC
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const prettyDate = (date) =>
    new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  // ---------- habits & points ----------

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

  // The threshold is an absolute number of points, but a day on which fewer
  // points were even possible is judged against what was possible then.
  function effectiveTarget(target, maxPoints) {
    if (maxPoints <= 0) return 0;
    return Math.max(1, Math.min(target, maxPoints));
  }

  function dayQualifies(day, habits, target) {
    const act = habitsActiveOn(habits, day.date);
    const max = maxPointsForDay(act);
    const eff = effectiveTarget(target, max);
    if (eff === 0) return false;
    return pointsForDay(day.counts, act) >= eff;
  }

  // ---------- streaks ----------

  // Run lengths keyed by date: for every qualifying day, how many qualifying
  // days end there consecutively. Non-qualifying days are absent.
  function runLengths(days, habits, target) {
    const qualifying = days
      .filter((d) => dayQualifies(d, habits, target))
      .map((d) => d.date)
      .sort();
    const runs = {};
    let prev = null;
    let run = 0;
    for (const date of qualifying) {
      run = prev !== null && daysBetween(prev, date) === 1 ? run + 1 : 1;
      runs[date] = run;
      prev = date;
    }
    return runs;
  }

  // The streak survives an unfinished today: it only breaks once yesterday is
  // over and unqualified.
  function currentStreak(days, habits, target, today) {
    const runs = runLengths(days, habits, target);
    if (runs[today]) return runs[today];
    const y = shiftDate(today, -1);
    return runs[y] || 0;
  }

  // ---------- tickets ----------

  // The full set of tickets the history says should exist. Compared against
  // what does exist; the diff is applied. One daily and one streak ticket per
  // date at most, so unchecking and rechecking cannot mint a second.
  function ticketsOwed(days, habits, settings, today) {
    const target = settings.daily_points_target;
    const streakLen = Math.max(2, settings.streak_length || 7);
    const past = days.filter((d) => d.date <= today);
    const runs = runLengths(past, habits, target);
    const owed = [];
    for (const date of Object.keys(runs).sort()) {
      owed.push({ date, reason: "daily" });
      if (runs[date] % streakLen === 0) owed.push({ date, reason: "streak" });
    }
    return owed;
  }

  const ticketKey = (t) => t.date + "|" + t.reason;

  // Spent tickets are never revoked: a reward already taken stays taken, and
  // its key keeps that date from paying out twice.
  function reconcileTickets(existing, owed) {
    const have = new Set(existing.map(ticketKey));
    const want = new Set(owed.map(ticketKey));
    const toAdd = owed.filter((t) => !have.has(ticketKey(t)));
    const toDeleteIds = existing
      .filter((t) => !t.spent_at && !want.has(ticketKey(t)))
      .map((t) => t.id);
    return { toAdd, toDeleteIds };
  }

  const unspentTickets = (tickets) => tickets.filter((t) => !t.spent_at);

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
  // Angles are degrees clockwise from the top (where the pointer sits).

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

  // Rotating the wheel by `rot` brings this local angle under the pointer.
  const angleUnderPointer = (rot) => ((360 - (rot % 360)) % 360 + 360) % 360;

  function segmentAt(angles, localAngle) {
    for (let i = 0; i < angles.length; i++) {
      if (localAngle >= angles[i].start && localAngle < angles[i].end) return i;
    }
    return angles.length - 1;
  }

  // Where the wheel must stop for `index` to win, and how far it has to creep
  // to get there from a near-stop just short of the segment.
  //
  // The pointer sweeps local angles downward as the wheel turns forward, so it
  // enters a segment across `end` and would leave across `start`. Resting
  // `depth` in from `end` means backing off `depth + gap` puts the pointer
  // outside the segment entirely — which is the whole trick: the wheel can be
  // brought to a near halt one notch short and then creep across the divider.
  function landingPlan(index, angles, opts) {
    const o = opts || {};
    const rand = o.rand || Math.random;
    const turns = o.turns == null ? 6 + Math.floor(rand() * 3) : o.turns;
    const seg = angles[index];
    const span = seg.end - seg.start;
    const pad = Math.min(span * 0.2, 5);
    const frac = o.frac == null ? rand() : Math.min(1, Math.max(0, o.frac));
    // Rest shallow — within ~14 degrees of the leading edge — so the final
    // creep stays a crawl instead of becoming another roll. It does mean the
    // pointer always settles just past a divider; the odds are untouched, only
    // where inside the winning wedge it comes to rest.
    const maxDepth = Math.min(span - pad, Math.max(pad + 1, 14));
    const depth = pad + frac * Math.max(0, maxDepth - pad);
    const a = seg.end - depth;
    const gap = Math.min(6, Math.max(1.5, span * 0.12));
    return {
      rotation: turns * 360 + ((360 - (a % 360) + 360) % 360),
      creep: depth + gap,
      angle: a,
    };
  }

  const landingRotation = (index, angles, opts) => landingPlan(index, angles, opts).rotation;

  // ---------- settings ----------

  function defaultSettings(habits) {
    const max = maxPointsForDay(activeHabits(habits));
    return {
      daily_points_target: Math.max(1, Math.ceil(max * 0.75)),
      streak_length: 7,
    };
  }

  const api = {
    dayNum, daysBetween, shiftDate, todayStr, prettyDate,
    activeHabits, habitsActiveOn, targetOf, maxPointsForDay, pointsForDay,
    effectiveTarget, dayQualifies, runLengths, currentStreak,
    ticketsOwed, ticketKey, reconcileTickets, unspentTickets,
    activePrizes, totalWeight, probabilityFor, drawPrize,
    segmentAngles, angleUnderPointer, segmentAt, landingPlan, landingRotation,
    defaultSettings,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Gold = api;
})(typeof window !== "undefined" ? window : globalThis);
