// Gold visual components — rings, sparks, grain, counters. No app state here.
"use strict";

const Ui = (() => {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Habit hues: luminous, evenly spaced, each with a lighter partner for the
  // tip of its ring. Gold is not in this list on purpose — gold means reward.
  const PALETTE = [
    ["#8B7CFF", "#C9C1FF"], // violet
    ["#4CC9FF", "#B5ECFF"], // sky
    ["#3DDC97", "#A9F5D2"], // mint
    ["#FF7A6B", "#FFC2B8"], // coral
    ["#FF6FAE", "#FFC0DD"], // rose
    ["#2EE6D6", "#A6FBF3"], // cyan
    ["#B6F36A", "#E3FCC0"], // lime
    ["#FFA54C", "#FFD8AE"], // tangerine
    ["#6C8CFF", "#BCCBFF"], // indigo
    ["#E07BFF", "#F3C6FF"], // orchid
  ];
  const tipFor = (hex) => {
    const p = PALETTE.find((x) => x[0].toLowerCase() === String(hex || "").toLowerCase());
    return p ? p[1] : mix(hex, "#FFFFFF", 0.55);
  };

  function mix(a, b, t) {
    const pa = parseInt(String(a).replace("#", ""), 16), pb = parseInt(String(b).replace("#", ""), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
  }

  // ---------- ring ----------
  // A conic gradient masked into an annulus: an angular gradient from base to
  // tip, a round glowing cap at the leading edge, animated through --p, which
  // is a registered property so it transitions like any number.
  function ring({ size, width, p, c1, c2, cls, inner }) {
    return `<div class="ring${cls ? " " + cls : ""}" style="--size:${size}px;--w:${width}px;--p:${clamp01(p)};--c1:${c1};--c2:${c2 || tipFor(c1)}">` +
      '<div class="ring-track"></div>' +
      '<div class="ring-glow"><div class="ring-arc"></div></div>' +
      '<div class="ring-start"></div><div class="ring-cap"></div>' +
      `<div class="ring-core">${inner || ""}</div></div>`;
  }
  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
  const setRing = (el, p) => { if (el) el.style.setProperty("--p", String(clamp01(p))); };

  // ---------- sparks ----------
  function burst(el, color, n) {
    if (REDUCED || !el) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const count = n || 16;
    const ring = document.createElement("i");
    ring.className = "burst-ring";
    ring.style.cssText = `left:${x}px;top:${y}px;width:${r.width}px;height:${r.width}px;border-color:${color}`;
    document.body.appendChild(ring);
    ring.animate([{ transform: "translate(-50%,-50%) scale(0.7)", opacity: 0.9 },
      { transform: "translate(-50%,-50%) scale(1.7)", opacity: 0 }], { duration: 700, easing: "cubic-bezier(.16,1,.3,1)" })
      .onfinish = () => ring.remove();
    for (let i = 0; i < count; i++) {
      const s = document.createElement("i");
      s.className = "spark";
      const big = Math.random() < 0.3;
      s.style.cssText = `left:${x}px;top:${y}px;background:${big ? "#fff" : color};width:${big ? 4 : 5}px;height:${big ? 4 : 5}px;box-shadow:0 0 8px ${color}`;
      document.body.appendChild(s);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const d = r.width * (0.55 + Math.random() * 0.5);
      s.animate([
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0.2)`, opacity: 0 },
      ], { duration: 650 + Math.random() * 350, easing: "cubic-bezier(.16,1,.3,1)" }).onfinish = () => s.remove();
    }
  }

  // ---------- counters ----------
  function countTo(el, to, ms) {
    if (!el) return;
    const from = Number(el.dataset.v || el.textContent) || 0;
    el.dataset.v = String(to);
    // a hidden page gets no animation frames; the number must still be right
    if (REDUCED || from === to || document.hidden) { el.textContent = String(to); return; }
    const t0 = performance.now(), dur = ms || 600;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- grain ----------
  // Rendered once to a small tile, so the texture costs nothing per frame.
  function grain() {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 140;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(140, 140);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      document.documentElement.style.setProperty("--grain", `url(${c.toDataURL()})`);
    } catch (e) { /* no canvas: no grain */ }
  }

  // stagger children in when a view appears
  function rise(container) {
    if (REDUCED || !container) return;
    const kids = Array.from(container.querySelectorAll("[data-rise]"));
    kids.forEach((k, i) => {
      k.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }],
        { duration: 520, delay: i * 45, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
    });
  }

  return { PALETTE, tipFor, mix, ring, setRing, burst, countTo, grain, rise, REDUCED };
})();
