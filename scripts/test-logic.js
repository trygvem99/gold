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

// ---------- dates ----------
assert.strictEqual(G.daysBetween("2026-09-01", "2026-09-08"), 7);
assert.strictEqual(G.shiftDate("2026-03-29", 1), "2026-03-30", "DST does not roll the day");
assert.strictEqual(G.shiftDate("2026-01-01", -1), "2025-12-31");

// ---------- points ----------
const three = [habit("med", 2), habit("gym", 1), habit("read", 1)];
assert.strictEqual(G.maxPointsForDay(three), 4);
assert.strictEqual(G.pointsForDay({ med: 2, gym: 1 }, three), 3);
assert.strictEqual(G.pointsForDay({ med: 9 }, three), 2, "overshoot is capped at the habit target");
assert.strictEqual(G.pointsForDay({}, three), 0);
assert.strictEqual(G.pointsForDay(undefined, three), 0);

// ---------- habits active on a date ----------
const windowed = [habit("old", 1, "2026-01-01"), habit("new", 1, "2026-09-05")];
assert.strictEqual(G.habitsActiveOn(windowed, "2026-09-01").length, 1, "a habit added later does not exist in the past");
assert.strictEqual(G.habitsActiveOn(windowed, "2026-09-05").length, 2);
const archived = [habit("gone", 1, "2026-01-01", "2026-09-03")];
assert.strictEqual(G.habitsActiveOn(archived, "2026-09-02").length, 1);
assert.strictEqual(G.habitsActiveOn(archived, "2026-09-03").length, 0);

// ---------- effective target ----------
assert.strictEqual(G.effectiveTarget(3, 4), 3);
assert.strictEqual(G.effectiveTarget(9, 4), 4, "cannot need more points than were possible");
assert.strictEqual(G.effectiveTarget(3, 0), 0, "a day with no habits is never a qualifying day");

// A day before any habit existed must not qualify, or the streak would run
// backwards forever.
assert.strictEqual(G.dayQualifies(day("2025-06-01", {}), three, 3), false);
assert.strictEqual(G.dayQualifies(day("2026-09-01", { med: 2, gym: 1 }), three, 3), true);
assert.strictEqual(G.dayQualifies(day("2026-09-01", { med: 2 }), three, 3), false);

// ---------- streaks ----------
const full = { med: 2, gym: 1, read: 1 };
const run = [
  day("2026-09-01", full), day("2026-09-02", full), day("2026-09-03", full),
  day("2026-09-04", { med: 1 }),
  day("2026-09-05", full), day("2026-09-06", full),
];
const runs = G.runLengths(run, three, 3);
assert.deepStrictEqual(runs, { "2026-09-01": 1, "2026-09-02": 2, "2026-09-03": 3, "2026-09-05": 1, "2026-09-06": 2 });
assert.strictEqual(G.currentStreak(run, three, 3, "2026-09-06"), 2);
assert.strictEqual(G.currentStreak(run, three, 3, "2026-09-07"), 2, "an unfinished today does not break the streak");
assert.strictEqual(G.currentStreak(run, three, 3, "2026-09-08"), 0, "a missed yesterday does");

// ---------- tickets ----------
const settings = { daily_points_target: 3, streak_length: 3 };
const owed = G.ticketsOwed(run, three, settings, "2026-09-06");
assert.strictEqual(owed.filter((t) => t.reason === "daily").length, 5);
assert.deepStrictEqual(owed.filter((t) => t.reason === "streak"), [{ date: "2026-09-03", reason: "streak" }]);
assert.strictEqual(G.ticketsOwed(run, three, settings, "2026-09-02").length, 2, "future days are not paid out early");

let existing = owed.map((t, i) => ({ id: "t" + i, date: t.date, reason: t.reason, spent_at: null }));
let rec = G.reconcileTickets(existing, owed);
assert.deepStrictEqual(rec, { toAdd: [], toDeleteIds: [] }, "reconciling twice mints nothing");

// unchecking a day withdraws its unspent ticket
const dropped = owed.filter((t) => t.date !== "2026-09-06");
rec = G.reconcileTickets(existing, dropped);
assert.deepStrictEqual(rec.toAdd, []);
assert.strictEqual(rec.toDeleteIds.length, 1);

// ...but not once it has been spent, and the day cannot then pay out again
existing = existing.map((t) => (t.date === "2026-09-06" ? Object.assign({}, t, { spent_at: "now" }) : t));
rec = G.reconcileTickets(existing, dropped);
assert.deepStrictEqual(rec.toDeleteIds, [], "a spent ticket is never clawed back");
rec = G.reconcileTickets(existing, owed);
assert.deepStrictEqual(rec.toAdd, [], "re-qualifying the same day does not mint a second ticket");

assert.strictEqual(G.unspentTickets(existing).length, existing.length - 1);

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

// deterministic edges of the weighted draw
assert.strictEqual(G.drawPrize(prizes, () => 0).index, 0);
assert.strictEqual(G.drawPrize(prizes, () => 0.0999).index, 0);
assert.strictEqual(G.drawPrize(prizes, () => 0.1001).index, 1);
assert.strictEqual(G.drawPrize(prizes, () => 0.9999).index, 2);

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
  for (let k = 0; k < 500; k++) {
    const rotation = G.landingRotation(i, angles);
    const under = G.angleUnderPointer(rotation);
    assert.ok(under >= angles[i].start && under < angles[i].end,
      `index ${i}: pointer at ${under.toFixed(2)} outside [${angles[i].start}, ${angles[i].end})`);
    assert.ok(rotation >= 5 * 360, "the wheel always makes at least five turns");
  }
}

// a single prize fills the wheel and still wins
const one = [{ id: "only", weight: 5 }];
assert.strictEqual(G.drawPrize(one).index, 0);
const oneAngles = G.segmentAngles(one);
assert.strictEqual(oneAngles[0].end, 360);
const oneUnder = G.angleUnderPointer(G.landingRotation(0, oneAngles));
assert.ok(oneUnder >= 0 && oneUnder < 360);

// ---------- defaults ----------
assert.deepStrictEqual(G.defaultSettings(three), { daily_points_target: 3, streak_length: 7 });
assert.strictEqual(G.defaultSettings([]).daily_points_target, 1);

console.log("all logic tests passed");
