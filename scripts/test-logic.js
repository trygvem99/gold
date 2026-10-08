// node scripts/test-logic.js — pure-function tests for logic.js
"use strict";
const assert = require("assert");
const G = require("../logic.js");

const habit = (id, target, created, archived) => ({
  id, name: id, emoji: "•", target, order: 0,
  created_at: (created || "2026-01-01") + "T08:00:00Z",
  archived_at: archived ? archived + "T08:00:00Z" : null,
});
const day = (date, counts) => ({ date, counts });
const weekGoal = (id, doneDate) => ({
  id, kind: "week", name: id, order: 0,
  created_at: "2026-01-01T08:00:00Z", archived_at: null,
  done_at: doneDate ? doneDate + "T18:00:00Z" : null,
});
const quarterGoal = (id, tickets, doneDate) => ({
  id, kind: "quarter", name: id, tickets, order: 0,
  created_at: "2026-01-01T08:00:00Z", archived_at: null,
  done_at: doneDate ? doneDate + "T18:00:00Z" : null,
});
const cfg = (target, extra) => Object.assign({
  daily_points_target: target, streak_length: 7, adapt: true,
  target_history: [{ from: "0000-01-01", target }],
}, extra);

// ---------- dates ----------
assert.strictEqual(G.daysBetween("2026-09-01", "2026-09-08"), 7);
assert.strictEqual(G.shiftDate("2026-03-29", 1), "2026-03-30", "DST does not roll the day");
assert.strictEqual(G.shiftDate("2026-01-01", -1), "2025-12-31");
assert.strictEqual(G.quarterOf("2026-09-05"), "2026-Q3");
assert.strictEqual(G.quarterOf("2026-01-31"), "2026-Q1");
assert.strictEqual(G.quarterOf("2026-12-31"), "2026-Q4");

// ---------- points ----------
const three = [habit("med", 2), habit("gym", 1), habit("read", 1)];
assert.strictEqual(G.maxPointsForDay(three), 4);
assert.strictEqual(G.pointsForDay({ med: 2, gym: 1 }, three), 3);
assert.strictEqual(G.pointsForDay({ med: 9 }, three), 2, "overshoot is capped at the habit target");
assert.strictEqual(G.pointsForDay(undefined, three), 0);

// ---------- habits active on a date ----------
const windowed = [habit("old", 1, "2026-01-01"), habit("new", 1, "2026-09-05")];
assert.strictEqual(G.habitsActiveOn(windowed, "2026-09-01").length, 1, "a habit added later did not exist in the past");
assert.strictEqual(G.habitsActiveOn(windowed, "2026-09-05").length, 2);
const archived = [habit("gone", 1, "2026-01-01", "2026-09-03")];
assert.strictEqual(G.habitsActiveOn(archived, "2026-09-02").length, 1);
assert.strictEqual(G.habitsActiveOn(archived, "2026-09-03").length, 0);

// ---------- the dated bar ----------
const dated = cfg(4, { target_history: [{ from: "2026-08-01", target: 3 }, { from: "2026-09-04", target: 5 }] });
assert.strictEqual(G.targetOn(dated, "2026-08-15"), 3, "a past day keeps the bar it was judged against");
assert.strictEqual(G.targetOn(dated, "2026-09-04"), 5);
assert.strictEqual(G.targetOn(dated, "2026-09-30"), 5);
assert.strictEqual(G.effectiveTarget(3, 4), 3);
assert.strictEqual(G.effectiveTarget(9, 4), 4, "cannot need more points than were possible");
assert.strictEqual(G.effectiveTarget(3, 0), 0, "a day with nothing possible is never a qualifying day");

// ---------- one-off goals count on the day they are finished ----------
const s3 = cfg(3);
let st = G.dayStats(day("2026-09-01", { med: 2 }), three, [], s3);
assert.deepStrictEqual([st.points, st.max, st.qualifies], [2, 4, false]);
st = G.dayStats(day("2026-09-01", { med: 2 }), three, [weekGoal("g1", "2026-09-01")], s3);
assert.deepStrictEqual([st.points, st.max, st.bonus, st.qualifies], [3, 5, 1, true],
  "finishing a one-off is worth one point, and lifts that day's ceiling with it");
st = G.dayStats(day("2026-09-01", { med: 2 }), three, [weekGoal("g1", null)], s3);
assert.strictEqual(st.max, 4, "an unfinished one-off must not raise the bar");
st = G.dayStats(day("2026-09-02", {}), three, [weekGoal("g1", "2026-09-02")], cfg(1));
assert.strictEqual(st.qualifies, true, "a day carried entirely by a one-off still counts");

// A day before any habit existed must not qualify, or the streak would run
// backwards forever.
assert.strictEqual(G.dayQualifies(day("2025-06-01", {}), three, [], s3), false);

// ---------- streaks ----------
const full = { med: 2, gym: 1, read: 1 };
const run = [
  day("2026-09-01", full), day("2026-09-02", full), day("2026-09-03", full),
  day("2026-09-04", { med: 1 }),
  day("2026-09-05", full), day("2026-09-06", full),
];
const runs = G.runLengths(run, three, [], s3, "2026-09-06");
assert.deepStrictEqual(runs, { "2026-09-01": 1, "2026-09-02": 2, "2026-09-03": 3, "2026-09-05": 1, "2026-09-06": 2 });
assert.strictEqual(G.currentStreak(run, three, [], s3, "2026-09-06"), 2);
assert.strictEqual(G.currentStreak(run, three, [], s3, "2026-09-07"), 2, "an unfinished today does not break the streak");
assert.strictEqual(G.currentStreak(run, three, [], s3, "2026-09-08"), 0, "a missed yesterday does");
// a one-off finished on a day that fell one point short repairs the streak
const nearMiss = run.map((d) => (d.date === "2026-09-04" ? day(d.date, { med: 2 }) : d));
assert.strictEqual(G.runLengths(nearMiss, three, [], s3, "2026-09-06")["2026-09-06"], 2);
const repaired = G.runLengths(nearMiss, three, [weekGoal("g", "2026-09-04")], s3, "2026-09-06");
assert.strictEqual(repaired["2026-09-06"], 6, "the one-off carried that day over the line");

// ---------- tickets ----------
const s3w3 = cfg(3, { streak_length: 3 });
const owed = G.ticketsOwed(run, three, [], s3w3, "2026-09-06");
assert.strictEqual(owed.filter((t) => t.reason === "daily").length, 5);
assert.deepStrictEqual(owed.filter((t) => t.reason === "streak"), [{ date: "2026-09-03", reason: "streak" }]);
assert.strictEqual(G.ticketsOwed(run, three, [], s3w3, "2026-09-02").length, 2, "future days are not paid out early");

let existing = owed.map((t, i) => ({ id: "t" + i, date: t.date, reason: t.reason, spent_at: null }));
let rec = G.reconcileTickets(existing, owed);
assert.deepStrictEqual(rec, { toAdd: [], toDeleteIds: [] }, "reconciling twice mints nothing");

const dropped = owed.filter((t) => t.date !== "2026-09-06");
rec = G.reconcileTickets(existing, dropped, "2026-09-06");
assert.strictEqual(rec.toDeleteIds.length, 1, "unchecking a day withdraws its unspent ticket");

// changing a setting re-judges history, but must never take back a ticket
assert.deepStrictEqual(G.reconcileTickets(existing, dropped).toDeleteIds, [],
  "with no edited day, nothing is withdrawn");
// unchecking one day may only touch that day and what follows it
const earlyDrop = owed.filter((t) => t.date !== "2026-09-02");
assert.deepStrictEqual(G.reconcileTickets(existing, earlyDrop, "2026-09-05").toDeleteIds, [],
  "editing a later day cannot withdraw an earlier day's ticket");
assert.strictEqual(G.reconcileTickets(existing, earlyDrop, "2026-09-02").toDeleteIds.length, 1);

existing = existing.map((t) => (t.date === "2026-09-06" ? Object.assign({}, t, { spent_at: "now" }) : t));
assert.deepStrictEqual(G.reconcileTickets(existing, dropped, "2026-09-06").toDeleteIds, [], "a spent ticket is never clawed back");
assert.deepStrictEqual(G.reconcileTickets(existing, owed).toAdd, [], "re-qualifying does not mint a second ticket");

// goal tickets are not day-derived and must survive reconciliation untouched
const withGoal = existing.concat([{ id: "gt", date: "2026-09-06", reason: "goal", source: "q1", spent_at: null }]);
rec = G.reconcileTickets(withGoal, dropped, "2026-09-01");
assert.strictEqual(rec.toDeleteIds.indexOf("gt"), -1, "a quarterly goal's tickets are not swept up by reconciliation");
assert.strictEqual(G.unspentTickets(withGoal).length, withGoal.length - 1);

assert.strictEqual(G.goalTickets(quarterGoal("q", 3)), 3);
assert.strictEqual(G.goalTickets({ kind: "quarter" }), 3, "quarterly goals default to three tickets");
assert.strictEqual(G.openGoals([weekGoal("a"), weekGoal("b", "2026-09-01")], "week").length, 1);
assert.strictEqual(G.doneGoals([weekGoal("a"), weekGoal("b", "2026-09-01")], "week").length, 1);

// ---------- the moving bar ----------
const mkDays = (n, from, ok) => Array.from({ length: n }, (_, i) =>
  day(G.shiftDate(from, i), ok(i) ? full : { med: 1 }));

// 14 of the last 14 hit -> up
let hist = mkDays(20, "2026-08-17", () => true);
let up = G.adaptTarget(hist, three, [], cfg(3), "2026-09-06");
assert.deepStrictEqual([up.dir, up.from, up.to, up.hit], ["up", 3, 4, 14]);

// mostly missed -> down
hist = mkDays(20, "2026-08-17", (i) => i % 5 === 0);
let down = G.adaptTarget(hist, three, [], cfg(3), "2026-09-06");
assert.strictEqual(down.dir, "down");
assert.strictEqual(down.to, 2);

// middling -> no change
hist = mkDays(20, "2026-08-17", (i) => i % 2 === 0);
assert.strictEqual(G.adaptTarget(hist, three, [], cfg(3), "2026-09-06"), null);

// bounded by what is possible, and by one
hist = mkDays(20, "2026-08-17", () => true);
assert.strictEqual(G.adaptTarget(hist, three, [], cfg(4), "2026-09-06"), null, "cannot demand more than the day holds");
const allEmpty = Array.from({ length: 20 }, (_, i) => day(G.shiftDate("2026-08-17", i), {}));
assert.strictEqual(G.adaptTarget(allEmpty, three, [], cfg(1), "2026-09-06"), null, "cannot drop below one point");

// cooldown and warm-up
const recent = cfg(3, { target_history: [{ from: "2026-09-02", target: 3 }] });
assert.strictEqual(G.adaptTarget(mkDays(20, "2026-08-17", () => true), three, [], recent, "2026-09-06"), null,
  "no second move inside the cooldown");
assert.strictEqual(G.adaptTarget(mkDays(5, "2026-09-02", () => true), three, [], cfg(3), "2026-09-06"), null,
  "no move before there is a fortnight to judge");
assert.strictEqual(G.adaptTarget([], three, [], cfg(3), "2026-09-06"), null);
assert.strictEqual(G.adaptTarget(mkDays(20, "2026-08-17", () => true), three, [], cfg(3, { adapt: false }), "2026-09-06"),
  null, "switched off means switched off");

// applying it is dated, so yesterday keeps yesterday's bar
const moved = G.applyTarget(cfg(3), 4, "2026-09-06");
assert.strictEqual(moved.daily_points_target, 4);
assert.strictEqual(G.targetOn(moved, "2026-09-05"), 3);
assert.strictEqual(G.targetOn(moved, "2026-09-06"), 4);
const movedTwice = G.applyTarget(moved, 5, "2026-09-06");
assert.strictEqual(movedTwice.target_history.filter((e) => e.from === "2026-09-06").length, 1,
  "two moves on the same day leave one entry");

// the whole point: moving the bar up must not withdraw yesterday's ticket
const before = G.ticketsOwed(run, three, [], s3, "2026-09-06");
const after = G.ticketsOwed(run, three, [], G.applyTarget(s3, 4, "2026-09-06"), "2026-09-06");
assert.deepStrictEqual(after.filter((t) => t.date < "2026-09-06"), before.filter((t) => t.date < "2026-09-06"));

// ---------- prizes ----------
const prizes = [
  { id: "a", name: "A", color: "#111", weight: 1 },
  { id: "b", name: "B", color: "#222", weight: 3 },
  { id: "c", name: "C", color: "#333", weight: 6 },
];
assert.strictEqual(G.totalWeight(prizes), 10);
assert.strictEqual(G.probabilityFor(prizes[1], prizes), 30);
assert.strictEqual(G.drawPrize([]), null);
assert.strictEqual(G.drawPrize([{ id: "z", weight: 0 }]), null);
assert.strictEqual(G.drawPrize(prizes, () => 0).index, 0);
assert.strictEqual(G.drawPrize(prizes, () => 0.0999).index, 0);
assert.strictEqual(G.drawPrize(prizes, () => 0.1001).index, 1);
assert.strictEqual(G.drawPrize(prizes, () => 0.9999).index, 2);

// a blank is drawn exactly like any other wedge
const withBlank = prizes.concat([{ id: "n", name: "No luck", blank: true, weight: 10 }]);
assert.strictEqual(G.probabilityFor(withBlank[3], withBlank), 50);

const N = 100000;
const hits = [0, 0, 0];
for (let i = 0; i < N; i++) hits[G.drawPrize(prizes).index]++;
[0.1, 0.3, 0.6].forEach((expected, i) => {
  const got = hits[i] / N;
  assert.ok(Math.abs(got - expected) < 0.01, `prize ${i}: ${got.toFixed(3)} vs ${expected}`);
});

// a small seeded generator, so the randomised rules can be checked exactly
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- rarity ----------
// the pool as it stands on the phone: 6, 10, 24, 28, 16 and a 16 % blank
const pool = [
  { id: "night", weight: 3 }, { id: "dinner", weight: 5 }, { id: "cheat", weight: 12 },
  { id: "bakery", weight: 14 }, { id: "cinema", weight: 8 }, { id: "none", weight: 8, blank: true },
];
assert.deepStrictEqual(pool.map((p) => G.rarityOf(p, pool)),
  ["legendary", "epic", "common", "common", "rare", "blank"]);
assert.strictEqual(G.rarityOf(Object.assign({}, pool[2], { rarity: "epic" }), pool), "epic", "a hand-set tier wins");
assert.strictEqual(G.rarityOf(Object.assign({}, pool[2], { rarity: "auto" }), pool), "common", "anything else means auto");
assert.strictEqual(G.rarityOf(Object.assign({}, pool[5], { rarity: "legendary" }), pool), "blank", "a blank is always a blank");
assert.ok(G.tierRank("legendary") > G.tierRank("epic") && G.tierRank("common") > G.tierRank("blank"));

// ---------- the charge never over-promises ----------
const rnd1 = seeded(7);
const lateCount = {}, tellRuns = 3000;
for (const tier of ["blank", "common", "rare", "epic", "legendary"]) {
  lateCount[tier] = 0;
  for (let i = 0; i < tellRuns; i++) {
    const c = G.chargeTell(tier, rnd1);
    assert.ok(c.steps.length >= 1);
    for (let k = 1; k < c.steps.length; k++) assert.ok(G.tierRank(c.steps[k]) > G.tierRank(c.steps[k - 1]), "it only climbs");
    const last = c.steps[c.steps.length - 1];
    if (tier === "blank" || tier === "common") {
      assert.deepStrictEqual(c.steps, ["common"], "the baseline is silver");
      assert.strictEqual(c.late, false);
      continue;
    }
    for (const st of c.steps) assert.ok(G.tierRank(st) <= G.tierRank(tier), tier + " showed " + st);
    if (c.late) { lateCount[tier]++; assert.strictEqual(G.tierRank(last), G.tierRank(tier) - 1, "a late bloom stops exactly one short"); }
    else assert.strictEqual(last, tier, "otherwise the last step is the truth");
  }
}
for (const tier of ["rare", "epic", "legendary"]) {
  assert.ok(Math.abs(lateCount[tier] / tellRuns - G.LATE_BLOOM) < 0.04, tier + " late bloom rate " + (lateCount[tier] / tellRuns).toFixed(3));
}

// ---------- the strip ----------
const rnd2 = seeded(11);
const tierOf = (i) => G.rarityOf(pool[i], pool);
for (let winner = 0; winner < pool.length; winner++) {
  for (let k = 0; k < 400; k++) {
    const strip = G.buildStrip(pool, winner, rnd2);
    const cards = strip.cards, win = strip.win;
    assert.strictEqual(cards.length, G.STRIP.length);
    assert.strictEqual(win, G.STRIP.win);
    assert.strictEqual(cards[win], winner, "the winner sits under the line");
    const next = cards[win + 1];
    assert.notStrictEqual(next, winner);
    const bestOther = Math.max(...pool.map((p, i) => (i === winner ? -9 : G.tierRank(tierOf(i)))));
    assert.strictEqual(G.tierRank(tierOf(next)), bestOther, "one card short of the best prize it did not land on");
    const early = cards.slice(6, 30).filter((c) => G.tierRank(tierOf(c)) >= 2).length;
    assert.ok(early >= 2, "high-tier cards fly past early");
  }
}
// the near miss for a non-legendary win is the legendary
assert.strictEqual(G.buildStrip(pool, 2, seeded(3)).cards[G.STRIP.win + 1], 0);
// reproducible from a seed
assert.deepStrictEqual(G.buildStrip(pool, 1, seeded(5)), G.buildStrip(pool, 1, seeded(5)));
// a prize that cannot be won never appears
const withDead = pool.concat([{ id: "dead", weight: 0 }]);
for (let k = 0; k < 200; k++) {
  assert.ok(G.buildStrip(withDead, 2, rnd2).cards.indexOf(6) === -1, "zero-weight prizes stay off the reel");
}

const one = [{ id: "only", weight: 5 }];
assert.strictEqual(G.drawPrize(one).index, 0);
assert.deepStrictEqual(G.buildStrip(one, 0, seeded(1)).cards.filter((c) => c !== 0), [], "a pool of one still builds");

// ---------- schedules and rest days ----------
// 2026-09-07 is a Monday
assert.strictEqual(G.weekdayOf("2026-09-07"), 1);
assert.strictEqual(G.weekdayOf("2026-09-13"), 0);
const weekdays = [1, 2, 3, 4, 5];
const wk = Object.assign(habit("wk", 1), { days: weekdays });
assert.strictEqual(G.scheduledOn(wk, "2026-09-07"), true);
assert.strictEqual(G.scheduledOn(wk, "2026-09-12"), false, "Saturday is off for a weekday habit");
assert.strictEqual(G.scheduledOn(habit("d", 1), "2026-09-12"), true, "no days list means every day");
assert.strictEqual(G.habitsActiveOn([wk], "2026-09-12").length, 0);
assert.strictEqual(G.isRestDay([wk], [], "2026-09-12"), true);
assert.strictEqual(G.isRestDay([wk], [weekGoal("g", "2026-09-12")], "2026-09-12"), false,
  "a one-off done on a rest day makes it a real day");

// a weekday routine done every weekday: the weekend must not break the streak
const workweek = [];
for (let d = "2026-09-07"; d <= "2026-09-18"; d = G.shiftDate(d, 1)) {
  if (G.scheduledOn(wk, d)) workweek.push(day(d, { wk: 1 }));
}
const s1 = cfg(1);
const wkRuns = G.runLengths(workweek, [wk], [], s1, "2026-09-18");
assert.strictEqual(wkRuns["2026-09-14"], 6, "Monday continues Friday's run across the weekend");
assert.strictEqual(wkRuns["2026-09-18"], 10);
assert.strictEqual(G.currentStreak(workweek, [wk], [], s1, "2026-09-20"), 10,
  "on Sunday the streak still stands: the weekend asked nothing");
assert.strictEqual(G.currentStreak(workweek, [wk], [], s1, "2026-09-22"), 0,
  "missing Monday breaks it once Monday is over");
assert.strictEqual(G.bestStreak(workweek, [wk], [], s1, "2026-09-18"), 10);
// the streak bonus counts through the weekend too
const wkOwed = G.ticketsOwed(workweek, [wk], [], cfg(1, { streak_length: 7 }), "2026-09-18");
assert.deepStrictEqual(wkOwed.filter((t) => t.reason === "streak").map((t) => t.date), ["2026-09-15"]);

// the moving bar judges only days that asked something
const wkHist = [];
for (let d = "2026-08-17"; d <= "2026-09-05"; d = G.shiftDate(d, 1)) {
  if (G.scheduledOn(wk, d)) wkHist.push(day(d, { wk: 1 }));
}
const two = [Object.assign(habit("wk", 1), { days: weekdays }), Object.assign(habit("wk2", 1), { days: weekdays })];
const twoHist = wkHist.map((d) => day(d.date, { wk: 1, wk2: 1 }));
const wkUp = G.adaptTarget(twoHist, two, [], cfg(1), "2026-09-06");
assert.strictEqual(wkUp && wkUp.dir, "up", "a perfect weekday record raises the bar despite empty weekends");
assert.strictEqual(wkUp.window, 10, "ten weekdays in the last fourteen days");

// ---------- per-habit stats ----------
const med = habit("med", 2, "2026-09-01");
const medDays = [
  day("2026-09-01", { med: 2 }), day("2026-09-02", { med: 2 }), day("2026-09-03", { med: 1 }),
  day("2026-09-04", { med: 2 }), day("2026-09-05", { med: 2 }), day("2026-09-06", { med: 2 }),
];
let hs = G.habitStats(med, medDays, "2026-09-06");
assert.strictEqual(hs.current, 3);
assert.strictEqual(hs.best, 3);
assert.strictEqual(hs.total, 5, "a half-done day is not a done day");
assert.strictEqual(hs.completions, 11);
assert.ok(Math.abs(hs.rate - 5 / 6) < 1e-9);
assert.ok(hs.strength > 0 && hs.strength < 1);
// an unfinished today counts against nothing
hs = G.habitStats(med, medDays, "2026-09-07");
assert.strictEqual(hs.current, 3, "today not done yet: streak still shows yesterday's");
assert.ok(Math.abs(hs.rate - 5 / 6) < 1e-9);
// strength forgives a miss, the streak does not
const strong = G.habitStats(med, medDays.concat([day("2026-09-07", {})]), "2026-09-08");
assert.strictEqual(strong.current, 0);
assert.ok(strong.strength > hs.strength * 0.9, "one missed day dents strength, it does not reset it");
// a weekday habit is not marked down for weekends
const wkStats = G.habitStats(Object.assign(habit("wk", 1, "2026-09-07"), { days: weekdays }), workweek, "2026-09-20");
assert.strictEqual(wkStats.current, 10);
assert.strictEqual(wkStats.rate, 1);

const grid = G.habitGrid(Object.assign(habit("wk", 1, "2026-09-07"), { days: weekdays }), workweek, "2026-09-11", "2026-09-14");
assert.deepStrictEqual(grid.map((c) => c.value), [1, null, null, 1], "weekends are empty cells, not misses");
assert.deepStrictEqual(G.habitGrid(med, medDays, "2026-09-03", "2026-09-03").map((c) => c.value), [0.5]);

// ---------- milestones ----------
const ms = G.milestones({ best: 8, reps: 120, spins: 0, quarters: 1 });
const byId = (id) => ms.find((m) => m.id === id);
assert.strictEqual(byId("streak-7").earned, true);
assert.strictEqual(byId("streak-14").earned, false);
assert.ok(Math.abs(byId("streak-14").progress - 8 / 14) < 1e-9);
assert.strictEqual(byId("reps-100").earned, true);
assert.strictEqual(byId("spin-1").earned, false);
assert.strictEqual(byId("quarter-1").earned, true);

// ---------- time of day ----------
assert.strictEqual(G.slotOf({}), "any");
assert.strictEqual(G.slotOf({ time: "evening" }), "evening");
assert.strictEqual(G.slotOf({ time: "nonsense" }), "any");
assert.strictEqual(G.slotForHour(7), "morning");
assert.strictEqual(G.slotForHour(13), "afternoon");
assert.strictEqual(G.slotForHour(21), "evening");

// ---------- icon suggestions ----------
assert.strictEqual(G.suggestIcons("Run a half marathon")[0], "🏃");
assert.strictEqual(G.suggestIcons("Read 30 min")[0], "📖");
assert.strictEqual(G.suggestIcons("Book the dentist")[0], "🦷");
assert.strictEqual(G.suggestIcons("Lights out by 23:00")[0], "🌙");
assert.strictEqual(G.suggestIcons("Ingen sukker")[0], "🚫", "Norwegian too");
// common words must never be keywords, or every name matches something wrong
assert.ok(G.suggestIcons("Dinner out").indexOf("🌙") === -1, "'out' must not reach the bedtime icon");
assert.strictEqual(G.suggestIcons("Dinner out")[0], "🍽️");
assert.ok(G.suggestIcons("Book the dentist").indexOf("🐕") === -1, "'the' must not reach the dog icon");
assert.ok(G.suggestIcons("Walk the dog").indexOf("🐕") !== -1);
assert.strictEqual(G.suggestIcons("Cheat meal")[0], "🎯", "no keyword, so a neutral default");
assert.strictEqual(G.suggestIcons("Sykle til jobb")[0], "🚴");
assert.strictEqual(G.suggestIcons("")[0], "🎯", "an unnamed thing still gets something usable");
assert.strictEqual(G.suggestIcons("qwertyuiop")[0], "🎯");
assert.strictEqual(G.suggestIcons("Run", 4).length, 4);
assert.strictEqual(new Set(G.suggestIcons("Walk the dog")).size, 6, "no duplicates");
// a longer keyword match beats a shorter one inside the same name
assert.strictEqual(G.suggestIcons("marathon")[0], "🏃");

// ---------- defaults ----------
const def = G.defaultSettings(three, "2026-09-06");
assert.strictEqual(def.daily_points_target, 3);
assert.strictEqual(def.streak_length, 7);
assert.strictEqual(def.adapt, true);
assert.deepStrictEqual(def.target_history, [{ from: "2026-09-06", target: 3 }]);
assert.strictEqual(G.defaultSettings([], "2026-09-06").daily_points_target, 1);

console.log("all logic tests passed");
