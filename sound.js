// Gold audio — everything synthesised with Web Audio, no files, so it works
// offline and adds nothing to the download. A wheel without the clatter is
// half a wheel.
"use strict";

const Sfx = (() => {
  const KEY = "gold_muted";
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = localStorage.getItem(KEY) === "1";
  let whoosh = null;

  function makeNoise(c) {
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Created lazily: browsers refuse an AudioContext before a gesture.
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      noise = makeNoise(ctx);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  const env = (g, t, peak, attack, decay) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };

  function tone(freq, t, peak, decay, type, glideTo) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay * 0.8);
    env(g, t, peak, 0.006, decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  // One peg going past the clapper. `v` is 0..1 with wheel speed: fast hits are
  // brighter, quieter and shorter, slow ones are the loud individual clacks.
  function peg(v) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 1 + v;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500 + v * 2800;
    bp.Q.value = 5 + v * 4;
    const g = c.createGain();
    env(g, t, 0.16 + 0.30 * (1 - v), 0.001, 0.028 + 0.045 * (1 - v));
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.12);
    // a wooden body under the click, only audible once they separate
    if (v < 0.55) tone(190 - v * 60, t, 0.10 * (1 - v), 0.06, "triangle");
  }

  // Air moving past a heavy disc, held open for the length of the spin.
  function whooshStart() {
    const c = ac(); if (!c) return;
    whooshStop();
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    lp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = 0.0001;
    src.connect(lp).connect(g).connect(master);
    src.start();
    whoosh = { src, lp, g };
  }
  function whooshSet(v) {
    if (!whoosh || !ctx) return;
    const t = ctx.currentTime;
    whoosh.lp.frequency.setTargetAtTime(280 + v * 2400, t, 0.05);
    whoosh.g.gain.setTargetAtTime(0.075 * v, t, 0.05);
  }
  function whooshStop() {
    if (!whoosh) return;
    const w = whoosh;
    whoosh = null;
    try {
      w.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      w.src.stop(ctx.currentTime + 0.5);
    } catch (e) { /* already stopped */ }
  }

  // The hang: a low swell that leaves the question open.
  function tension() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(58, t, 0.30, 0.9, "sine", 52);
    tone(1760, t + 0.02, 0.035, 0.7, "sine", 2093);
  }

  // The clapper tipping over the last peg.
  function clunk() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    peg(0);
    tone(110, t, 0.34, 0.22, "triangle", 74);
  }

  function win() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(65, t, 0.42, 1.1, "sine", 49);                    // the drop
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      tone(f, t + 0.07 + i * 0.075, 0.22, 0.9, "triangle");
      tone(f * 2, t + 0.07 + i * 0.075, 0.06, 0.6, "sine");
    });
    const src = c.createBufferSource();                    // shimmer over the top
    src.buffer = noise;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(2000, t);
    hp.frequency.exponentialRampToValueAtTime(9000, t + 1.1);
    const g = c.createGain();
    env(g, t + 0.05, 0.10, 0.06, 1.0);
    src.connect(hp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 1.3);
  }

  // Landed on a blank: a short fall, then nothing.
  function blank() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(392, t, 0.20, 0.35, "triangle", 311.13);
    tone(196, t + 0.14, 0.22, 0.55, "sine", 155.56);
  }

  // ---------- the reveal ----------
  // Each tier has a root, so every cue for a tier sits in the same key and the
  // steps of the charge climb audibly: silver, blue, purple, gold.
  const ROOT = { blank: 196, common: 392, rare: 466.16, epic: 554.37, legendary: 659.25 };
  const chord = (f) => [f, f * 1.25, f * 1.5];
  let riser = null;

  function shimmer(t, peak, len, from, to) {
    const c = ac(); if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noise;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(from, t);
    hp.frequency.exponentialRampToValueAtTime(to, t + len);
    const g = c.createGain();
    env(g, t, peak, 0.04, len);
    src.connect(hp).connect(g).connect(master);
    src.start(t);
    src.stop(t + len + 0.1);
  }

  // The ticket seating: a click with a body under it.
  function insert() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    peg(0.2);
    tone(220, t, 0.26, 0.18, "triangle", 150);
    tone(1320, t + 0.03, 0.05, 0.25, "sine");
  }

  // A held, detuned pair under a filter that opens as the charge builds.
  function riserStart() {
    const c = ac(); if (!c) return;
    riserStop();
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300;
    lp.Q.value = 6;
    const g = c.createGain();
    g.gain.value = 0.0001;
    const os = [110, 110.7, 220.4].map((f) => {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      return o;
    });
    lp.connect(g).connect(master);
    riser = { os, lp, g, base: [110, 110.7, 220.4] };
  }
  function riserSet(p) {
    if (!riser || !ctx) return;
    const t = ctx.currentTime;
    riser.lp.frequency.setTargetAtTime(300 + p * 2600, t, 0.08);
    riser.g.gain.setTargetAtTime(p > 0 ? 0.02 + p * 0.07 : 0.0001, t, 0.08);
    riser.os.forEach((o, i) => o.frequency.setTargetAtTime(riser.base[i] * (1 + p * 0.5), t, 0.1));
  }
  function riserStop() {
    if (!riser) return;
    const r = riser;
    riser = null;
    try {
      r.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
      r.os.forEach((o) => o.stop(ctx.currentTime + 0.4));
    } catch (e) { /* already stopped */ }
  }

  // One step of the charge: a bell in the tier's key.
  function tell(tier) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const f = ROOT[tier] || ROOT.common;
    tone(f * 2, t, 0.20, 0.9, "sine");
    tone(f * 3, t, 0.06, 0.6, "sine");
    tone(f, t, 0.10, 0.5, "triangle");
  }

  // The charge lands on its colour.
  function flash(tier) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const f = ROOT[tier] || ROOT.common;
    chord(f).forEach((n, i) => tone(n, t + i * 0.03, 0.14, 1.2, "triangle"));
    tone(f / 4, t, 0.34, 0.9, "sine", f / 5);
    shimmer(t, 0.08, 1.0, 3000, 9000);
  }

  // The core folding into a line.
  function collapse() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(880, t, 0.10, 0.35, "sine", 180);
    shimmer(t, 0.06, 0.35, 8000, 1500);
  }

  // The reel landing a tier above the charge.
  function bloom(tier) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const f = ROOT[tier] || ROOT.common;
    chord(f * 2).forEach((n, i) => tone(n, t + i * 0.06, 0.16, 1.0, "triangle"));
    shimmer(t, 0.1, 1.2, 2500, 10000);
  }

  // The card rising out of the strip.
  function lift() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(330, t, 0.08, 1.0, "sine", 660);
    shimmer(t, 0.04, 1.0, 1500, 6000);
  }

  function flip() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 0.18);
    const g = c.createGain();
    env(g, t, 0.22, 0.02, 0.2);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.3);
  }

  // The prize. Bigger for rarer; a blank gets a short fall.
  function fanfare(tier) {
    if (tier === "blank") return blank();
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const f = ROOT[tier];
    const big = tier === "legendary" ? 3 : tier === "epic" ? 2 : tier === "rare" ? 1 : 0;
    tone(f / 8, t, 0.42, 1.0 + big * 0.4, "sine", f / 10);
    const run = [1, 1.25, 1.5, 2, 2.5, 3, 4].slice(0, 3 + big);
    run.forEach((m, i) => {
      tone(f * m, t + 0.06 + i * 0.07, 0.2, 0.9 + big * 0.2, "triangle");
      tone(f * m * 2, t + 0.06 + i * 0.07, 0.05, 0.6, "sine");
    });
    if (big >= 2) chord(f * 2).forEach((n) => tone(n, t + 0.1 + run.length * 0.07, 0.12, 1.8, "triangle"));
    shimmer(t + 0.05, 0.06 + big * 0.03, 1.0 + big * 0.4, 2000, 9000);
  }

  function earned(streak) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const notes = streak ? [587.33, 880, 1174.7] : [783.99, 1174.7];
    notes.forEach((f, i) => {
      tone(f, t + i * 0.1, 0.24, 0.75, "sine");
      tone(f * 1.5, t + i * 0.1, 0.07, 0.5, "sine");
    });
  }

  // A habit ticked off. Rises with how far into the day you are.
  function blip(progress) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const f = 620 + 460 * Math.min(1, progress || 0);
    tone(f, t, 0.16, 0.09, "sine", f * 1.5);
  }

  function thunk() {
    const c = ac(); if (!c) return;
    tone(300, c.currentTime, 0.12, 0.07, "sine", 190);
  }

  function setMuted(v) {
    muted = !!v;
    localStorage.setItem(KEY, muted ? "1" : "0");
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  }

  return {
    unlock: ac, peg, whooshStart, whooshSet, whooshStop,
    tension, clunk, win, blank, earned, blip, thunk,
    insert, riserStart, riserSet, riserStop, tell, flash, collapse, bloom, lift, flip, fanfare,
    setMuted, isMuted: () => muted,
  };
})();
