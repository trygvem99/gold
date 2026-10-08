// Gold pure logic — shared by the browser (window.Gold) and node tests.
// Every rule of the economy lives here: points, qualifying days, streaks,
// ticket reconciliation, the moving bar, weighted draw, rarity and the reveal.
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

  // 0 = Sunday … 6 = Saturday, read at noon UTC so no timezone can roll it
  const weekdayOf = (date) => new Date(date + "T12:00:00Z").getUTCDay();

  // A habit with no `days` list runs every day; otherwise only on those weekdays.
  const scheduledOn = (h, date) => !h.days || !h.days.length || h.days.indexOf(weekdayOf(date)) !== -1;

  const existedOn = (h, date) => {
    const created = (h.created_at || "").slice(0, 10);
    const archived = h.archived_at ? h.archived_at.slice(0, 10) : null;
    return (!created || created <= date) && (!archived || archived > date);
  };

  // A habit counts on a given day only if it existed then, was not yet
  // archived, and was scheduled for that weekday. Without the first two, adding
  // a habit today would retroactively raise the bar for past days and silently
  // break a live streak.
  function habitsActiveOn(habits, date) {
    return habits.filter((h) => existedOn(h, date) && scheduledOn(h, date)).slice().sort(byOrder);
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
  // Steps inside a goal, as in Microsoft To Do: progress you can see, worth
  // nothing on their own. Only finishing the goal itself pays.
  const stepProgress = (g) => {
    const steps = (g && g.steps) || [];
    return { done: steps.filter((st) => st.done_at).length, total: steps.length };
  };

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

  // A day with nothing scheduled on it — every habit is weekday-only and this
  // is a weekend, say — asks nothing of you, so it can neither earn nor break a
  // streak. It is skipped over, not counted as a miss.
  const isRestDay = (habits, goals, date) =>
    habitsActiveOn(habits, date).length === 0 && goalsDoneOn(goals, date).length === 0;

  function onlyRestBetween(habits, goals, a, b) {
    for (let d = shiftDate(a, 1); d < b; d = shiftDate(d, 1)) {
      if (!isRestDay(habits, goals, d)) return false;
    }
    return true;
  }

  // Run lengths keyed by date: for every qualifying day, how many qualifying
  // days end there consecutively, rest days in between not counting against
  // it. Non-qualifying days are absent.
  function runLengths(days, habits, goals, settings, today) {
    const map = indexDays(days);
    const dates = activeDates(days, goals, today).filter((date) =>
      dayQualifies(map[date] || { date, counts: {} }, habits, goals, settings));
    const runs = {};
    let prev = null, run = 0;
    for (const date of dates) {
      const joined = prev !== null &&
        (daysBetween(prev, date) === 1 || onlyRestBetween(habits, goals, prev, date));
      run = joined ? run + 1 : 1;
      runs[date] = run;
      prev = date;
    }
    return runs;
  }

  // The streak survives an unfinished today, and any rest days before it: it
  // only breaks once a day that asked something of you is over and unqualified.
  function currentStreak(days, habits, goals, settings, today) {
    const runs = runLengths(days, habits, goals, settings, today);
    if (runs[today]) return runs[today];
    let d = shiftDate(today, -1);
    for (let i = 0; i < 366 && isRestDay(habits, goals, d); i++) d = shiftDate(d, -1);
    return runs[d] || 0;
  }

  const bestStreak = (days, habits, goals, settings, today) => {
    const runs = runLengths(days, habits, goals, settings, today);
    return Object.keys(runs).reduce((m, k) => Math.max(m, runs[k]), 0);
  };

  // ---------- per-habit history ----------
  // Every serious tracker shows each habit's own record. All of this is read
  // straight from the day records; nothing new is stored.

  const habitCount = (h, map, date) => ((map[date] && map[date].counts[h.id]) || 0);
  const habitDoneOn = (h, map, date) => habitCount(h, map, date) >= targetOf(h);
  const habitStart = (h, today) => {
    const c = (h.created_at || "").slice(0, 10);
    return c && c <= today ? c : today;
  };
  // the days this habit actually asked for, oldest first; today only once done,
  // so an unfinished today never counts against anything
  function askedDays(h, map, today) {
    const out = [];
    for (let d = habitStart(h, today); d <= today; d = shiftDate(d, 1)) {
      if (!existedOn(h, d) || !scheduledOn(h, d)) continue;
      if (d === today && !habitDoneOn(h, map, d)) continue;
      out.push(d);
    }
    return out;
  }

  function habitStats(h, days, today) {
    const map = indexDays(days);
    const asked = askedDays(h, map, today);
    let best = 0, run = 0, total = 0;
    for (const d of asked) {
      if (habitDoneOn(h, map, d)) { run++; total++; best = Math.max(best, run); } else run = 0;
    }
    // current: back from the latest asked day, unscheduled days skipped
    let current = 0;
    for (let i = asked.length - 1; i >= 0 && habitDoneOn(h, map, asked[i]); i--) current++;

    // 30-day rate over asked days only
    const from = shiftDate(today, -29);
    const recent = asked.filter((d) => d >= from);
    const rate = recent.length ? recent.filter((d) => habitDoneOn(h, map, d)).length / recent.length : 0;

    // Loop Habit Tracker's habit strength: exponential smoothing over every
    // asked day, partial days counting partially. One miss dents it; it does
    // not reset it. This is the forgiving number, next to the strict streak.
    const m = Math.pow(0.5, 1 / 13);
    let strength = 0;
    for (const d of asked) strength = strength * m + Math.min(1, habitCount(h, map, d) / targetOf(h)) * (1 - m);

    let completions = 0;
    for (const d of days) completions += Math.min(targetOf(h), (d.counts && d.counts[h.id]) || 0);

    return { current, best, rate, strength, total, completions };
  }

  // one cell per day for a contribution-style grid: 0..1 filled, or null where
  // the habit did not ask for anything that day
  function habitGrid(h, days, from, to) {
    const map = indexDays(days);
    const out = [];
    for (let d = from; d <= to; d = shiftDate(d, 1)) {
      const asked = existedOn(h, d) && scheduledOn(h, d);
      out.push({ date: d, value: asked ? Math.min(1, habitCount(h, map, d) / targetOf(h)) : null });
    }
    return out;
  }

  // ---------- milestones ----------

  const STREAK_MARKS = [3, 7, 14, 30, 66, 100];
  const REP_MARKS = [10, 50, 100, 250, 500, 1000];

  function milestones({ best, reps, spins, quarters }) {
    const out = [];
    for (const n of STREAK_MARKS) {
      out.push({ id: "streak-" + n, kind: "streak", value: n, label: `${n}-day streak`,
        earned: best >= n, progress: Math.min(1, best / n) });
    }
    for (const n of REP_MARKS) {
      out.push({ id: "reps-" + n, kind: "reps", value: n, label: `${n} check-ins`,
        earned: reps >= n, progress: Math.min(1, reps / n) });
    }
    out.push({ id: "spin-1", kind: "spin", value: 1, label: "First reveal", earned: spins >= 1, progress: Math.min(1, spins) });
    out.push({ id: "quarter-1", kind: "quarter", value: 1, label: "First big goal", earned: quarters >= 1, progress: Math.min(1, quarters) });
    return out;
  }

  // ---------- time of day ----------

  const SLOTS = ["morning", "afternoon", "evening", "any"];
  const slotOf = (h) => (SLOTS.indexOf(h.time) !== -1 ? h.time : "any");
  const slotForHour = (hour) => (hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening");

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
  //
  // Unspent tickets are only withdrawn from `withdrawFrom` onward — the day you
  // just un-checked, and the streak days after it that it may have broken.
  // Without that, editing a habit's target or schedule re-judged history and
  // quietly took back spins you had already earned. With no date, nothing is
  // withdrawn: changing a setting can add tickets, never remove them.
  function reconcileTickets(existing, owed, withdrawFrom) {
    const managed = existing.filter((t) => MANAGED.indexOf(t.reason) !== -1);
    const have = new Set(managed.map(ticketKey));
    const want = new Set(owed.map(ticketKey));
    const toAdd = owed.filter((t) => !have.has(ticketKey(t)));
    const toDeleteIds = !withdrawFrom ? [] : managed
      .filter((t) => !t.spent_at && t.date >= withdrawFrom && !want.has(ticketKey(t)))
      .map((t) => t.id);
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

    // only days that asked something of you are judged; rest days would
    // otherwise read as misses and drag the bar down for a weekday routine
    const map = indexDays(days);
    let hit = 0, eligible = 0;
    for (let i = 1; i <= ADAPT.window; i++) {
      const d = shiftDate(today, -i);
      if (isRestDay(habits, goals, d)) continue;
      eligible++;
      if (dayQualifies(map[d] || { date: d, counts: {} }, habits, goals, settings)) hit++;
    }
    if (eligible < ADAPT.window / 2) return null;

    const cur = targetOn(settings, today);
    const ceiling = Math.max(...[0, 1, 2, 3, 4, 5, 6].map((k) =>
      maxPointsForDay(habitsActiveOn(habits, shiftDate(today, k)))));
    const rate = hit / eligible;
    if (rate >= ADAPT.up / ADAPT.window && cur < ceiling) return { from: cur, to: cur + 1, hit, window: eligible, dir: "up" };
    if (rate <= ADAPT.down / ADAPT.window && cur > 1) return { from: cur, to: cur - 1, hit, window: eligible, dir: "down" };
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

  // ---------- rarity ----------
  // The colour grammar every gacha game shares: common silver, rare blue, epic
  // purple, legendary gold. A prize's tier comes from its odds unless it has
  // been set by hand; a blank is its own thing.

  const TIERS = ["common", "rare", "epic", "legendary"];
  const TIER_LIMITS = { legendary: 7, epic: 12, rare: 20 }; // percent, inclusive
  const tierRank = (t) => (t === "blank" ? -1 : TIERS.indexOf(t));

  function rarityOf(prize, prizes) {
    if (prize.blank) return "blank";
    if (TIERS.indexOf(prize.rarity) !== -1) return prize.rarity;
    const p = probabilityFor(prize, prizes);
    return p <= TIER_LIMITS.legendary ? "legendary"
      : p <= TIER_LIMITS.epic ? "epic"
        : p <= TIER_LIMITS.rare ? "rare" : "common";
  }

  // ---------- the reveal ----------

  // How often the charge stops one tier short of the truth, so the higher
  // colour only arrives when the reel lands — the late bloom. It applies to
  // every tier above common, which is what gives the reel suspense of its own:
  // a blue charge may still land purple.
  const LATE_BLOOM = 0.35;

  // The tiers the charge steps through before the reel. It climbs, and never
  // claims more than the truth: the last step is the real tier, or one below
  // it in a late bloom. Blanks and commons both show silver — the baseline —
  // so a loss is only known when the reel stops, as on a slot.
  function chargeTell(tier, rand) {
    const rnd = rand || Math.random;
    const late = tierRank(tier) >= 1 && rnd() < LATE_BLOOM;
    const lead = rnd() < 0.3;
    switch (tier) {
      case "rare": return { steps: late ? ["common"] : ["common", "rare"], late };
      case "epic": {
        const top = late ? ["rare"] : ["rare", "epic"];
        return { steps: lead ? ["common"].concat(top) : top, late };
      }
      case "legendary": return { steps: late ? ["rare", "epic"] : ["rare", "epic", "legendary"], late };
      default: return { steps: ["common"], late: false };
    }
  }

  // The reel: a strip of prize indices with the winner at a fixed slot and the
  // best other prize right after it, so the reel visibly stops one card short
  // of it. Everything else is drawn by weight, so the strip is honest about
  // what is common — except that a couple of high-tier cards are guaranteed to
  // fly past early. Prizes with no weight cannot be won, so they never appear.
  const STRIP = { length: 48, win: 40 };

  function buildStrip(prizes, winner, rand) {
    const rnd = rand || Math.random;
    const live = prizes.map((p, i) => ({ p, i, t: tierRank(rarityOf(p, prizes)) })).filter((x) => x.p.weight > 0);
    const total = live.reduce((s, x) => s + x.p.weight, 0);
    const pick = () => {
      let r = rnd() * total;
      for (const x of live) { r -= x.p.weight; if (r < 0) return x.i; }
      return live[live.length - 1].i;
    };
    const cards = Array.from({ length: STRIP.length }, pick);
    cards[STRIP.win] = winner;

    const others = live.filter((x) => x.i !== winner).sort((a, b) => (b.t - a.t) || (a.p.weight - b.p.weight));
    if (others.length) cards[STRIP.win + 1] = others[0].i;

    const high = live.filter((x) => x.t >= 2).map((x) => x.i);
    if (high.length) {
      const early = (k) => k >= 6 && k < 30;
      let have = cards.filter((c, k) => early(k) && high.indexOf(c) !== -1).length;
      const slots = [9, 16, 23, 28];
      const off = Math.floor(rnd() * slots.length);
      for (let n = 0; have < 2 && n < slots.length; n++) {
        const k = slots[(n + off) % slots.length];
        if (high.indexOf(cards[k]) !== -1) continue;
        cards[k] = high[Math.floor(rnd() * high.length)];
        have++;
      }
    }
    return { cards, win: STRIP.win };
  }

  // ---------- icons ----------

  // Guess an icon from what the thing is called, so nobody has to go hunting
  // through an emoji keyboard. English and Norwegian, longest match wins.
  //
  // Single distinctive words only. Matching is by prefix, so "run" catches
  // "running" — which is why a common word like "out" or "the" must never
  // appear here, or "Dinner out" picks up the bedtime icon.
  const ICON_WORDS = [
    ["🏃", "run løp løping jog jogging springe marathon maraton"],
    ["🏋️", "gym train trening styrke lift løft workout"],
    ["🚶", "walk walking tur turgåing steps skritt"],
    ["🚴", "bike bicycle sykkel sykle cycling"],
    ["🏊", "swim swimming svøm svømme basseng"],
    ["🧘", "meditate meditation meditasjon meditere yoga mindfulness pust breathe"],
    ["📖", "read reading les lese lesing book bok kapittel chapter"],
    ["✍️", "write writing skriv skrive journal dagbok blogg"],
    ["🎓", "study studere lære learn course kurs exam eksamen skole"],
    ["💻", "code coding kode program prosjekt project"],
    ["💼", "work jobb career karriere meeting"],
    ["💰", "money penger budget budsjett sparing savings"],
    ["📈", "invest aksjer stocks portfolio portefølje"],
    ["🧹", "clean cleaning rydde vaske tidy husarbeid"],
    ["🍳", "cook cooking matlaging"],
    ["🥗", "salad salat grønnsaker vegetables greens"],
    ["🥩", "protein kjøtt"],
    ["💧", "water vann hydrate drikke"],
    ["🌙", "sleep sove seng sengetid bedtime lights"],
    ["🚫", "sugar sukker candy godteri snacks junk"],
    ["🍷", "alcohol alkohol wine beer øl"],
    ["🚭", "smoke smoking røyk snus"],
    ["🦷", "dentist tannlege tenner teeth"],
    ["🩺", "doctor lege health helse checkup legetime"],
    ["📞", "call ringe phone telefon"],
    ["📧", "email inbox innboks"],
    ["🌱", "garden hage plante plant"],
    ["🎸", "music musikk guitar gitar piano"],
    ["🗣️", "language språk spanish spansk french fransk german tysk"],
    ["📷", "photo foto camera kamera"],
    ["✈️", "travel reise flight holiday ferie"],
    ["🚗", "car bil kjøre drive"],
    ["🏠", "house home hjem leilighet"],
    ["🐕", "dog hund puppy valp"],
    ["👨‍👩‍👧", "family familie kids barn"],
    ["🤝", "friend friends venn venner social sosialt"],
    ["🎬", "film movie cinema kino serie series"],
    ["🎮", "game gaming spill"],
    ["☕", "coffee kaffe"],
    ["🍽️", "dinner middag lunch lunsj restaurant"],
    ["🚿", "shower dusj"],
    ["⚖️", "weight vekt weigh veie"],
    ["🤸", "stretch stretching tøye mobility"],
    ["🗓️", "plan planlegg schedule kalender"],
    ["🛒", "shop shopping groceries handling"],
    ["🙏", "pray prayer church kirke gratitude takknemlig"],
    ["🏅", "compete konkurranse race vinne"],
    ["🧾", "admin taxes skatt bills regninger papirer"],
  ];
  const FALLBACK = ["🎯", "✅", "⭐", "🔥", "💪", "📌"];

  function suggestIcons(name, limit) {
    const text = " " + String(name || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ") + " ";
    const scored = [];
    for (const [icon, words] of ICON_WORDS) {
      let best = 0;
      for (const w of words.split(" ")) {
        // short words match far too much by prefix; the table has none, and
        // this keeps it that way
        if (w.length >= 3 && text.indexOf(" " + w) !== -1) best = Math.max(best, w.length);
      }
      if (best) scored.push({ icon, best });
    }
    scored.sort((a, b) => b.best - a.best);
    const out = [];
    for (const s of scored) if (out.indexOf(s.icon) === -1) out.push(s.icon);
    for (const f of FALLBACK) if (out.indexOf(f) === -1) out.push(f);
    return out.slice(0, limit || 6);
  }

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
    weekdayOf, scheduledOn, isRestDay, bestStreak, habitStats, habitGrid,
    milestones, STREAK_MARKS, REP_MARKS, SLOTS, slotOf, slotForHour,
    openGoals, doneGoals, goalsDoneOn, goalTickets, stepProgress,
    targetHistory, targetOn, effectiveTarget, dayStats, dayQualifies,
    activeDates, runLengths, currentStreak,
    ticketsOwed, ticketKey, reconcileTickets, unspentTickets, MANAGED,
    ADAPT, adaptTarget, applyTarget,
    activePrizes, totalWeight, probabilityFor, drawPrize,
    TIERS, tierRank, rarityOf, LATE_BLOOM, chargeTell, STRIP, buildStrip,
    suggestIcons, defaultSettings,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.Gold = api;
})(typeof window !== "undefined" ? window : globalThis);
