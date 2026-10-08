// Gold reveal — what a ticket buys: a ~14 second show that ends in a prize.
//
// Three acts, built from what slots, gacha pulls, card packs and case openings
// do to make waiting feel good:
//   1. CHARGE  the ticket feeds a core; its colour climbs through the tiers and
//              is the tell — colour before identity. It never claims more than
//              the truth, and sometimes stops one tier short (the late bloom).
//   2. REEL    a strip of silhouetted, tier-framed cards rips past and runs
//              down under a line; it hangs on the edge of the winner, creeps
//              onto it, and the best prize it did not land on sits one card on.
//   3. REVEAL  the winner lifts out face-down, glowing, hangs, and flips.
// The prize is drawn before any of this starts; nothing here touches the odds.
//
// One virtual clock drives everything, so holding the screen runs the whole
// show at 4x and still plays every beat.
"use strict";

const Reveal = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TIER = {
    blank: { c: "#77738A", hi: "#B9B5C8", label: "Nothing" },
    common: { c: "#CBD5E4", hi: "#FFFFFF", label: "Common" },
    rare: { c: "#4CA8FF", hi: "#C4E4FF", label: "Rare" },
    epic: { c: "#B46BFF", hi: "#E8D1FF", label: "Epic" },
    legendary: { c: "#FFC24A", hi: "#FFF3CC", label: "Legendary" },
  };
  const NEUTRAL = "#8A86A0";
  const CW = 96, GAP = 10, P = CW + GAP;
  const FAST = 4;

  let playing = false;

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const ease = {
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    out: (p) => 1 - Math.pow(1 - p, 3),
    smooth: (p) => p * p * (3 - 2 * p),
    back: (p) => 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2),
  };
  const span = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

  // Distance covered by a velocity that ramps up and then decays exponentially:
  // a hard shove released against friction, continuous at the join.
  function travel(p, ramp) {
    const k = 4.3;
    const rampArea = 0.5 * ramp;
    const decayed = (x) => ((1 - Math.exp(-k * x)) * (1 - ramp)) / k;
    const total = rampArea + decayed(1);
    const d = p <= ramp ? (0.5 * p * p) / ramp : rampArea + decayed((p - ramp) / (1 - ramp));
    return d / total;
  }

  const div = (cls, html) => {
    const d = document.createElement("div");
    d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- particles ----------
  // One canvas for the whole show: motes spiralling into the core, sparks,
  // embers and smoke. Additive blending makes overlapping light read as light.
  function particles(canvas) {
    const ctx = canvas.getContext("2d");
    const parts = [];
    let w = 0, h = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const add = (p) => { if (parts.length < 700) parts.push(Object.assign({ life: 1, ttl: 1, size: 2 }, p)); };

    function step(dt) {
      ctx.clearRect(0, 0, w, h);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt / p.ttl;
        if (p.kind === "mote") {
          p.px = p.x; p.py = p.y;
          p.ang += p.spin * dt;
          p.rad *= Math.pow(p.pull, dt);
          p.x = p.cx + Math.cos(p.ang) * p.rad;
          p.y = p.cy + Math.sin(p.ang) * p.rad;
          if (p.rad < 10) p.life = 0;
        } else {
          if (p.grav) p.vy += p.grav * dt;
          if (p.drag) { const d = Math.pow(p.drag, dt); p.vx *= d; p.vy *= d; }
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        const a = clamp(p.life * 1.6, 0, 1);
        if (p.kind === "mote") {
          // a streak along its orbit, swallowed as it reaches the core
          if (p.px == null) continue;
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = a * clamp((p.rad - 12) / 60, 0, 1);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
          continue;
        }
        if (p.kind === "smoke") {
          ctx.globalCompositeOperation = "source-over";
          const r = p.size * (1.8 - p.life);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, p.color);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.globalAlpha = a * 0.16;
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          continue;
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * 0.14;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = a;
        if (p.kind === "spark") {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    function burst(x, y, colors, n, power) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (120 + Math.random() * 520) * (power || 1);
        add({ kind: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.08, grav: 140,
          size: 1.2 + Math.random() * 2.2, ttl: 0.7 + Math.random() * 0.9, color: colors[(Math.random() * colors.length) | 0] });
      }
    }
    return { add, step, burst, size, count: () => parts.length };
  }

  // ---------- the idle core on the Rewards tab ----------
  function idle(host, tickets) {
    host.innerHTML =
      '<div class="idle-core" role="button" aria-label="Use a ticket">' +
      '<div class="rv-halo"></div><div class="rv-ring r1"></div><div class="rv-ring r2"></div><div class="rv-ring r3"></div>' +
      `<div class="rv-heart"><span class="idle-count">${tickets}</span></div></div>`;
    return host.querySelector(".idle-core");
  }

  // ---------- the show ----------
  function play(opts) {
    if (playing) return Promise.resolve();
    playing = true;
    const prizes = opts.prizes, index = opts.index;
    const rand = opts.rand || Math.random;
    const prize = prizes[index];
    const tier = Gold.rarityOf(prize, prizes);
    const tell = Gold.chargeTell(tier, rand);
    const strip = Gold.buildStrip(prizes, index, rand);
    const tierOf = (i) => Gold.rarityOf(prizes[i], prizes);
    const steps = tell.steps;
    const lastTell = steps[steps.length - 1];
    const W = strip.win;

    // ---- timeline, in virtual milliseconds ----
    const T = { charge: 650 };
    T.steps = steps.map((_, k) => T.charge + 450 + k * 850);
    T.flash = T.steps[T.steps.length - 1];
    T.collapse = T.flash + 950;
    T.reel = T.collapse + 520;
    T.preStop = T.reel + 5200;
    T.hangEnd = T.preStop + 650;
    T.creepEnd = T.hangEnd + 1150;
    T.land = T.creepEnd + 380;
    T.lift = T.land + 420;
    T.flip = T.lift + 1150;
    T.done = T.flip + 650;

    // ---- stage ----
    const root = div("rv");
    root.innerHTML =
      '<svg class="rv-defs" width="0" height="0" aria-hidden="true"><filter id="rv-mblur" x="-20%" y="0" width="140%" height="100%">' +
      '<feGaussianBlur stdDeviation="0 0"/></filter></svg>' +
      '<div class="rv-rays"></div><div class="rv-wash"></div>' +
      '<div class="rv-core"><div class="rv-halo"></div><div class="rv-ring r1"></div><div class="rv-ring r2"></div>' +
      '<div class="rv-ring r3"></div><div class="rv-heart"></div><div class="rv-shock"></div></div>' +
      '<div class="rv-ticket"><span>TICKET</span></div>' +
      '<div class="rv-tierpop"></div>' +
      '<div class="rv-reel"><div class="rv-track"></div><div class="rv-line"></div></div>' +
      '<div class="rv-big"><div class="rv-aura"></div><div class="rv-flip">' +
      '<div class="rv-face rv-back"><span class="rv-sil"></span></div>' +
      '<div class="rv-face rv-front"><span class="rv-kick"></span><span class="rv-emoji"></span>' +
      '<span class="rv-name"></span><span class="rv-pill"></span></div></div></div>' +
      '<canvas class="rv-fx"></canvas>' +
      '<div class="rv-cta"><button class="btn primary rv-ok" type="button"></button></div>' +
      '<div class="rv-hint">Hold to speed up</div>';
    document.body.appendChild(root);
    document.body.classList.add("revealing");

    const $ = (s) => root.querySelector(s);
    const core = $(".rv-core"), heart = $(".rv-heart"), rings = root.querySelectorAll(".rv-core .rv-ring");
    const ticket = $(".rv-ticket"), wash = $(".rv-wash"), rays = $(".rv-rays"), pop = $(".rv-tierpop");
    const reel = $(".rv-reel"), track = $(".rv-track"), line = $(".rv-line"), blur = $(".rv-defs feGaussianBlur");
    const big = $(".rv-big"), flip = $(".rv-flip"), aura = $(".rv-aura"), cta = $(".rv-cta"), hint = $(".rv-hint");
    const fx = particles($(".rv-fx"));

    // the strip: silhouettes in tier frames, so colour comes before identity
    track.innerHTML = strip.cards.map((i) => {
      const t = tierOf(i);
      return `<div class="rv-card t-${t}" style="--cc:${TIER[t].c}"><span class="rv-sil">${esc(prizes[i].emoji || "?")}</span></div>`;
    }).join("");
    const cards = track.children;
    const winCard = cards[W];

    $(".rv-back .rv-sil").textContent = prize.emoji || "?";
    $(".rv-emoji").textContent = tier === "blank" ? "—" : (prize.emoji || "🎁");
    $(".rv-name").textContent = tier === "blank" ? "Nothing this time" : prize.name;
    $(".rv-kick").textContent = tier === "blank" ? "SO CLOSE" : "YOU WON";
    $(".rv-pill").textContent = TIER[tier].label;
    $(".rv-ok").textContent = tier === "blank" ? "Fine" : "Add to vault";
    $(".rv-ok").classList.toggle("primary", tier !== "blank");
    big.style.setProperty("--cc", TIER[tier].c);
    big.style.setProperty("--cc-hi", TIER[tier].hi);
    big.classList.add("t-" + tier);

    const setTone = (t) => {
      root.style.setProperty("--tc", t ? TIER[t].c : NEUTRAL);
      root.style.setProperty("--tc-hi", t ? TIER[t].hi : "#C9C6D6");
    };
    setTone(null);

    // geometry of the reel, in track pixels: where the line sits over the strip
    const vw = () => window.innerWidth;
    const startX = 2 * P + CW / 2;
    const restX = W * P + CW / 2 + CW * (0.12 + rand() * 0.26); // past the middle, nearly into the next card
    const preX = W * P - GAP / 2 - 7;                             // hanging just short of the winner
    const cardAt = (x) => Math.floor((x + GAP / 2) / P);

    // ---- clock ----
    let vt = 0, scale = REDUCED ? FAST : 1, last = performance.now(), raf = 0;
    let lastX = startX, lastCard = cardAt(startX), lastTick = 0, lastBuzz = 0, flicked = 0;
    let ringAng = [0, 0, 0], shown = -1, liftFrom = null, resolveFn = null;
    const done = new Set();
    const once = (k, fn) => { if (!done.has(k)) { done.add(k); fn(); } };
    const coreXY = () => { const r = core.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

    const hold = (on) => {
      if (vt >= T.done) on = false;
      scale = on || REDUCED ? FAST : 1;
      root.classList.toggle("fast", scale > 1 && !REDUCED);
    };
    root.addEventListener("pointerdown", (e) => { if (!e.target.closest(".rv-cta")) hold(true); });
    root.addEventListener("pointerup", () => hold(false));
    root.addEventListener("pointercancel", () => hold(false));
    root.addEventListener("pointerleave", () => hold(false));

    function flashWash(strength, ms) {
      wash.animate([{ opacity: strength }, { opacity: 0 }], { duration: ms / scale, easing: "cubic-bezier(.2,.8,.3,1)" });
    }
    function tierPop(t, sub) {
      pop.innerHTML = `<b>${TIER[t].label}</b>${sub ? `<small>${sub}</small>` : ""}`;
      pop.style.setProperty("--pc", TIER[t].c);
      pop.animate([
        { opacity: 0, transform: "translate(-50%, 8px) scale(.85)" },
        { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.18 },
        { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.75 },
        { opacity: 0, transform: "translate(-50%, -6px) scale(1)" },
      ], { duration: 1300 / scale, easing: "ease-out" });
    }

    function frame(now) {
      const dt = Math.min(50, now - last);
      last = now;
      vt += dt * scale;
      try { render(vt, dt * scale / 1000); }
      catch (e) { console.error(e); vt = Math.max(vt, T.done); }
      fx.step((dt * scale) / 1000);
      raf = requestAnimationFrame(frame);
    }

    function render(t, dts) {
      // ---- act 0: the ticket goes in ----
      if (t < T.charge + 200) {
        once("insert", () => { Sfx.insert(); Ui.vibrate(10); Sfx.riserStart(); });
        const p = ease.inOut(span(t, 0, T.charge));
        const [cx, cy] = coreXY();
        const fromY = window.innerHeight * 0.92;
        ticket.style.transform = `translate(-50%, -50%) translate(${cx - vw() / 2}px, ${fromY + (cy - fromY) * p}px) ` +
          `rotate(${(1 - p) * -8}deg) scale(${1 - p * 0.75})`;
        ticket.style.opacity = String(1 - span(t, T.charge - 180, T.charge + 150));
      }
      hint.style.opacity = String(t < T.reel + 1500 ? 0.75 : clamp(1 - span(t, T.reel + 1500, T.reel + 2300), 0, 0.75) * 0.75);

      // ---- act 1: charge ----
      if (t < T.reel + 400) {
        const k = T.steps.filter((s) => t >= s).length;
        if (k !== shown) {
          shown = k;
          if (k > 0) {
            const st = steps[k - 1];
            setTone(st);
            Sfx.tell(st);
            Ui.vibrate([0, 10 + k * 8, 30, 14 + k * 8]);
            core.querySelector(".rv-shock").animate([{ transform: "scale(.4)", opacity: 0.9 }, { transform: "scale(2.6)", opacity: 0 }],
              { duration: 800 / scale, easing: "cubic-bezier(.16,1,.3,1)" });
            const [cx, cy] = coreXY();
            fx.burst(cx, cy, [TIER[st].c, TIER[st].hi], 14 + k * 10, 0.55);
            if (k === steps.length) {
              // the colour lands: wash the screen in it
              flashWash(tierRankOf(st) >= 2 ? 0.75 : 0.45, 1100);
              Sfx.flash(st);
              tierPop(st);
              if (st === "legendary") rays.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { opacity: 0 }], { duration: 2200 / scale });
            }
          }
        }
        const prog = span(t, T.charge, T.flash);
        const speeds = [40, -70, 110].map((s) => s * (0.5 + prog * 2.4));
        ringAng = ringAng.map((a, i) => a + speeds[i] * dts);
        rings.forEach((r, i) => { r.style.transform = `rotate(${ringAng[i]}deg)`; });
        const beat = Math.sin(t / 95) * 0.04 * (0.3 + prog);
        const c = span(t, T.collapse, T.reel);
        heart.style.transform = `scale(${1 + prog * 0.22 + beat})`;
        core.style.transform = `translate(-50%, -50%) scale(${1 + c * 3.5}, ${1 - ease.inOut(c) * 0.97})`;
        core.style.opacity = String(1 - span(t, T.reel - 60, T.reel + 260));
        Sfx.riserSet(t < T.collapse ? prog : 0);

        // motes spiral in, faster and thicker as the charge builds
        if (t >= T.charge && t < T.collapse) {
          const [cx, cy] = coreXY();
          const rate = 50 + prog * 260;
          const n = rate * dts + (Math.random() < (rate * dts) % 1 ? 1 : 0);
          const col = shown > 0 ? TIER[steps[shown - 1]] : { c: NEUTRAL, hi: "#D4D1E0" };
          for (let i = 0; i < n; i++) {
            fx.add({ kind: "mote", cx, cy, ang: Math.random() * Math.PI * 2, rad: 120 + Math.random() * 170,
              spin: 1.8 + Math.random() * 1.8, pull: 0.12 - prog * 0.06, size: 1 + Math.random() * 1.6,
              ttl: 1.6, color: Math.random() < 0.3 ? col.hi : col.c });
          }
        }
        if (t >= T.collapse) once("collapse", () => { Sfx.riserStop(); Sfx.collapse(); });
      }

      // ---- act 2: the reel ----
      if (t >= T.reel - 150 && t < T.lift + 600) {
        const open = ease.out(span(t, T.reel - 150, T.reel + 350));
        reel.style.clipPath = `inset(${(1 - open) * 50}% 0 ${(1 - open) * 50}% 0)`;
        reel.style.opacity = String(1 - span(t, T.lift, T.lift + 500));
        reel.style.transform = `translateY(calc(-50% + ${span(t, T.lift, T.lift + 600) * 60}px))`;

        let x;
        if (t < T.preStop) x = startX + (preX - startX) * travel(span(t, T.reel, T.preStop), 0.07);
        else if (t < T.hangEnd) { const p = span(t, T.preStop, T.hangEnd); x = preX + 1.6 * Math.sin(p * Math.PI * 7) * (1 - p); }
        else if (t < T.creepEnd) x = preX + (restX - preX) * ease.smooth(span(t, T.hangEnd, T.creepEnd));
        else { const u = span(t, T.creepEnd, T.land); x = restX - 3 * Math.exp(-5 * u) * Math.sin(2 * Math.PI * 1.3 * u); }
        track.style.transform = `translateX(${(vw() / 2 - x).toFixed(2)}px)`;

        const speed = Math.abs(x - lastX) / Math.max(1e-3, dts) / 1000; // px per virtual ms
        lastX = x;
        const v = clamp(speed / 3.2, 0, 1);
        const b = speed > 0.35 ? clamp((speed - 0.35) * 9, 0, 22) : 0;
        blur.setAttribute("stdDeviation", `${b.toFixed(1)} 0`);
        track.style.filter = b > 0.5 ? "url(#rv-mblur)" : "none";

        if (t >= T.reel) {
          once("reel", () => Sfx.whooshStart());
          Sfx.whooshSet(t < T.preStop ? v : 0);
          const c = cardAt(x);
          if (c !== lastCard) {
            const entering = c === W && t >= T.hangEnd;
            lastCard = c;
            flicked = 1;
            if (entering) {
              // the one crossing that decides it
              Sfx.clunk();
              Ui.vibrate(70);
              line.animate([{ transform: "scaleY(1.25)" }, { transform: "scaleY(1)" }], { duration: 400 / scale });
              if (tierRankOf(tier) > tierRankOf(lastTell)) {
                // the late bloom: the reel lands a tier above what the charge said
                setTone(tier);
                Sfx.bloom(tier);
                flashWash(0.6, 1000);
                tierPop(tier, "upgrade");
                const r = winCard.getBoundingClientRect();
                fx.burst(r.left + r.width / 2, r.top + r.height / 2, [TIER[tier].c, TIER[tier].hi], 46, 0.8);
              }
            } else if (now() - lastTick > 28) {
              lastTick = now();
              Sfx.peg(v);
            }
            if (!entering && now() - lastBuzz > (v > 0.35 ? 90 : 30)) {
              lastBuzz = now();
              Ui.vibrate(clamp(Math.round(4 + v * 10), 4, 14));
            }
          }
          flicked *= Math.pow(0.02, dts);
          line.style.setProperty("--kick", flicked.toFixed(3));
          if (t >= T.preStop) once("hang", () => { Sfx.whooshSet(0); Sfx.tension(); });
          if (t >= T.land) once("land", () => {
            Sfx.whooshStop();
            winCard.classList.add("won");
            track.classList.add("settled");
            track.style.filter = "none";
          });
        }
      }

      // ---- act 3: lift, hang, flip ----
      if (t >= T.lift) {
        once("lift", () => {
          const r = winCard.getBoundingClientRect();
          const b = big.getBoundingClientRect();
          liftFrom = { dx: r.left + r.width / 2 - (b.left + b.width / 2), dy: r.top + r.height / 2 - (b.top + b.height / 2), s: r.width / b.width };
          big.style.visibility = "visible";
          Sfx.lift();
          Ui.vibrate([0, 12, 30, 18]);
        });
        const p = ease.back(span(t, T.lift, T.lift + 700));
        const bob = Math.sin((t - T.lift) / 420) * 5 * span(t, T.lift + 500, T.lift + 900);
        const dx = liftFrom.dx * (1 - p), dy = liftFrom.dy * (1 - p) + bob;
        const s = liftFrom.s + (1 - liftFrom.s) * p;
        big.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)})`;
        const f = ease.inOut(span(t, T.flip, T.flip + 620));
        flip.style.transform = `rotateY(${(f * 180).toFixed(1)}deg)`;
        aura.style.opacity = String(span(t, T.lift + 200, T.lift + 900) * (0.75 + Math.sin(t / 260) * 0.15));

        // light gathers around the face-down card while it hangs
        if (t < T.flip) {
          const r = big.getBoundingClientRect();
          if (Math.random() < 0.6) {
            fx.add({ kind: "mote", cx: r.left + r.width / 2, cy: r.top + r.height / 2, ang: Math.random() * Math.PI * 2,
              rad: 170 + Math.random() * 90, spin: 2.2, pull: 0.2, size: 1.2 + Math.random(), ttl: 1.2,
              color: Math.random() < 0.4 ? TIER[tier].hi : TIER[tier].c });
          }
        }
        if (t >= T.flip + 300) once("flip", () => {
          Sfx.flip();
          const r = big.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          if (tier === "blank") {
            for (let i = 0; i < 26; i++) {
              fx.add({ kind: "smoke", x: cx + (Math.random() - 0.5) * 120, y: cy + (Math.random() - 0.5) * 160,
                vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 40, size: 45 + Math.random() * 40, ttl: 2.4, color: "#9A97A8" });
            }
          } else {
            const n = { common: 50, rare: 80, epic: 120, legendary: 200 }[tier];
            fx.burst(cx, cy, [TIER[tier].c, TIER[tier].hi, "#FFFFFF"], n, tier === "legendary" ? 1.4 : 1);
            flashWash(tier === "legendary" ? 0.9 : tier === "epic" ? 0.6 : 0.35, 1400);
          }
        });
        if (t >= T.done) once("done", () => {
          Sfx.fanfare(tier);
          Ui.vibrate(tier === "blank" ? [0, 30, 90, 30] : tier === "legendary" ? [0, 60, 50, 60, 50, 60, 50, 220] : [0, 50, 50, 50, 50, 140]);
          hold(false);
          root.classList.add("finale");
          if (tier === "legendary") rays.animate([{ opacity: 0 }, { opacity: 0.85 }], { duration: 900, fill: "forwards" });
          cta.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }],
            { duration: 450, delay: 350, fill: "forwards", easing: "cubic-bezier(.22,1,.36,1)" });
        });
        // the finale keeps breathing until it is dismissed
        if (t >= T.done && tier === "legendary" && Math.random() < 0.18) {
          const r = big.getBoundingClientRect();
          fx.add({ kind: "dot", x: r.left - 30 + Math.random() * (r.width + 60), y: r.top + Math.random() * r.height * 1.2,
            vx: (Math.random() - 0.5) * 16, vy: -25 - Math.random() * 45, size: 0.8 + Math.random() * 1.4, ttl: 2.6,
            color: Math.random() < 0.5 ? TIER.legendary.hi : TIER.legendary.c });
        }
      }
    }

    const now = () => performance.now();
    const tierRankOf = (t) => Gold.tierRank(t);

    return new Promise((resolve) => {
      resolveFn = resolve;
      $(".rv-ok").addEventListener("click", () => {
        cancelAnimationFrame(raf);
        Sfx.whooshStop();
        Sfx.riserStop();
        root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: "forwards" });
        // a timer, not onfinish: a backgrounded page does not run animations
        setTimeout(() => {
          root.remove();
          document.body.classList.remove("revealing");
          playing = false;
          resolveFn();
        }, 280);
      }, { once: true });
      raf = requestAnimationFrame((n) => { last = n; frame(n); });
    });
  }

  return { idle, play, isPlaying: () => playing, TIER };
})();
