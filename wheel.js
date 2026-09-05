// Gold wheel — SVG segments under a fixed specular highlight, hand-driven spin
// with wind-up, exponential friction and a damped settle. Knows nothing about
// habits or tickets: it is handed a prize list and a winning index.
"use strict";

const Wheel = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const WIND_MS = REDUCED ? 0 : 380;    // pull back against the brake
  const MAIN_MS = REDUCED ? 700 : 6100; // release, then friction
  const SETTLE_MS = REDUCED ? 0 : 820;  // the flapper pushing it back into place
  const SPIN_MS = WIND_MS + MAIN_MS + SETTLE_MS;
  const WIND_DEG = 13;
  const DECAY = 4.1; // friction constant: higher = longer crawl at the end

  let host = null;
  let prizes = [];
  let angles = [];
  let disc = null;
  let labels = null;
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
        // radial text: letters advance outward, flipped on the left half so it
        // is never upside down
        const rText = rSeg * 0.62;
        const flip = seg.mid > 180;
        const g2 = el("g", { transform: `rotate(${seg.mid - 90 + (flip ? 180 : 0)} ${cx} ${cy})` });
        const t = el("text", {
          x: flip ? cx - rText : cx + rText, y: cy,
          "text-anchor": "middle", "dominant-baseline": "central",
          class: "wheel-label",
        });
        t.textContent = p.name.length > 16 ? p.name.slice(0, 15) + "…" : p.name;
        g2.appendChild(t);
        labels.appendChild(g2);
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

    host.appendChild(box);
    apply(0);
  }

  function apply(deg) {
    rot = deg;
    if (disc) {
      const c = disc.ownerSVGElement.viewBox.baseVal.width / 2;
      disc.setAttribute("transform", `rotate(${deg.toFixed(3)} ${c} ${c})`);
    }
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

  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
  // constant torque released against constant friction: ω decays exponentially
  const friction = (p) => (1 - Math.exp(-DECAY * p)) / (1 - Math.exp(-DECAY));

  // Animated by hand rather than a CSS transition so the angle can be watched:
  // that is what makes the flapper flick and the phone tick on every peg.
  function spin(index, onDone) {
    if (spinning || !disc) return;
    spinning = true;
    dim(null);

    const start = ((rot % 360) + 360) % 360;
    apply(start);
    const seg = angles[index];
    const span = seg.end - seg.start;
    const overshoot = Math.min(3.4, span * 0.22);
    const launch = start - WIND_DEG;
    const target = start + Gold.landingRotation(index, angles);

    const t0 = performance.now();
    let lastSeg = Gold.segmentAt(angles, Gold.angleUnderPointer(start));
    let lastDeg = start;
    let lastTick = 0;
    let flick = 0;

    function frame(now) {
      const t = now - t0;
      let deg;
      if (t < WIND_MS) {
        deg = start - WIND_DEG * easeOutCubic(t / WIND_MS);
      } else if (t < WIND_MS + MAIN_MS) {
        deg = launch + (target + overshoot - launch) * friction((t - WIND_MS) / MAIN_MS);
      } else if (t < SPIN_MS) {
        // the flapper pushes it back off the peg and it rocks into place
        const u = (t - WIND_MS - MAIN_MS) / SETTLE_MS;
        deg = target + overshoot * Math.exp(-5.2 * u) * Math.cos(2 * Math.PI * 1.45 * u);
      } else {
        deg = target;
      }

      const speed = Math.abs(deg - lastDeg);
      lastDeg = deg;
      apply(deg);

      if (!REDUCED) {
        const s = Gold.segmentAt(angles, Gold.angleUnderPointer(deg));
        if (s !== lastSeg) {
          lastSeg = s;
          flick = clamp(speed * 1.5, 5, 20);
          if (now - lastTick > 26) {
            lastTick = now;
            vibrate(clamp(Math.round(speed * 1.6), 5, 16));
          }
        }
        flick *= 0.84;
        if (flapper) flapper.setAttribute("transform", `rotate(${flick.toFixed(2)} 20 9)`);
        // labels are unreadable at speed; letting them fade back in is the tell
        // that the wheel is slowing down
        if (labels) labels.style.opacity = String(clamp(1 - speed / 13, 0.12, 1));
      }

      if (t < SPIN_MS) requestAnimationFrame(frame);
      else {
        if (flapper) flapper.setAttribute("transform", "rotate(0 20 9)");
        spinning = false;
        dim(index);
        vibrate([0, 45, 55, 45, 55, 130]);
        onDone && onDone();
      }
    }
    requestAnimationFrame(frame);
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
