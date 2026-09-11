// Gold wheel — a dial, not a pie.
//
// Luminous arc segments on the outer ring over smoked glass; a core that reads
// out whatever sits under the indicator, live, so a prize name never has to
// fit inside its wedge; labels sized to their own wedge and kept upright while
// the ring turns under them; flick to spin. Effects are made of light.
// The spin physics are unchanged: five acts, the reveal in the final creep.
"use strict";

const Wheel = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const WIND_MS = REDUCED ? 0 : 1000;
  const SPIN_MS_ = REDUCED ? 700 : 6000;
  const HOLD_MS = REDUCED ? 0 : 420;
  const CREEP_MS = REDUCED ? 200 : 1200;
  const SETTLE_MS = REDUCED ? 0 : 700;
  const FLASH_MS = REDUCED ? 0 : 800;
  const SPIN_MS = WIND_MS + SPIN_MS_ + HOLD_MS + CREEP_MS + SETTLE_MS + FLASH_MS;
  const WIND_DEG = 16;
  const RAMP = 0.075;
  const DECAY = 4.4;
  const TICKS = 48;
  const TICK_ARC = 360 / TICKS;

  let host = null, stage = null, box = null;
  let prizes = [], angles = [];
  let disc = null, arcs = [], railA = null, railB = null;
  let labelEls = [], readout = null, readoutName = null, readoutIcon = null;
  let sweep = null, indicator = null, indicatorHalo = null;
  let S = 0, C = 0, R = 0, RIN = 0, HUB = 0, RL = 0;
  let rot = 0, spinning = false, launch = null;

  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const div = (cls) => { const d = document.createElement("div"); d.className = cls; return d; };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* unsupported */ } };
  const pointAt = (r, deg) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)];

  // Any stored colour, however muddy, rendered as a light-emitting stroke:
  // force saturation up and lightness into the band where it reads as glow.
  function luminous(hex, l) {
    const n = parseInt(String(hex || "#888").replace("#", ""), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    const d = max - min;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return `hsl(${h.toFixed(0)} 82% ${(l == null ? 66 : l)}%)`;
  }
  const glowOf = (hex, a) => luminous(hex).replace(")", ` / ${a})`);

  function annulus(r0, r1, a0, a1) {
    const [x0, y0] = pointAt(r1, a0), [x1, y1] = pointAt(r1, a1);
    const [x2, y2] = pointAt(r0, a1), [x3, y3] = pointAt(r0, a0);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
  }
  function wedge(r, a0, a1) {
    const [x0, y0] = pointAt(r, a0), [x1, y1] = pointAt(r, a1);
    return `M ${C} ${C} L ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1} Z`;
  }

  // ---------- build ----------

  function render(hostEl, prizeList) {
    host = hostEl;
    stage = hostEl.parentElement;
    prizes = prizeList;
    angles = Gold.segmentAngles(prizes);
    rot = 0;
    arcs = []; labelEls = [];
    host.innerHTML = "";

    S = Math.min(Math.max(260, window.innerWidth - 40), 360);
    C = S / 2;
    R = C - 12;            // outer edge of the luminous band
    RIN = R * 0.84;        // inner edge of the band
    HUB = R * 0.36;        // core radius
    RL = HUB + (RIN - HUB) * 0.56; // label orbit

    box = div("wheel-box");
    box.style.width = S + "px";
    box.style.height = S + "px";

    box.appendChild(div("wheel-orb"));

    const svg = el("svg", { class: "wheel-svg", width: S, height: S, viewBox: `0 0 ${S} ${S}` });
    const defs = el("defs");
    defs.innerHTML =
      '<radialGradient id="w-glass" cx="50%" cy="42%" r="60%">' +
      '<stop offset="0%" stop-color="#171A24"/><stop offset="70%" stop-color="#0B0C12"/>' +
      '<stop offset="100%" stop-color="#05060A"/></radialGradient>' +
      '<radialGradient id="w-core" cx="50%" cy="38%" r="65%">' +
      '<stop offset="0%" stop-color="#1B1F2C"/><stop offset="100%" stop-color="#07080D"/></radialGradient>' +
      '<linearGradient id="w-sheen" x1="0.15" y1="0" x2="0.85" y2="1">' +
      '<stop offset="0%" stop-color="rgba(255,255,255,0.14)"/>' +
      '<stop offset="45%" stop-color="rgba(255,255,255,0)"/>' +
      '<stop offset="100%" stop-color="rgba(255,255,255,0.05)"/></linearGradient>';
    svg.appendChild(defs);

    // orbit rails: thin dashed rings outside the band, counter-rotating
    railA = el("circle", { cx: C, cy: C, r: R + 6, class: "rail rail-a" });
    railB = el("circle", { cx: C, cy: C, r: R + 10, class: "rail rail-b" });
    svg.appendChild(railA);
    svg.appendChild(railB);

    // the disc: glass, faint wedge tints, the band, the tick scale
    disc = el("g", { class: "wheel-disc" });
    disc.appendChild(el("circle", { cx: C, cy: C, r: RIN + 1, fill: "url(#w-glass)" }));

    prizes.forEach((p, i) => {
      const a = angles[i];
      if (a.end - a.start <= 0) return;
      const full = a.end - a.start >= 359.9;
      if (!p.blank) {
        disc.appendChild(full
          ? el("circle", { cx: C, cy: C, r: RIN, fill: glowOf(p.color, 0.07) })
          : el("path", { d: wedge(RIN, a.start, a.end), fill: glowOf(p.color, 0.07) }));
      }
    });

    for (let i = 0; i < prizes.length; i++) {
      const [x, y] = pointAt(RIN, angles[i].start);
      const [x2, y2] = pointAt(HUB + 4, angles[i].start);
      if (prizes.length > 1) disc.appendChild(el("line", { x1: x2, y1: y2, x2: x, y2: y, class: "wheel-divider" }));
    }

    // luminous band: halo, then the arc, then a bright inner edge
    prizes.forEach((p, i) => {
      const a = angles[i];
      if (a.end - a.start <= 0) return;
      const full = a.end - a.start >= 359.9;
      const g = el("g", { class: "arc" + (p.blank ? " arc-blank" : "") });
      g.setAttribute("data-index", String(i));
      const gap = full ? 0 : 0.5;
      const mk = (r0, r1, attrs) => full
        ? el("path", Object.assign({ d: annulus(r0, r1, 0, 359.99) }, attrs))
        : el("path", Object.assign({ d: annulus(r0, r1, a.start + gap, a.end - gap) }, attrs));
      if (p.blank) {
        g.appendChild(mk(RIN, R, { fill: "rgba(255,255,255,0.045)", stroke: "rgba(255,255,255,0.10)", "stroke-width": 1 }));
      } else {
        g.appendChild(mk(RIN - 9, R + 9, { fill: glowOf(p.color, 0.10), class: "arc-halo" }));
        g.appendChild(mk(RIN - 3, R + 3, { fill: glowOf(p.color, 0.22), class: "arc-halo" }));
        g.appendChild(mk(RIN, R, { fill: luminous(p.color, 62), class: "arc-body" }));
        g.appendChild(mk(RIN, RIN + 2.2, { fill: luminous(p.color, 84) }));
      }
      disc.appendChild(g);
      arcs.push(g);
    });

    // instrument scale just inside the band — the indicator ticks over these
    const scale = el("g", { class: "wheel-ticks" });
    for (let i = 0; i < TICKS; i++) {
      const major = i % 4 === 0;
      const [x0, y0] = pointAt(RIN - 4, i * TICK_ARC);
      const [x1, y1] = pointAt(RIN - (major ? 13 : 8), i * TICK_ARC);
      scale.appendChild(el("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: major ? "tick major" : "tick" }));
    }
    disc.appendChild(scale);
    svg.appendChild(disc);

    // fixed light over the moving glass
    svg.appendChild(el("circle", { cx: C, cy: C, r: RIN, fill: "url(#w-sheen)", "pointer-events": "none" }));
    // core
    svg.appendChild(el("circle", { cx: C, cy: C, r: HUB + 6, fill: "rgba(0,0,0,0.55)" }));
    svg.appendChild(el("circle", { cx: C, cy: C, r: HUB, fill: "url(#w-core)", stroke: "rgba(255,255,255,0.10)", "stroke-width": 1 }));
    svg.appendChild(el("circle", { cx: C, cy: C, r: HUB - 5, fill: "none", stroke: "rgba(255,255,255,0.05)", "stroke-width": 1 }));
    box.appendChild(svg);

    // scanning sweep, ring-masked, only visible while it runs
    sweep = div("wheel-sweep");
    box.appendChild(sweep);

    // upright labels that orbit with their wedge
    prizes.forEach((p, i) => {
      const a = angles[i];
      const span = a.end - a.start;
      const l = div("wheel-tag" + (p.blank ? " blank" : ""));
      l.textContent = p.name || "";
      l.style.color = p.blank ? "" : luminous(p.color, 80);
      l.dataset.index = String(i);
      l.hidden = span < 6 || !p.name;
      box.appendChild(l);
      labelEls.push({ el: l, mid: a.mid, span });
    });

    // the core readout
    readout = div("wheel-readout");
    readout.style.width = readout.style.height = HUB * 2 - 14 + "px";
    readoutIcon = div("readout-icon");
    readoutName = div("readout-name");
    readout.appendChild(readoutIcon);
    readout.appendChild(readoutName);
    box.appendChild(readout);

    // the indicator: a slim light at the top with a beam onto the band
    indicator = div("wheel-indicator");
    indicatorHalo = div("indicator-halo");
    indicator.appendChild(indicatorHalo);
    indicator.appendChild(div("indicator-bar"));
    indicator.appendChild(div("indicator-beam"));
    box.appendChild(indicator);

    box.appendChild(div("shock"));
    host.appendChild(box);

    setVar("--heat", 0);
    setVar("--wscale", 1);
    setVar("--shx", "0px");
    setVar("--shy", "0px");
    stage.style.setProperty("--accent", "#9BB8FF");
    sizeLabels();
    apply(0);
    readAt(0, "rest");
    bindDrag();
  }

  const setVar = (k, v) => stage && stage.style.setProperty(k, typeof v === "number" ? v.toFixed(3) : v);

  // Each label gets the type its own wedge can carry: width from the chord at
  // the label orbit, height from the band-to-core gap. Start big and shrink
  // until it wraps cleanly.
  function sizeLabels() {
    const h = (RIN - HUB) * 0.78;
    for (const l of labelEls) {
      if (l.el.hidden) continue;
      const half = ((l.span / 2) * Math.PI) / 180;
      const w = Math.min(2 * RL * Math.sin(half) * 0.92, (RIN - HUB) * 1.9);
      l.el.style.width = w.toFixed(1) + "px";
      let size = clamp(Math.round(w / 5.2), 8, 24);
      l.el.style.fontSize = size + "px";
      for (let k = 0; k < 20 && (l.el.scrollHeight > h || l.el.scrollWidth > w + 1); k++) {
        size -= 1;
        if (size < 8) { l.el.hidden = true; break; }
        l.el.style.fontSize = size + "px";
      }
    }
  }

  function apply(deg) {
    rot = deg;
    if (!disc) return;
    disc.setAttribute("transform", `rotate(${deg.toFixed(3)} ${C} ${C})`);
    for (const l of labelEls) {
      if (l.el.hidden) continue;
      const [x, y] = pointAt(RL, l.mid + deg);
      l.el.style.transform = `translate(${(x - C).toFixed(2)}px, ${(y - C).toFixed(2)}px) translate(-50%, -50%)`;
    }
    if (railA) railA.setAttribute("transform", `rotate(${(-deg * 0.35).toFixed(3)} ${C} ${C})`);
    if (railB) railB.setAttribute("transform", `rotate(${(deg * 0.6).toFixed(3)} ${C} ${C})`);
    if (sweep) sweep.style.transform = `rotate(${(deg * 1.4).toFixed(2)}deg)`;
  }

  // The readout shows whatever is under the indicator. Throttled at speed so
  // it flickers between names rather than smearing.
  let readIdx = -1, lastRead = 0;
  function readAt(deg, mode, now) {
    const idx = Gold.segmentAt(angles, Gold.angleUnderPointer(deg));
    if (mode === "spin" && now - lastRead < 70 && idx !== readIdx) return;
    if (idx === readIdx && mode !== "lock") return;
    readIdx = idx;
    lastRead = now || 0;
    const p = prizes[idx];
    if (!p) return;
    readoutName.textContent = p.blank ? "nothing" : p.name;
    readoutIcon.textContent = mode === "lock" && !p.blank ? (p.emoji || "") : "";
    readout.classList.toggle("blank", !!p.blank);
    readout.classList.toggle("lock", mode === "lock");
    readout.classList.toggle("rest", mode === "rest");
    stage.style.setProperty("--accent", p.blank ? "#6C6F80" : luminous(p.color, 70));
  }

  function dim(winner) {
    for (const g of arcs) {
      const w = winner !== null && Number(g.dataset.index) === winner;
      g.classList.toggle("win", w);
      g.classList.toggle("lose", winner !== null && !w);
    }
    for (const l of labelEls) {
      const w = winner !== null && Number(l.el.dataset.index) === winner;
      l.el.classList.toggle("win", w);
      l.el.classList.toggle("lose", winner !== null && !w);
    }
  }

  // ---------- motion ----------

  const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const smoothstep = (p) => p * p * (3 - 2 * p);

  // Distance covered by a velocity curve that ramps up over `ramp` and then
  // decays exponentially — torque released against constant friction.
  function travel(p, ramp) {
    if (ramp <= 0) return (1 - Math.exp(-DECAY * p)) / (1 - Math.exp(-DECAY));
    const rampArea = 0.5 * ramp;
    const decayed = (x) => ((1 - Math.exp(-DECAY * x)) * (1 - ramp)) / DECAY;
    const total = rampArea + decayed(1);
    const d = p <= ramp ? (0.5 * p * p) / ramp : rampArea + decayed((p - ramp) / (1 - ramp));
    return d / total;
  }

  function spin(index, onDone, opts) {
    const o = opts || {};
    const blank = !!o.blank;
    if (spinning || !disc) return;
    spinning = true;
    dim(null);
    document.body.classList.add("spinning");
    box.classList.remove("idle");
    Sfx.unlock();
    Sfx.whooshStart();

    // a flick has already done the wind-up and is already moving
    const wind = o.flick ? 0 : WIND_MS;
    const ramp = o.flick ? 0 : RAMP;
    const start = ((rot % 360) + 360) % 360;
    apply(start);
    const seg = angles[index];
    const span = seg.end - seg.start;
    const plan = Gold.landingPlan(index, angles);
    const windTo = start - (o.flick ? 0 : WIND_DEG);
    const final = start + plan.rotation;
    const preStop = final - plan.creep;
    const rock = Math.min(2.2, span * 0.14);

    const T1 = wind, T2 = T1 + SPIN_MS_, T3 = T2 + HOLD_MS, T4 = T3 + CREEP_MS, T5 = T4 + SETTLE_MS;
    const END = T5 + FLASH_MS;
    const t0 = performance.now();
    let lastSeg = Gold.segmentAt(angles, Gold.angleUnderPointer(start));
    let lastTick = Math.floor(Gold.angleUnderPointer(start) / TICK_ARC);
    let lastDeg = start, lastClick = 0, lastBuzz = 0;
    let pulse = 0, shake = 0, landed = false, tensed = false;

    if (!o.flick) vibrate([0, 12, 90, 18, 90, 26]);

    function frame(now) {
      const t = now - t0;
      let deg, heat, scale;

      if (t < T1) {
        const p = t / wind;
        deg = start + (windTo - start) * easeInOutCubic(p);
        heat = 0.5 * p;
        scale = 1 - 0.025 * easeInOutCubic(p);
      } else if (t < T2) {
        const p = (t - T1) / SPIN_MS_;
        deg = windTo + (preStop - windTo) * travel(p, ramp);
        heat = 0.3;
        scale = 0.975 + 0.075 * Math.min(1, p / 0.1);
      } else if (t < T3) {
        if (!tensed) { tensed = true; Sfx.tension(); Sfx.whooshSet(0); }
        const p = (t - T2) / HOLD_MS;
        deg = preStop + 0.22 * Math.sin(p * Math.PI * 7) * (1 - p);
        heat = 0.45 + 0.18 * Math.sin(p * Math.PI * 3);
        scale = 1.05;
      } else if (t < T4) {
        const p = (t - T3) / CREEP_MS;
        deg = preStop + plan.creep * smoothstep(p);
        heat = 0.5 + 0.5 * smoothstep(p);
        scale = 1.05 + 0.04 * smoothstep(p);
      } else if (t < T5) {
        const u = (t - T4) / SETTLE_MS;
        deg = final + rock * Math.exp(-5.4 * u) * Math.cos(2 * Math.PI * 1.5 * u);
        heat = 1;
        scale = 1.09 - 0.07 * easeInOutCubic(u);
      } else {
        deg = final;
        heat = Math.max(0.15, 1 - (t - T5) / FLASH_MS);
        scale = 1.02;
      }

      const speed = Math.abs(deg - lastDeg);
      const v = clamp(speed / 12, 0, 1);
      lastDeg = deg;
      apply(deg);
      readAt(deg, t < T5 ? "spin" : "lock", now);

      if (!REDUCED) {
        setVar("--heat", Math.max(heat, v));
        setVar("--wscale", scale);
        disc.style.filter = speed > 2.2 ? `blur(${clamp((speed - 2.2) * 0.3, 0, 3).toFixed(2)}px)` : "none";
        Sfx.whooshSet(v);

        const under = Gold.angleUnderPointer(deg);
        const tickNow = Math.floor(under / TICK_ARC);
        if (tickNow !== lastTick) {
          lastTick = tickNow;
          pulse = 1;
          if (now - lastClick > 30) { lastClick = now; Sfx.peg(v); }
          if (now - lastBuzz > (v > 0.35 ? 90 : 34)) {
            lastBuzz = now;
            vibrate(clamp(Math.round(4 + speed * 1.4), 4, 14));
          }
        }

        const s = Gold.segmentAt(angles, under);
        if (s !== lastSeg) {
          lastSeg = s;
          if (t >= T3 && t < T4) {
            pulse = 1.6;
            shake = 8;
            vibrate(75);
            Sfx.clunk();
            box.classList.remove("hit"); void box.offsetWidth; box.classList.add("hit");
          }
        }

        pulse *= 0.82;
        indicatorHalo.style.opacity = String(0.25 + Math.min(1, pulse) * 0.75);
        indicatorHalo.style.transform = `translate(-50%, -50%) scale(${(1 + Math.min(1.6, pulse) * 0.9).toFixed(3)})`;

        shake *= 0.86;
        setVar("--shx", shake > 0.15 ? (Math.random() - 0.5) * shake * 2 + "px" : "0px");
        setVar("--shy", shake > 0.15 ? (Math.random() - 0.5) * shake * 2 + "px" : "0px");
      }

      if (t < T5) requestAnimationFrame(frame);
      else if (t < END) { if (!landed) land(index); requestAnimationFrame(frame); }
      else finish(onDone);
    }

    function land(i) {
      landed = true;
      disc.style.filter = "none";
      dim(i);
      readAt(final, "lock", performance.now());
      Sfx.whooshStop();
      if (blank) {
        Sfx.blank();
        shake = 4;
        vibrate([0, 30, 90, 30]);
      } else {
        Sfx.win();
        const ring = box.querySelector(".shock");
        ring.classList.remove("go"); void ring.offsetWidth; ring.classList.add("go");
        box.classList.add("won");
        shake = 12;
        vibrate([0, 60, 55, 60, 55, 170]);
      }
    }

    function finish(cb) {
      spinning = false;
      document.body.classList.remove("spinning");
      box.classList.remove("won");
      box.classList.add("idle");
      setVar("--wscale", 1);
      setVar("--heat", 0);
      setVar("--shx", "0px");
      setVar("--shy", "0px");
      indicatorHalo.style.opacity = "";
      indicatorHalo.style.transform = "";
      Sfx.whooshStop();
      if (!landed) land(index);
      cb && cb();
    }

    requestAnimationFrame(frame);
  }

  // Let go with no ticket, or backwards: just run down.
  function coast(v0) {
    let v = v0, last = performance.now();
    function f(now) {
      const dt = (now - last) / 1000;
      last = now;
      v *= Math.pow(0.12, dt);
      apply(rot + v * dt);
      readAt(rot, "rest");
      if (Math.abs(v) > 6 && !spinning) requestAnimationFrame(f);
    }
    requestAnimationFrame(f);
  }

  // ---------- flick to spin ----------

  function bindDrag() {
    box.classList.add("idle");
    let dragging = false, lastA = 0, samples = [];
    const angleOf = (e) => {
      const r = box.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      return (Math.atan2(dx, -dy) * 180) / Math.PI;
    };
    box.addEventListener("pointerdown", (e) => {
      if (spinning) return;
      dragging = true;
      samples = [];
      lastA = angleOf(e);
      box.classList.remove("idle");
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const a = angleOf(e);
      let d = a - lastA;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      lastA = a;
      apply(rot + d);
      readAt(rot, "rest");
      samples.push([performance.now(), rot]);
      if (samples.length > 6) samples.shift();
    });
    const up = () => {
      if (!dragging) return;
      dragging = false;
      let v = 0;
      if (samples.length >= 2) {
        const [t0, r0] = samples[0], [t1, r1] = samples[samples.length - 1];
        if (t1 > t0) v = ((r1 - r0) / (t1 - t0)) * 1000;
      }
      // a real forward flick launches; anything else just runs down
      if (v > 220 && launch && launch({ flick: true }) !== false) return;
      box.classList.add("idle");
      if (Math.abs(v) > 20) coast(v);
    };
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
  }

  // ---------- sparks ----------

  function burst(color) {
    if (REDUCED) return;
    const canvas = document.getElementById("confetti");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = window.innerWidth, h = window.innerHeight;
    const tint = luminous(color, 72), hot = luminous(color, 90);
    const parts = [];
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 9;
      parts.push({ x: w / 2, y: h * 0.42, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        len: 4 + Math.random() * 10, life: 0.8 + Math.random() * 0.5, c: Math.random() < 0.3 ? hot : tint });
    }
    let raf;
    function frame() {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.09; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.life -= 0.014;
        if (p.life <= 0) continue;
        alive++;
        const m = Math.hypot(p.vx, p.vy) || 1;
        ctx.globalAlpha = clamp(p.life, 0, 1);
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / m) * p.len, p.y - (p.vy / m) * p.len);
        ctx.stroke();
      }
      if (alive > 0) raf = requestAnimationFrame(frame);
      else { cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); }
    }
    frame();
  }

  const isSpinning = () => spinning;
  const setLaunchHandler = (fn) => { launch = fn; };

  return { render, spin, burst, isSpinning, vibrate, SPIN_MS, setLaunchHandler, luminous };
})();
