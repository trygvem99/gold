// Gold wheel — a machine, not a pie chart.
//
// Built from what real money wheels actually do: 48 pegs around the disc that
// a sprung clapper clatters over (5 dividers is why a web wheel feels dead),
// a bulb-studded rim, shaded wedges, and a tilted view so it reads as an
// object on a stand. Every peg makes a sound and a haptic on the same frame.
"use strict";

const Wheel = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Five acts. The last three exist so the reveal happens in a slow crawl over
  // one divider rather than in the spin.
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
  const PEGS = 48;
  const BULBS = 24;
  const PEG_ARC = 360 / PEGS;

  let host = null, stage = null;
  let prizes = [], angles = [], labelNodes = [];
  let disc = null, pegLayer = null, labels = null, pointer = null, flapper = null;
  let bulbNodes = [], bulbGroup = null;
  let rot = 0, spinning = false;

  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* unsupported */ } };

  // mix a hex colour toward white (amt > 0) or black (amt < 0)
  function shade(hex, amt) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    const to = amt > 0 ? 255 : 0;
    const k = Math.abs(amt);
    const ch = (s) => Math.round(((n >> s) & 255) * (1 - k) + to * k);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  function arcPath(cx, cy, r, startDeg, endDeg) {
    const a = ((startDeg - 90) * Math.PI) / 180;
    const b = ((endDeg - 90) * Math.PI) / 180;
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)} ` +
      `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)} Z`;
  }
  const pointAt = (cx, cy, r, deg) => [
    cx + r * Math.cos(((deg - 90) * Math.PI) / 180),
    cy + r * Math.sin(((deg - 90) * Math.PI) / 180),
  ];

  function baseDefs() {
    const d = el("defs");
    d.innerHTML =
      // the rim is a torus lit from above: light, shadow, light again
      '<linearGradient id="w-metal" x1="0.1" y1="0" x2="0.9" y2="1">' +
      '<stop offset="0%" stop-color="#FFF7E2"/><stop offset="15%" stop-color="#EFC65C"/>' +
      '<stop offset="38%" stop-color="#6E4A0C"/><stop offset="55%" stop-color="#C79A2A"/>' +
      '<stop offset="76%" stop-color="#FFEFC0"/><stop offset="100%" stop-color="#7A5510"/>' +
      "</linearGradient>" +
      '<linearGradient id="w-metal-v" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#FFF3D2"/><stop offset="50%" stop-color="#DEAE3E"/>' +
      '<stop offset="100%" stop-color="#7A5510"/></linearGradient>' +
      // fixed light on a moving surface: this is what sells the rotation
      '<linearGradient id="w-spec" x1="0.1" y1="0" x2="0.9" y2="1">' +
      '<stop offset="0%" stop-color="rgba(255,255,255,0.30)"/>' +
      '<stop offset="22%" stop-color="rgba(255,255,255,0.08)"/>' +
      '<stop offset="50%" stop-color="rgba(255,255,255,0)"/>' +
      '<stop offset="100%" stop-color="rgba(255,255,255,0.12)"/></linearGradient>' +
      '<radialGradient id="w-vig" cx="50%" cy="44%" r="54%">' +
      '<stop offset="0%" stop-color="rgba(0,0,0,0)"/>' +
      '<stop offset="58%" stop-color="rgba(0,0,0,0.06)"/>' +
      '<stop offset="100%" stop-color="rgba(0,0,0,0.55)"/></radialGradient>' +
      '<radialGradient id="w-hub" cx="40%" cy="32%" r="72%">' +
      '<stop offset="0%" stop-color="#33333F"/><stop offset="100%" stop-color="#07070B"/></radialGradient>' +
      '<radialGradient id="w-bulb" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="#FFFFFF"/><stop offset="35%" stop-color="#FFE9A8"/>' +
      '<stop offset="100%" stop-color="#E8A81F"/></radialGradient>' +
      '<filter id="w-drop" x="-70%" y="-70%" width="240%" height="240%">' +
      '<feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.65"/></filter>' +
      '<filter id="w-bulb-glow" x="-300%" y="-300%" width="700%" height="700%">' +
      '<feGaussianBlur stdDeviation="2.4"/></filter>';
    return d;
  }

  function render(hostEl, prizeList) {
    host = hostEl;
    stage = hostEl.parentElement;
    prizes = prizeList;
    angles = Gold.segmentAngles(prizes);
    labelNodes = [];
    bulbNodes = [];
    rot = 0;
    host.innerHTML = "";

    const size = Math.min(Math.max(250, window.innerWidth - 44), 350);
    const cx = size / 2, cy = size / 2;
    const rSeg = size / 2 - 24;
    const rimMid = rSeg + 12;

    const box = document.createElement("div");
    box.className = "wheel-box";
    box.style.width = size + "px";
    box.style.height = size + "px";

    const rays = document.createElement("div");
    rays.className = "rays";
    box.appendChild(rays);

    const svg = el("svg", { class: "wheel-svg", width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    const defs = baseDefs();
    svg.appendChild(defs);

    // per-wedge shading: lighter at the hub, darker at the rim, so a flat fill
    // stops looking like a chart
    prizes.forEach((p, i) => {
      const g = el("radialGradient", { id: `w-seg-${i}`, cx: "50%", cy: "50%", r: "50%" });
      g.innerHTML =
        `<stop offset="0%" stop-color="${shade(p.color, 0.30)}"/>` +
        `<stop offset="55%" stop-color="${shade(p.color, 0.04)}"/>` +
        `<stop offset="100%" stop-color="${shade(p.color, -0.34)}"/>`;
      defs.appendChild(g);
    });

    // ---- rotating disc ----
    disc = el("g", { class: "wheel-disc" });
    labels = el("g", { class: "wheel-labels" });

    prizes.forEach((p, i) => {
      const seg = angles[i];
      const span = seg.end - seg.start;
      const g = el("g");
      g.setAttribute("data-index", String(i));
      const fill = `url(#w-seg-${i})`;
      if (span >= 359.9) g.appendChild(el("circle", { cx, cy, r: rSeg, fill }));
      else g.appendChild(el("path", { d: arcPath(cx, cy, rSeg, seg.start, seg.end), fill }));
      disc.appendChild(g);

      if (span >= 13 && p.name) {
        const rText = rSeg * 0.60;
        const g2 = el("g");
        const t = el("text", {
          y: cy, "text-anchor": "middle", "dominant-baseline": "central", class: "wheel-label",
        });
        t.textContent = p.name.length > 15 ? p.name.slice(0, 14) + "…" : p.name;
        g2.appendChild(t);
        labels.appendChild(g2);
        labelNodes.push({ g: g2, text: t, mid: seg.mid, rText, cx, cy, flip: null });
      }
    });

    if (prizes.length > 1) {
      angles.forEach((seg) => {
        const [x, y] = pointAt(cx, cy, rSeg, seg.start);
        disc.appendChild(el("line", { x1: cx, y1: cy, x2: x, y2: y, class: "wheel-divider" }));
      });
    }
    disc.appendChild(labels);

    svg.appendChild(disc);

    // ---- fixed light and shade over the moving disc ----
    svg.appendChild(el("circle", { cx, cy, r: rSeg, fill: "url(#w-vig)", "pointer-events": "none" }));
    svg.appendChild(el("circle", { cx, cy, r: rSeg, fill: "url(#w-spec)", "pointer-events": "none" }));

    // 48 pegs: the clapper rides these, not the dividers — this is the clatter.
    // They rotate with the disc but are drawn above the vignette, which would
    // otherwise grey them out at exactly the radius they sit at.
    pegLayer = el("g", { class: "wheel-pegs" });
    for (let i = 0; i < PEGS; i++) {
      const [px, py] = pointAt(cx, cy, rSeg - 5, i * PEG_ARC);
      pegLayer.appendChild(el("circle", { cx: px, cy: py + 0.9, r: 2.6, class: "peg-shadow" }));
      pegLayer.appendChild(el("circle", { cx: px, cy: py, r: 2.6, class: "peg" }));
      pegLayer.appendChild(el("circle", { cx: px - 0.7, cy: py - 0.7, r: 0.9, class: "peg-hi" }));
    }
    svg.appendChild(pegLayer);

    // ---- rim ----
    svg.appendChild(el("circle", { cx, cy, r: rSeg + 2.5, fill: "none", stroke: "rgba(0,0,0,0.7)", "stroke-width": 5 }));
    svg.appendChild(el("circle", { cx, cy, r: rimMid, fill: "none", stroke: "url(#w-metal)", "stroke-width": 20 }));
    svg.appendChild(el("circle", { cx, cy, r: rimMid + 9.4, fill: "none", stroke: "rgba(255,255,255,0.32)", "stroke-width": 1 }));
    svg.appendChild(el("circle", { cx, cy, r: rimMid - 9.4, fill: "none", stroke: "rgba(255,255,255,0.2)", "stroke-width": 1 }));

    // ---- marquee bulbs, fixed to the rim ----
    bulbGroup = el("g", { class: "bulbs" });
    for (let i = 0; i < BULBS; i++) {
      const [bx, by] = pointAt(cx, cy, rimMid, (i * 360) / BULBS);
      const glow = el("circle", { cx: bx, cy: by, r: 3.6, fill: "#FFD97A", filter: "url(#w-bulb-glow)", class: "bulb-glow" });
      const b = el("circle", { cx: bx, cy: by, r: 2.6, fill: "url(#w-bulb)", class: "bulb" });
      bulbGroup.appendChild(glow);
      bulbGroup.appendChild(b);
      bulbNodes.push({ glow, bulb: b });
    }
    svg.appendChild(bulbGroup);

    // ---- hub ----
    const hub = el("g", { filter: "url(#w-drop)" });
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.23, fill: "url(#w-metal-v)" }));
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.175, fill: "url(#w-hub)" }));
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.175, fill: "none", stroke: "rgba(0,0,0,0.65)", "stroke-width": 1 }));
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.058, fill: "url(#w-metal-v)" }));
    svg.appendChild(hub);

    box.appendChild(svg);

    // ---- clapper: sprung, bends back as each peg shoves past ----
    pointer = el("svg", { class: "wheel-pointer", width: 40, height: 48, viewBox: "0 0 40 48" });
    pointer.innerHTML =
      "<defs>" +
      '<linearGradient id="w-ptr" x1="0" y1="0" x2="1" y2="0.3">' +
      '<stop offset="0%" stop-color="#7A5510"/><stop offset="26%" stop-color="#FFF7E2"/>' +
      '<stop offset="58%" stop-color="#EFC65C"/><stop offset="100%" stop-color="#6E4A0C"/>' +
      "</linearGradient>" +
      '<linearGradient id="w-boss" x1="0.2" y1="0" x2="0.8" y2="1">' +
      '<stop offset="0%" stop-color="#FFF7E2"/><stop offset="55%" stop-color="#DEAE3E"/>' +
      '<stop offset="100%" stop-color="#6E4A0C"/></linearGradient>' +
      "</defs>" +
      '<g filter="url(#w-drop)">' +
      '<path d="M20 45 L9 14 Q20 9 31 14 Z" fill="url(#w-ptr)" stroke="#0A0A0F" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M20 41.5 L15 15.5 Q20 13.8 20 13.8 Z" fill="#FFF6E0" opacity="0.34"/>' +
      '<circle cx="20" cy="9" r="9.5" fill="url(#w-boss)" stroke="#0A0A0F" stroke-width="1.5"/>' +
      '<circle cx="20" cy="9" r="3.4" fill="#0A0A0F" opacity="0.8"/>' +
      '<circle cx="16.8" cy="5.9" r="2.1" fill="#FFF6E0" opacity="0.85"/></g>';
    flapper = pointer.querySelector("g");
    box.appendChild(pointer);

    const ring = document.createElement("div");
    ring.className = "shock";
    box.appendChild(ring);

    host.appendChild(box);
    setVar("--heat", 0);
    setVar("--wscale", 1);
    setVar("--shx", "0px");
    setVar("--shy", "0px");
    setBulbs(null, 0);
    apply(0);
  }

  const setVar = (k, v) => stage && stage.style.setProperty(k, typeof v === "number" ? v.toFixed(3) : v);

  // Labels are children of the disc, so without this half of them are upside
  // down whenever it stops. Each flips as it passes the vertical, where radial
  // text is neither way up nor upside down, so the switch is invisible.
  function orientLabels(deg) {
    for (const l of labelNodes) {
      const screen = ((((l.mid + deg) % 360) + 360) % 360);
      const flip = screen > 180;
      if (l.flip === flip) continue;
      l.flip = flip;
      l.g.setAttribute("transform", `rotate(${l.mid - 90 + (flip ? 180 : 0)} ${l.cx} ${l.cy})`);
      l.text.setAttribute("x", flip ? l.cx - l.rText : l.cx + l.rText);
    }
  }

  function apply(deg) {
    rot = deg;
    if (disc) {
      const c = disc.ownerSVGElement.viewBox.baseVal.width / 2;
      const tr = `rotate(${deg.toFixed(3)} ${c} ${c})`;
      disc.setAttribute("transform", tr);
      if (pegLayer) pegLayer.setAttribute("transform", tr);
    }
    orientLabels(deg);
  }

  // Classic marquee chase: every third bulb lit, the pattern walking round.
  // `phase === null` lights them all — how the wheel sits when nothing is
  // happening. Unlit bulbs get a dark amber fill rather than low opacity,
  // which over a gold rim would just read as grey grime.
  function setBulbs(phase, heat) {
    const step = phase === null ? null : Math.floor(phase);
    for (let i = 0; i < bulbNodes.length; i++) {
      const on = step === null || (i + step) % 3 === 0;
      bulbNodes[i].bulb.setAttribute("fill", on ? "url(#w-bulb)" : "#8A6318");
      bulbNodes[i].glow.style.opacity = String(on ? 0.4 + heat * 0.6 : 0.03);
    }
  }

  function dim(winner) {
    if (!disc) return;
    disc.querySelectorAll("g[data-index]").forEach((g) => {
      const isWinner = Number(g.dataset.index) === winner;
      g.style.transition = "opacity 450ms ease, filter 450ms ease";
      g.style.opacity = winner === null || isWinner ? "1" : "0.18";
      g.style.filter = isWinner ? "brightness(1.3) saturate(1.25)" : "none";
    });
    if (labels) labels.style.opacity = "1";
  }

  const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const smoothstep = (p) => p * p * (3 - 2 * p);

  // Distance covered by a velocity curve that ramps up over RAMP and then
  // decays exponentially — torque released against constant friction. Velocity
  // is continuous at the join, so there is no visible kink.
  function travel(p) {
    const rampArea = 0.5 * RAMP;
    const decayed = (x) => ((1 - Math.exp(-DECAY * x)) * (1 - RAMP)) / DECAY;
    const total = rampArea + decayed(1);
    const d = p <= RAMP ? (0.5 * p * p) / RAMP : rampArea + decayed((p - RAMP) / (1 - RAMP));
    return d / total;
  }

  function spin(index, onDone) {
    if (spinning || !disc) return;
    spinning = true;
    dim(null);
    document.body.classList.add("spinning");
    Sfx.unlock();
    Sfx.whooshStart();

    const start = ((rot % 360) + 360) % 360;
    apply(start);
    const seg = angles[index];
    const span = seg.end - seg.start;
    const plan = Gold.landingPlan(index, angles);
    const windTo = start - WIND_DEG;
    const final = start + plan.rotation;
    const preStop = final - plan.creep;
    const rock = Math.min(2.2, span * 0.14);

    const T1 = WIND_MS, T2 = T1 + SPIN_MS_, T3 = T2 + HOLD_MS, T4 = T3 + CREEP_MS, T5 = T4 + SETTLE_MS;
    const t0 = performance.now();
    let lastSeg = Gold.segmentAt(angles, Gold.angleUnderPointer(start));
    let lastPeg = Math.floor(Gold.angleUnderPointer(start) / PEG_ARC);
    let lastDeg = start, lastClick = 0, lastBuzz = 0;
    let flick = 0, phase = 0, shake = 0, landed = false, tensed = false;

    vibrate([0, 12, 90, 18, 90, 26]);

    function frame(now) {
      const t = now - t0;
      let deg, heat, scale;

      if (t < T1) {
        const p = t / WIND_MS;
        deg = start + (windTo - start) * easeInOutCubic(p);
        heat = 0.55 * p;
        scale = 1 - 0.03 * easeInOutCubic(p);
      } else if (t < T2) {
        const p = (t - T1) / SPIN_MS_;
        deg = windTo + (preStop - windTo) * travel(p);
        heat = 0.25;
        scale = 0.97 + 0.085 * Math.min(1, p / 0.1);
      } else if (t < T3) {
        if (!tensed) { tensed = true; Sfx.tension(); Sfx.whooshSet(0); }
        const p = (t - T2) / HOLD_MS;
        deg = preStop + 0.22 * Math.sin(p * Math.PI * 7) * (1 - p);
        heat = 0.42 + 0.16 * Math.sin(p * Math.PI * 3);
        scale = 1.055;
      } else if (t < T4) {
        const p = (t - T3) / CREEP_MS;
        deg = preStop + plan.creep * smoothstep(p);
        heat = 0.45 + 0.55 * smoothstep(p);
        scale = 1.055 + 0.045 * smoothstep(p);
      } else if (t < T5) {
        const u = (t - T4) / SETTLE_MS;
        deg = final + rock * Math.exp(-5.4 * u) * Math.cos(2 * Math.PI * 1.5 * u);
        heat = 1;
        scale = 1.1 - 0.08 * easeInOutCubic(u);
      } else {
        deg = final;
        heat = Math.max(0, 1 - (t - T5) / FLASH_MS);
        scale = 1.02;
      }

      const speed = Math.abs(deg - lastDeg);
      const v = clamp(speed / 12, 0, 1);
      lastDeg = deg;
      apply(deg);

      if (!REDUCED) {
        setVar("--heat", Math.max(heat, v));
        setVar("--wscale", scale);
        disc.style.filter = speed > 2.2 ? `blur(${clamp((speed - 2.2) * 0.3, 0, 3).toFixed(2)}px)` : "none";
        Sfx.whooshSet(v);

        phase += 0.25 + v * 2.2;
        setBulbs(phase, heat);

        const under = Gold.angleUnderPointer(deg);
        const pegNow = Math.floor(under / PEG_ARC);
        if (pegNow !== lastPeg) {
          lastPeg = pegNow;
          flick = Math.max(flick, clamp(4 + speed * 1.4, 4, 17));
          // above ~33 hits a second the ear hears a buzz anyway, so throttle
          if (now - lastClick > 30) { lastClick = now; Sfx.peg(v); }
          if (now - lastBuzz > (v > 0.35 ? 90 : 34)) {
            lastBuzz = now;
            vibrate(clamp(Math.round(4 + speed * 1.4), 4, 14));
          }
        }

        const s = Gold.segmentAt(angles, under);
        if (s !== lastSeg) {
          lastSeg = s;
          if (t >= T3 && t < T4) {           // the one crossing that decides it
            flick = 26;
            shake = 9;
            vibrate(75);
            Sfx.clunk();
            pulse(".wheel-box", "hit");
          }
        }

        shake *= 0.86;
        if (shake > 0.15) {
          setVar("--shx", (Math.random() - 0.5) * shake * 2 + "px");
          setVar("--shy", (Math.random() - 0.5) * shake * 2 + "px");
        } else {
          setVar("--shx", "0px"); setVar("--shy", "0px");
        }

        flick *= 0.84;
        flapper.setAttribute("transform", `rotate(${flick.toFixed(2)} 20 9)`);
        labels.style.opacity = String(clamp(1 - speed / 12, 0.08, 1));
      }

      if (t < T5) requestAnimationFrame(frame);
      else if (t < SPIN_MS) { if (!landed) land(index); requestAnimationFrame(frame); }
      else finish(onDone);
    }

    function land(i) {
      landed = true;
      flapper.setAttribute("transform", "rotate(0 20 9)");
      disc.style.filter = "none";
      dim(i);
      Sfx.whooshStop();
      Sfx.win();
      pulse(".shock", "go");
      pulse(".rays", "go");
      if (bulbGroup) bulbGroup.classList.add("strobe");
      shake = 14;
      vibrate([0, 60, 55, 60, 55, 170]);
    }

    function finish(cb) {
      spinning = false;
      document.body.classList.remove("spinning");
      if (bulbGroup) bulbGroup.classList.remove("strobe");
      setVar("--wscale", 1);
      setVar("--heat", 0);
      setVar("--shx", "0px");
      setVar("--shy", "0px");
      setBulbs(null, 0);
      Sfx.whooshStop();
      if (!landed) land(index);
      cb && cb();
    }

    requestAnimationFrame(frame);
  }

  function pulse(sel, cls) {
    const n = host && host.querySelector(sel);
    if (!n) return;
    n.classList.remove(cls);
    void n.offsetWidth;
    n.classList.add(cls);
  }

  const isSpinning = () => spinning;

  // ---------- confetti ----------

  function burst(color) {
    if (REDUCED) return;
    const canvas = document.getElementById("confetti");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = window.innerWidth, h = window.innerHeight;
    const colors = [color, "#FFD97A", "#E8B94A", "#FFF3D0"];
    const parts = [];
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 13;
      parts.push({
        x: w / 2, y: h * 0.42,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 6,
        w: 4 + Math.random() * 5, h: 6 + Math.random() * 8,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.45,
        flip: Math.random() * Math.PI, vf: 0.12 + Math.random() * 0.16,
        color: colors[(Math.random() * colors.length) | 0], life: 1,
      });
    }

    let raf;
    function frame() {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.34; p.vx *= 0.99;
        p.x += p.vx; p.y += p.vy;
        p.rot += p.vr; p.flip += p.vf;
        p.life -= 0.0072;
        if (p.life <= 0 || p.y > h + 40) continue;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.flip)); // tumbling: edge-on twice a rotation
        ctx.globalAlpha = clamp(p.life, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive > 0) raf = requestAnimationFrame(frame);
      else { cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); }
    }
    frame();
  }

  return { render, spin, burst, isSpinning, vibrate, SPIN_MS };
})();
