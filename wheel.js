// Gold wheel — SVG segments under a fixed specular highlight, hand-driven spin
// with wind-up, exponential friction and a damped settle. Knows nothing about
// habits or tickets: it is handed a prize list and a winning index.
"use strict";

const Wheel = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Five acts. The point of the last three is that the wheel comes to a near
  // halt one notch short of the prize, hangs there, and then tips over the
  // divider — the reveal happens in the creep, not in the spin.
  const WIND_MS = REDUCED ? 0 : 1000;   // draw back against the brake
  const SPIN_MS_ = REDUCED ? 700 : 6000; // release, accelerate, then friction
  const HOLD_MS = REDUCED ? 0 : 340;    // hanging on the peg
  const CREEP_MS = REDUCED ? 200 : 1150; // tipping over into the winner
  const SETTLE_MS = REDUCED ? 0 : 650;  // rocking into place
  const FLASH_MS = REDUCED ? 0 : 700;   // the beat before the prize is named
  const SPIN_MS = WIND_MS + SPIN_MS_ + HOLD_MS + CREEP_MS + SETTLE_MS + FLASH_MS;
  const WIND_DEG = 16;
  const RAMP = 0.075; // fraction of the spin act spent accelerating
  const DECAY = 4.4;  // friction constant: higher = longer crawl at the end

  let host = null;
  let prizes = [];
  let angles = [];
  let disc = null;
  let labels = null;
  let labelNodes = [];
  let pointer = null;
  let flapper = null;
  let rot = 0;
  let spinning = false;

  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* unsupported */ } };
  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

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

  function defs(size) {
    const d = el("defs");
    d.innerHTML =
      // the rim is a torus lit from above: light, shadow, light again
      '<linearGradient id="w-metal" x1="0.1" y1="0" x2="0.9" y2="1">' +
      '<stop offset="0%" stop-color="#FFF4D6"/><stop offset="18%" stop-color="#E8B94A"/>' +
      '<stop offset="42%" stop-color="#7A5510"/><stop offset="58%" stop-color="#B78B24"/>' +
      '<stop offset="78%" stop-color="#F3D389"/><stop offset="100%" stop-color="#8A6318"/>' +
      "</linearGradient>" +
      '<linearGradient id="w-metal-v" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#FFF0C4"/><stop offset="50%" stop-color="#D8A93C"/>' +
      '<stop offset="100%" stop-color="#8A6318"/></linearGradient>' +
      // fixed light on a moving surface: this is what sells the rotation
      '<linearGradient id="w-spec" x1="0.12" y1="0" x2="0.85" y2="1">' +
      '<stop offset="0%" stop-color="rgba(255,255,255,0.26)"/>' +
      '<stop offset="20%" stop-color="rgba(255,255,255,0.07)"/>' +
      '<stop offset="46%" stop-color="rgba(255,255,255,0)"/>' +
      '<stop offset="82%" stop-color="rgba(255,255,255,0.03)"/>' +
      '<stop offset="100%" stop-color="rgba(255,255,255,0.10)"/></linearGradient>' +
      '<radialGradient id="w-vig" cx="50%" cy="46%" r="52%">' +
      '<stop offset="0%" stop-color="rgba(0,0,0,0)"/>' +
      '<stop offset="62%" stop-color="rgba(0,0,0,0.10)"/>' +
      '<stop offset="100%" stop-color="rgba(0,0,0,0.52)"/></radialGradient>' +
      '<radialGradient id="w-hub" cx="42%" cy="34%" r="70%">' +
      '<stop offset="0%" stop-color="#2A2A38"/><stop offset="100%" stop-color="#08080C"/></radialGradient>' +
      `<filter id="w-drop" x="-60%" y="-60%" width="220%" height="220%">` +
      '<feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.6"/></filter>';
    return d;
  }

  function render(hostEl, prizeList) {
    host = hostEl;
    prizes = prizeList;
    angles = Gold.segmentAngles(prizes);
    rot = 0;
    host.innerHTML = "";

    const size = Math.min(Math.max(240, window.innerWidth - 56), 340);
    const cx = size / 2, cy = size / 2;
    const rSeg = size / 2 - 22;
    const rimMid = rSeg + 11;

    const box = document.createElement("div");
    box.className = "wheel-box";
    box.style.width = size + "px";
    box.style.height = size + "px";

    const svg = el("svg", { class: "wheel-svg", width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    svg.appendChild(defs(size));

    // ---- rotating disc ----
    disc = el("g", { class: "wheel-disc" });
    labels = el("g", { class: "wheel-labels" });
    labelNodes = [];

    prizes.forEach((p, i) => {
      const seg = angles[i];
      const span = seg.end - seg.start;
      const g = el("g");
      g.setAttribute("data-index", String(i));
      if (span >= 359.9) {
        g.appendChild(el("circle", { cx, cy, r: rSeg, fill: p.color }));
      } else {
        g.appendChild(el("path", { d: arcPath(cx, cy, rSeg, seg.start, seg.end), fill: p.color }));
      }
      disc.appendChild(g);

      if (span >= 14 && p.name) {
        // radial text, re-oriented as the wheel turns (see orientLabels)
        const rText = rSeg * 0.62;
        const g2 = el("g");
        const t = el("text", {
          y: cy, "text-anchor": "middle", "dominant-baseline": "central", class: "wheel-label",
        });
        t.textContent = p.name.length > 16 ? p.name.slice(0, 15) + "…" : p.name;
        g2.appendChild(t);
        labels.appendChild(g2);
        labelNodes.push({ g: g2, text: t, mid: seg.mid, rText, cx, cy, flip: null });
      }
    });

    // dividers and the pegs the flapper rides over
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

    // ---- rim ----
    svg.appendChild(el("circle", { cx, cy, r: rSeg + 2, fill: "none", stroke: "rgba(0,0,0,0.65)", "stroke-width": 4 }));
    svg.appendChild(el("circle", { cx, cy, r: rimMid, fill: "none", stroke: "url(#w-metal)", "stroke-width": 18 }));
    svg.appendChild(el("circle", { cx, cy, r: rimMid + 8.4, fill: "none", stroke: "rgba(255,255,255,0.30)", "stroke-width": 1 }));
    svg.appendChild(el("circle", { cx, cy, r: rimMid - 8.4, fill: "none", stroke: "rgba(255,255,255,0.18)", "stroke-width": 1 }));

    // ---- hub ----
    const hub = el("g", { filter: "url(#w-drop)" });
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.215, fill: "url(#w-metal-v)" }));
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.168, fill: "url(#w-hub)" }));
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.168, fill: "none", stroke: "rgba(0,0,0,0.6)", "stroke-width": 1 }));
    hub.appendChild(el("circle", { cx, cy, r: rSeg * 0.055, fill: "url(#w-metal-v)" }));
    svg.appendChild(hub);

    box.appendChild(svg);

    // ---- flapper ----
    pointer = el("svg", { class: "wheel-pointer", width: 40, height: 46, viewBox: "0 0 40 46" });
    pointer.innerHTML =
      '<defs>' +
      '<linearGradient id="w-ptr" x1="0" y1="0" x2="1" y2="0.3">' +
      '<stop offset="0%" stop-color="#8A6318"/><stop offset="26%" stop-color="#FFF4D6"/>' +
      '<stop offset="58%" stop-color="#E8B94A"/><stop offset="100%" stop-color="#7A5510"/>' +
      "</linearGradient>" +
      '<linearGradient id="w-boss" x1="0.2" y1="0" x2="0.8" y2="1">' +
      '<stop offset="0%" stop-color="#FFF4D6"/><stop offset="55%" stop-color="#D8A93C"/>' +
      '<stop offset="100%" stop-color="#7A5510"/></linearGradient>' +
      "</defs>" +
      '<g filter="url(#w-drop)">' +
      '<path d="M20 43.5 L9.5 14 Q20 9.2 30.5 14 Z" fill="url(#w-ptr)" stroke="#0A0A0F" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M20 40 L15.4 15.4 Q20 13.6 20 13.6 Z" fill="#FFF6E0" opacity="0.32"/>' +
      '<circle cx="20" cy="9" r="9.5" fill="url(#w-boss)" stroke="#0A0A0F" stroke-width="1.5"/>' +
      '<circle cx="20" cy="9" r="3.4" fill="#0A0A0F" opacity="0.8"/>' +
      '<circle cx="16.8" cy="5.9" r="2.1" fill="#FFF6E0" opacity="0.85"/></g>';
    flapper = pointer.querySelector("g");
    box.appendChild(pointer);

    const ring = document.createElement("div");
    ring.className = "shock";
    box.appendChild(ring);

    host.appendChild(box);
    setHeat(0);
    setScale(1);
    apply(0);
  }

  // Labels are children of the disc, so without this half of them are upside
  // down whenever the wheel stops. Each one flips as it passes the vertical —
  // the top and bottom of the wheel — where radial text is neither way up nor
  // upside down, so the switch is invisible.
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
      disc.setAttribute("transform", `rotate(${deg.toFixed(3)} ${c} ${c})`);
    }
    orientLabels(deg);
  }

  function dim(winner) {
    if (!disc) return;
    disc.querySelectorAll("g[data-index]").forEach((g) => {
      const isWinner = Number(g.dataset.index) === winner;
      g.style.transition = "opacity 450ms ease, filter 450ms ease";
      g.style.opacity = winner === null || isWinner ? "1" : "0.22";
      g.style.filter = isWinner ? "brightness(1.25) saturate(1.2)" : "none";
    });
    if (labels) labels.style.opacity = "1";
  }

  const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const smoothstep = (p) => p * p * (3 - 2 * p);

  // Distance covered by a velocity curve that ramps up over RAMP and then
  // decays exponentially — a torque released against constant friction.
  // Velocity is continuous at the join, so there is no visible kink.
  function travel(p) {
    const rampArea = 0.5 * RAMP;
    const decayed = (x) => ((1 - Math.exp(-DECAY * x)) * (1 - RAMP)) / DECAY;
    const total = rampArea + decayed(1);
    const d = p <= RAMP ? (0.5 * p * p) / RAMP : rampArea + decayed((p - RAMP) / (1 - RAMP));
    return d / total;
  }

  function setHeat(v) {
    if (host) host.parentElement.style.setProperty("--heat", v.toFixed(3));
  }
  function setScale(v) {
    if (host) host.parentElement.style.setProperty("--wscale", v.toFixed(4));
  }

  // Animated by hand rather than a CSS transition so the angle can be watched:
  // that is what drives the flapper, the haptics, the blur and the glow.
  function spin(index, onDone) {
    if (spinning || !disc) return;
    spinning = true;
    dim(null);
    document.body.classList.add("spinning");

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
    let lastDeg = start;
    let lastTick = 0;
    let flick = 0;

    vibrate([0, 12, 90, 18, 90, 26]); // the wind-up, felt

    function frame(now) {
      const t = now - t0;
      let deg, heat, scale;

      if (t < T1) {
        const p = t / WIND_MS;
        deg = start + (windTo - start) * easeInOutCubic(p);
        heat = 0.55 * p;
        scale = 1 - 0.028 * easeInOutCubic(p);
      } else if (t < T2) {
        const p = (t - T1) / SPIN_MS_;
        deg = windTo + (preStop - windTo) * travel(p);
        heat = 0.25;
        scale = 0.972 + 0.083 * Math.min(1, p / 0.1);
      } else if (t < T3) {
        // hanging: a tremble, not stillness, or it reads as finished
        const p = (t - T2) / HOLD_MS;
        deg = preStop + 0.22 * Math.sin(p * Math.PI * 7) * (1 - p);
        heat = 0.42 + 0.14 * Math.sin(p * Math.PI * 3);
        scale = 1.055;
      } else if (t < T4) {
        const p = (t - T3) / CREEP_MS;
        deg = preStop + plan.creep * smoothstep(p);
        heat = 0.45 + 0.55 * smoothstep(p);
        scale = 1.055 + 0.042 * smoothstep(p);
      } else if (t < T5) {
        const u = (t - T4) / SETTLE_MS;
        deg = final + rock * Math.exp(-5.4 * u) * Math.cos(2 * Math.PI * 1.5 * u);
        heat = 1;
        scale = 1.097 - 0.077 * easeInOutCubic(u);
      } else {
        deg = final;
        heat = Math.max(0, 1 - (t - T5) / FLASH_MS);
        scale = 1.02;
      }

      const speed = Math.abs(deg - lastDeg);
      lastDeg = deg;
      apply(deg);

      if (!REDUCED) {
        setHeat(Math.max(heat, clamp(speed / 11, 0, 1)));
        setScale(scale);
        disc.style.filter = speed > 2.5 ? `blur(${clamp((speed - 2.5) * 0.28, 0, 2.6).toFixed(2)}px)` : "none";

        const s = Gold.segmentAt(angles, Gold.angleUnderPointer(deg));
        if (s !== lastSeg) {
          lastSeg = s;
          const decisive = t >= T3 && t < T4; // the one crossing that matters
          flick = decisive ? 26 : clamp(speed * 1.5, 5, 20);
          if (decisive) {
            vibrate(70);
            pulseRim();
          } else if (now - lastTick > 26) {
            lastTick = now;
            vibrate(clamp(Math.round(speed * 1.7), 5, 18));
          }
        }
        flick *= 0.84;
        if (flapper) flapper.setAttribute("transform", `rotate(${flick.toFixed(2)} 20 9)`);
        // labels are unreadable at speed; letting them resolve is the tell that
        // the wheel is slowing down
        if (labels) labels.style.opacity = String(clamp(1 - speed / 13, 0.1, 1));
      }

      if (t < T5) {
        requestAnimationFrame(frame);
      } else if (t < SPIN_MS) {
        if (!landed) land(index);
        requestAnimationFrame(frame);
      } else {
        finish(onDone);
      }
    }

    let landed = false;
    function land(i) {
      landed = true;
      if (flapper) flapper.setAttribute("transform", "rotate(0 20 9)");
      disc.style.filter = "none";
      dim(i);
      shock();
      vibrate([0, 50, 60, 50, 60, 150]);
    }
    function finish(cb) {
      spinning = false;
      document.body.classList.remove("spinning");
      setScale(1);
      setHeat(0);
      if (!landed) land(index);
      cb && cb();
    }

    requestAnimationFrame(frame);
  }

  function pulseRim() {
    const box = host && host.querySelector(".wheel-box");
    if (!box) return;
    box.classList.remove("hit");
    void box.offsetWidth;
    box.classList.add("hit");
  }

  function shock() {
    const ring = host && host.querySelector(".shock");
    if (!ring) return;
    ring.classList.remove("go");
    void ring.offsetWidth;
    ring.classList.add("go");
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
    for (let i = 0; i < 130; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 12;
      parts.push({
        x: w / 2, y: h * 0.42,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 5,
        w: 4 + Math.random() * 5,
        h: 6 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.45,
        flip: Math.random() * Math.PI,
        vf: 0.12 + Math.random() * 0.16,
        color: colors[(Math.random() * colors.length) | 0],
        life: 1,
      });
    }

    let raf;
    function frame() {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.34;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.flip += p.vf;
        p.life -= 0.0072;
        if (p.life <= 0 || p.y > h + 40) continue;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // scaling one axis by cos() turns each flake edge-on as it tumbles
        ctx.scale(1, Math.cos(p.flip));
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
