// Gold wheel — SVG segments, hand-driven spin animation, tick haptics,
// confetti. Knows nothing about habits or tickets: it is handed a prize list
// and a winning index.
"use strict";

const Wheel = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPIN_MS = REDUCED ? 900 : 6600;

  let host = null;
  let prizes = [];
  let angles = [];
  let svg = null;
  let pointer = null;
  let rot = 0;
  let spinning = false;

  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* unsupported */ } };
  const NS = "http://www.w3.org/2000/svg";
  const el = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  function arcPath(cx, cy, r, startDeg, endDeg) {
    const a = ((startDeg - 90) * Math.PI) / 180;
    const b = ((endDeg - 90) * Math.PI) / 180;
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)} ` +
      `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)} Z`;
  }

  function render(hostEl, prizeList) {
    host = hostEl;
    prizes = prizeList;
    angles = Gold.segmentAngles(prizes);
    rot = 0;
    host.innerHTML = "";

    const size = Math.min(Math.max(240, window.innerWidth - 56), 340);
    const cx = size / 2, cy = size / 2, r = size / 2 - 14;

    const box = document.createElement("div");
    box.className = "wheel-box";
    box.style.width = size + "px";
    box.style.height = size + "px";

    svg = el("svg", { class: "wheel-svg", width: size, height: size, viewBox: `0 0 ${size} ${size}` });

    const defs = el("defs");
    defs.innerHTML =
      '<radialGradient id="gloss" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>' +
      '<stop offset="55%" stop-color="rgba(255,255,255,0)"/>' +
      '<stop offset="100%" stop-color="rgba(0,0,0,0.28)"/></radialGradient>' +
      '<radialGradient id="hub" cx="50%" cy="38%" r="62%">' +
      '<stop offset="0%" stop-color="#23232F"/><stop offset="100%" stop-color="#0A0A0F"/></radialGradient>' +
      '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#FFD97A"/><stop offset="100%" stop-color="#A87B1F"/></linearGradient>';
    svg.appendChild(defs);

    svg.appendChild(el("circle", { cx, cy, r: r + 7, fill: "none", stroke: "url(#rim)", "stroke-width": 3, opacity: 0.85 }));
    svg.appendChild(el("circle", { cx, cy, r: r + 2, fill: "rgba(8,8,12,0.55)" }));

    const disc = el("g");
    prizes.forEach((p, i) => {
      const seg = angles[i];
      const span = seg.end - seg.start;
      const g = el("g");
      const shapeAttrs = { fill: p.color, stroke: "rgba(0,0,0,0.4)", "stroke-width": 2 };
      const glossAttrs = { fill: "url(#gloss)", "pointer-events": "none" };
      if (span >= 359.9) {
        g.appendChild(el("circle", Object.assign({ cx, cy, r }, shapeAttrs)));
        g.appendChild(el("circle", Object.assign({ cx, cy, r }, glossAttrs)));
      } else {
        const d = arcPath(cx, cy, r, seg.start, seg.end);
        g.appendChild(el("path", Object.assign({ d }, shapeAttrs)));
        g.appendChild(el("path", Object.assign({ d }, glossAttrs)));
      }
      if (p.emoji && span > 12) {
        const rad = ((seg.mid - 90) * Math.PI) / 180;
        const lx = cx + Math.cos(rad) * r * 0.64;
        const ly = cy + Math.sin(rad) * r * 0.64;
        // upright, not radial: a rotated emoji reads as upside-down half the time
        const t = el("text", {
          x: lx, y: ly, "font-size": 22, "text-anchor": "middle", "dominant-baseline": "central",
        });
        t.textContent = p.emoji;
        g.appendChild(t);
      }
      g.dataset.index = String(i);
      disc.appendChild(g);
    });
    svg.appendChild(disc);

    svg.appendChild(el("circle", { cx, cy, r: r * 0.17, fill: "url(#hub)", stroke: "#E8B94A", "stroke-width": 1.5 }));
    svg.appendChild(el("circle", { cx, cy, r: r * 0.05, fill: "#FFD97A", opacity: 0.9 }));

    box.appendChild(svg);

    pointer = el("svg", { class: "wheel-pointer", width: 30, height: 38, viewBox: "0 0 30 38" });
    pointer.innerHTML =
      '<defs><linearGradient id="ptr" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#FFE9AE"/><stop offset="100%" stop-color="#A87B1F"/></linearGradient></defs>' +
      '<path d="M15 38 L3 7 Q15 -2 27 7 Z" fill="url(#ptr)" stroke="#0A0A0F" stroke-width="1.5"/>' +
      '<circle cx="15" cy="10" r="2.6" fill="#fff" opacity="0.85"/>';
    box.appendChild(pointer);

    host.appendChild(box);
    apply(0);
  }

  function apply(deg) {
    rot = deg;
    if (svg) svg.style.transform = `rotate(${deg}deg)`;
  }

  function dim(winner) {
    if (!svg) return;
    svg.querySelectorAll("g[data-index]").forEach((g) => {
      const isWinner = Number(g.dataset.index) === winner;
      g.style.transition = "opacity 400ms ease, filter 400ms ease";
      g.style.opacity = winner === null || isWinner ? "1" : "0.3";
      g.style.filter = isWinner ? "brightness(1.18) saturate(1.15)" : "none";
    });
  }

  // Animated by hand rather than a CSS transition so the angle can be watched:
  // that is what makes the wheel tick past each segment on Android.
  function spin(index, onDone) {
    if (spinning || !svg) return;
    spinning = true;
    dim(null);

    const start = ((rot % 360) + 360) % 360;
    apply(start);
    const target = start + Gold.landingRotation(index, angles);
    const t0 = performance.now();
    let lastSeg = Gold.segmentAt(angles, Gold.angleUnderPointer(start));
    let wobble = 0;

    const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

    function frame(now) {
      const t = Math.min(1, (now - t0) / SPIN_MS);
      const deg = start + (target - start) * easeOutQuart(t);
      apply(deg);

      if (!REDUCED) {
        const seg = Gold.segmentAt(angles, Gold.angleUnderPointer(deg));
        if (seg !== lastSeg) {
          lastSeg = seg;
          wobble = 1;
          vibrate(7);
        }
        wobble *= 0.82;
        pointer.style.transform = `translateX(-50%) rotate(${Math.sin(wobble * Math.PI * 2) * 13}deg)`;
      }

      if (t < 1) requestAnimationFrame(frame);
      else {
        pointer.style.transform = "translateX(-50%)";
        spinning = false;
        dim(index);
        vibrate([0, 40, 60, 40, 60, 120]);
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
    const colors = [color, "#FFD97A", "#E8B94A", "#FFFFFF"];
    const parts = [];
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 11;
      parts.push({
        x: w / 2, y: h * 0.42,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 5,
        size: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
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
        p.life -= 0.0075;
        if (p.life <= 0 || p.y > h + 40) continue;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive > 0) raf = requestAnimationFrame(frame);
      else { cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); }
    }
    frame();
  }

  return { render, spin, burst, isSpinning, vibrate, SPIN_MS };
})();
