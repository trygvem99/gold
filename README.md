# Gold

Daily habits, earned tickets, a prize worth the wait. Check habits off, hit the
day's points target, get a ticket. A ticket plays a short show that ends in a
prize. Whatever you win sits in the vault until you use it.

Runs entirely in the browser on your phone: no account, no server, no API key,
no cost.

## The deal

- Every habit has a **daily target count**. Meditating twice a day is one habit
  with a target of 2. A habit can run **every day or on chosen weekdays**, and
  sits in a **morning, afternoon, evening or anytime** group on Today.
- A day with nothing scheduled is a **rest day**: it can neither earn nor break a
  streak, and the moving bar does not count it.
- The **last seven days** can be edited from the week strip, for the day you
  forgot to log.
- Every completion is **1 point**, capped at each habit's own target — one easy
  habit cannot be farmed to reach the threshold.
- **One-off goals** ("this week") are worth 1 point, on the day you finish them.
  An unfinished one costs nothing: it does not raise the day's ceiling.
- **Quarterly goals** pay tickets outright — 3 by default. They are the big ones,
  so they skip the points economy entirely.
- Hit the day's **points target** → 1 ticket.
- Every **N qualifying days in a row** (default 7) → 1 bonus ticket.
- A ticket buys one **reveal** (below). Prize odds are per-prize **weights** you
  set; the percentage each weight produces is shown live while you drag the slider.
- One prize **wins nothing** (16% by default). A ticket is a gamble or it is just
  a vending machine. Any prize can be made a blank, and its weight tuned.
- Wins go to the **Vault** and stay there until you mark them used.

### The reveal

About 12 to 14 seconds, built from what slot machines, gacha pulls and card
packs use to make the wait itself feel good. The prize is drawn the moment you
tap, and the ticket is spent and the prize put in the vault before the show
starts; nothing in the show changes the odds.

1. **Charge.** The ticket feeds a glowing core whose colour steps up through the
   tiers: silver, blue, purple, gold. The colour is a promise that is never
   broken: the prize is at least that tier.
2. **Reel.** The core folds into a line and a strip of prize cards rips past
   under it, showing only silhouettes in tier-coloured frames. It slows, hangs on
   the edge of a card, and creeps onto it. The best prize it did not land on sits
   one card further on. About a third of the time a blue, purple or gold prize
   lands a tier above what the charge showed: the **late bloom**.
3. **Reveal.** The card lifts out face-down, glowing, and flips. Bigger fanfare,
   sparks and light for rarer tiers; a blank gets smoke and "Nothing this time".

**Hold anywhere** during the show to run it at 4x; let go to drop back.

**Rarity** comes from each prize's odds: 7% or less is legendary, 12% or less
epic, 20% or less rare, the rest common. Any prize can be set to a tier by hand
in its editor.

Every number above is editable in Settings. Nothing about the economy is
hard-coded.

### The bar moves

A fixed target is either too easy or too hard within a month. So it moves:
hit it **12 of 14 days** and it rises by one point; hit it **5 or fewer** and it
drops by one. One step at a time, never more often than once a week, never above
what a day actually holds or below one point. You are always told when it moves
and can put it back with one tap, and it can be switched off entirely.

The target is **dated**, not a single number: every past day is judged against
the bar that applied on that day. Raising it tomorrow can never reach back and
withdraw a ticket you already earned.

### Ticket accounting

Tickets are a ledger, not a counter. At most one daily and one streak ticket per
calendar date, ever, so unchecking and re-checking cannot mint a second one. If
you un-check a day back below the threshold its ticket disappears again — unless
it has already been spent, in which case the reward stays yours. Changing a
setting (a habit's target, its schedule, the bar) can add tickets but never takes
one back.

### Progress

Current and best streak, the share of days on target, a month calendar of every
day, milestones, and per habit: current and best streak, 30-day rate, a
contribution grid, and **habit strength** — Loop Habit Tracker's exponentially
smoothed score, where one missed day dents the number instead of zeroing it.

Habits and prizes are archived, never deleted, and a win copies the prize's name,
emoji and colour into itself. Rewriting the prize list cannot corrupt the vault,
and adding a habit today cannot retroactively break a live streak.

## How it works

- **Storage**: IndexedDB on the phone. No account, no cloud, no sync.
- **Hosting**: static files on GitHub Pages. Deploying is `git push`.
- **Cost**: $0. There is no API and nothing to subscribe to.

## Honest limits

- **Startup is guarded.** If storage reads back less than this phone is known to
  hold, the app retries, and if it stays short it changes nothing and says so —
  it never seeds or writes defaults over data that failed to load.
- **One device.** Data lives on the phone that entered it. Clearing browser data
  or uninstalling the app deletes it. **The export in Settings is the only safety
  net** — the Backup card nags once the last export is over 14 days old.
- **No reminders.** A PWA with no server cannot reliably nudge you at 21:00, and
  cannot put a widget on the Android home screen. You have to open it.
- **Sound needs a tap first.** Browsers refuse audio until you have interacted
  with the page, so the first sound of a session is the one you triggered.
  Turn it off in Settings → Sound.
- **The repo is public** (that is what free GitHub Pages requires). It holds code
  and the default seed only; your habits, streak and vault never leave the phone.
- **It does not police you.** You can check a box you did not earn. The app makes
  the honest path pleasant, nothing more.

## Setup

1. Open the Pages URL on the phone.
2. **Install to the home screen first**, then use the installed app — a browser
   tab and an installed PWA do not always share storage.
3. Settings → Habits: replace the seed with your real ones, with real targets.
4. Settings → The deal: set the points needed for a ticket and the streak length.
5. Settings → Prizes: set the prizes and drag the weights until the percentages
   look right.

## Local development

```
node server.js               # static file server on :5190, plus the LAN URL for the phone
node scripts/test-logic.js   # pure-function tests
```

`server.js` is a dev convenience only — production is static.

## Files

- `index.html` / `app.js` / `styles.css` — the app (Today, Progress, Rewards, Settings)
- `ui.js` — shared visuals: the gradient ring, sparks, counters, grain
- `fonts/` — Inter and Sora, self-hosted so they work offline (SIL Open Font License)
- `logic.js` — every rule: points, schedules, rest days, streaks, habit stats,
  milestones, ticket reconciliation, weighted draw, rarity and the reveal's
  charge and reel. Pure, and
  tested in node.
- `reveal.js` — the ticket show: charge, reel and card flip on one virtual clock
  (which is how hold-to-speed-up works), a particle canvas, haptics and sound cues
- `sound.js` — every sound synthesised with Web Audio; no audio files ship
- `db.js` — IndexedDB layer, backup and restore
- `seed.json` — the habits and prizes a fresh install starts with
- `manifest.webmanifest` / `sw.js` / `icon.svg` — PWA shell

## Changing it later

The habits, targets, threshold, streak length, prizes and weights are all
in-app settings. Beyond that:

- Rules are pure functions in `logic.js` with tests next door — changing how the
  streak bonus works is one function and one assertion.
- Records are plain objects, so a new field (per-habit point values, per-weekday
  schedules, rest days) needs no migration. `db.js` guards every
  `createObjectStore`, so a genuinely new store is a version bump and one line.
- **Any new store must be added to `STORES` in `db.js`**, or backup and restore
  will silently skip it.
- The reveal is handed a prize array and a winning index and knows nothing else.
