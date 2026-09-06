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
rec = G.reconcileTickets(existing, dropped);
assert.strictEqual(rec.toDeleteIds.length, 1, "unchecking a day withdraws its unspent ticket");

existing = existing.map((t) => (t.date === "2026-09-06" ? Object.assign({}, t, { spent_at: "now" }) : t));
assert.deepStrictEqual(G.reconcileTickets(existing, dropped).toDeleteIds, [], "a spent ticket is never clawed back");
assert.deepStrictEqual(G.reconcileTickets(existing, owed).toAdd, [], "re-qualifying does not mint a second ticket");

// goal tickets are not day-derived and must survive reconciliation untouched
const withGoal = existing.concat([{ id: "gt", date: "2026-09-06", reason: "goal", source: "q1", spent_at: null }]);
rec = G.reconcileTickets(withGoal, dropped);
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

// ---------- wheel geometry ----------
const angles = G.segmentAngles(prizes);
assert.ok(Math.abs(angles[angles.length - 1].end - 360) < 1e-9, "segments fill the circle");
assert.ok(Math.abs(angles[0].end - 36) < 1e-9);
assert.strictEqual(G.segmentAt(angles, 0), 0);
assert.strictEqual(G.segmentAt(angles, 100), 1);
assert.strictEqual(G.segmentAt(angles, 359.9), 2);

for (let i = 0; i < prizes.length; i++) {
  for (let k = 0; k < 400; k++) {
    const rotation = G.landingRotation(i, angles);
    const under = G.angleUnderPointer(rotation);
    assert.ok(under >= angles[i].start && under < angles[i].end,
      `index ${i}: clapper at ${under.toFixed(2)} outside [${angles[i].start}, ${angles[i].end})`);
    assert.ok(rotation >= 5 * 360, "the wheel always makes at least five turns");
  }
}

// The near-stop must sit OUTSIDE the winning segment, or the final creep does
// not cross a divider and the whole beat is a lie.
for (let i = 0; i < prizes.length; i++) {
  for (let k = 0; k < 300; k++) {
    const plan = G.landingPlan(i, angles);
    assert.ok(plan.creep > 0 && plan.creep <= 21, `creep must stay a crawl, got ${plan.creep.toFixed(1)}`);
    assert.strictEqual(G.segmentAt(angles, G.angleUnderPointer(plan.rotation)), i, "rests on the winner");
    assert.notStrictEqual(G.segmentAt(angles, G.angleUnderPointer(plan.rotation - plan.creep)), i,
      "near-stop is one notch short");
  }
}
const shallow = G.landingPlan(2, angles, { frac: 0, turns: 6 });
const deep = G.landingPlan(2, angles, { frac: 1, turns: 6 });
assert.ok(shallow.creep < deep.creep);
assert.ok(G.angleUnderPointer(shallow.rotation) > G.angleUnderPointer(deep.rotation));

const one = [{ id: "only", weight: 5 }];
assert.strictEqual(G.drawPrize(one).index, 0);
assert.strictEqual(G.segmentAngles(one)[0].end, 360);

// ---------- defaults ----------
const def = G.defaultSettings(three, "2026-09-06");
assert.strictEqual(def.daily_points_target, 3);
assert.strictEqual(def.streak_length, 7);
assert.strictEqual(def.adapt, true);
assert.deepStrictEqual(def.target_history, [{ from: "2026-09-06", target: 3 }]);
assert.strictEqual(G.defaultSettings([], "2026-09-06").daily_points_target, 1);

console.log("all logic tests passed");
