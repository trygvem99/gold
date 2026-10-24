// Off-phone backup to a private GitHub repository. The browser's storage is a
// cache the phone may wipe; on 21 Oct it did, and Gold had no other copy. The
// copy kept here is the one that survives that. Every write schedules an
// upload of the full snapshot (tens of KB), every version stays in git
// history, and a phone holding much less than the backup is never allowed to
// overwrite it on its own.
//
// Adapted from CalTrack's cloud.js, which has run on the same phone since
// October. Gold shares CalTrack's origin and so its localStorage: CalTrack's
// key and private repository are adopted, so backup needs no setup.
"use strict";

const Cloud = (() => {
  const API = "https://api.github.com";
  const PATH = "gold-backup.json";
  const KEY_TOKEN = "gold_gh_token", KEY_REPO = "gold_gh_repo";
  const HW_KEY = "gold_cloud_hw", HASH_KEY = "gold_cloud_hash", LAST_KEY = "gold_cloud_last";

  // no setup when CalTrack is already backing up from this phone
  if (!localStorage.getItem(KEY_TOKEN) && localStorage.getItem("caltrack_gh_token") && localStorage.getItem("caltrack_gh_repo")) {
    localStorage.setItem(KEY_TOKEN, localStorage.getItem("caltrack_gh_token"));
    localStorage.setItem(KEY_REPO, localStorage.getItem("caltrack_gh_repo"));
  }

  const token = () => localStorage.getItem(KEY_TOKEN) || "";
  const repo = () => localStorage.getItem(KEY_REPO) || "";
  const enabled = () => !!(token() && repo());

  let timer = null, busy = false, dirty = false, blocked = false, lastError = null;
  let held = null;  // why uploads are refused outright this session, or null
  let cloud = null; // what is on GitHub, once looked at: {size, exported_at, sha}
  const listeners = [];
  const notify = () => listeners.forEach((f) => { try { f(); } catch (e) { /* a listener's problem */ } });

  // How much a snapshot holds: the records that are yours. Prizes and tickets
  // follow from these; settings are one record either way.
  const size = (snap) => ["habits", "goals", "days", "wins"]
    .reduce((n, k) => n + ((snap && snap.stores && snap.stores[k]) || []).length, 0);
  const describe = (snap) => {
    const s = (snap && snap.stores) || {};
    const n = (k) => (s[k] || []).length;
    return { habits: n("habits"), goals: n("goals"), days: n("days"), wins: n("wins"), exported_at: snap ? snap.exported_at : null };
  };

  // The most the backup is known to have held. Comparing only against the
  // current copy let CalTrack's first bad upload disable its guard for good.
  const highWater = () => Number(localStorage.getItem(HW_KEY) || 0);
  const noteSize = (n) => { if (n > highWater()) localStorage.setItem(HW_KEY, String(n)); };

  async function gh(path, opts) {
    const o = opts || {};
    const res = await fetch(API + path, {
      method: o.method || "GET",
      body: o.body,
      headers: Object.assign({
        Authorization: "Bearer " + token(),
        Accept: o.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      }, o.body ? { "Content-Type": "application/json" } : {}),
    });
    if (!res.ok) {
      let msg = String(res.status);
      try { msg += " " + (await res.json()).message; } catch (e) { msg += " " + res.statusText; }
      const err = new Error("GitHub " + msg);
      err.status = res.status;
      throw err;
    }
    return o.raw ? res.text() : res.json();
  }

  // btoa() only takes latin1; go through UTF-8 bytes in chunks
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // a cheap fingerprint, so an unchanged phone does not commit on every launch
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ":" + str.length;
  }

  // Your habits are personal; the app repository is public. Never write there.
  async function assertPrivate() {
    const info = await gh(`/repos/${repo()}`);
    if (!info.private) throw new Error(`${repo()} is a public repository. Backups need a private one.`);
  }

  // The backup on GitHub, or null when there is none yet.
  async function download() {
    let meta;
    try {
      meta = await gh(`/repos/${repo()}/contents/${PATH}`);
    } catch (e) {
      if (e.status === 404) { cloud = { size: 0, exported_at: null, sha: null }; return null; }
      throw e;
    }
    // the JSON form inlines content only up to 1 MB; the raw form has no limit
    const snap = JSON.parse(await gh(`/repos/${repo()}/contents/${PATH}`, { raw: true }));
    cloud = { size: size(snap), exported_at: snap.exported_at || null, sha: meta.sha };
    noteSize(cloud.size);
    return snap;
  }

  // The copy to restore. The newest one can be bad (a wiped phone once uploaded
  // an empty database over CalTrack's backup), but git keeps every version, so
  // this takes the newest copy holding nearly as much as any recent one did.
  async function bestSnapshot() {
    const head = await download();
    let versions = [];
    try {
      const commits = await gh(`/repos/${repo()}/commits?path=${PATH}&per_page=15`);
      versions = (await Promise.all(commits.map(async (c) => {
        try {
          const snap = JSON.parse(await gh(`/repos/${repo()}/contents/${PATH}?ref=${c.sha}`, { raw: true }));
          return { snap, size: size(snap) };
        } catch (e) { return null; }
      }))).filter(Boolean);
    } catch (e) { /* history unreadable: fall back to the newest copy */ }
    const max = Math.max(head ? size(head) : 0, ...versions.map((v) => v.size), 0);
    if (!max) return head;
    if (head && size(head) >= max * 0.9) return head;
    const best = versions.find((v) => v.size >= max * 0.9); // newest first
    return best ? best.snap : head;
  }

  async function upload(snap, force) {
    if (!enabled()) return;
    // a wiped phone must never become the backup, forced or not
    if (held) { blocked = true; notify(); return; }
    if (busy) { dirty = true; return; }
    const fingerprint = hash(JSON.stringify(snap.stores));
    if (!force && fingerprint === localStorage.getItem(HASH_KEY)) return;
    busy = true; notify();
    try {
      await assertPrivate();
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!cloud) await download();
        const local = size(snap);
        const best = Math.max(cloud.size, highWater());
        if (!force && best > 0 && local < best / 2) { blocked = true; return; }
        blocked = false;
        const body = { message: `gold backup ${snap.exported_at}`, content: b64(JSON.stringify(snap)) };
        if (cloud.sha) body.sha = cloud.sha;
        try {
          const r = await gh(`/repos/${repo()}/contents/${PATH}`, { method: "PUT", body: JSON.stringify(body) });
          cloud = { size: local, exported_at: snap.exported_at, sha: r.content.sha };
          noteSize(local);
          localStorage.setItem(HASH_KEY, fingerprint);
          localStorage.setItem(LAST_KEY, String(Date.now()));
          lastError = null;
          return;
        } catch (e) {
          // written from elsewhere in between: re-read its sha and try once more
          if ((e.status === 409 || e.status === 422) && attempt === 0) { cloud = null; continue; }
          throw e;
        }
      }
    } catch (e) {
      lastError = e.message;
      throw e;
    } finally {
      busy = false;
      notify();
      if (dirty) { dirty = false; schedule(); }
    }
  }

  async function flush(force) {
    clearTimeout(timer); timer = null;
    if (!enabled()) return;
    try { await upload(await Data.snapshot(), force); } catch (e) { /* shown in status */ }
  }
  function schedule() {
    if (!enabled() || held) return;
    clearTimeout(timer);
    timer = setTimeout(() => flush(false), 4000);
  }
  // phones background the app abruptly; push a pending upload out before that
  document.addEventListener("visibilitychange", () => { if (document.hidden && timer) flush(false); });

  async function setup(tok, rep) {
    const prev = [token(), repo()];
    localStorage.setItem(KEY_TOKEN, tok.trim());
    localStorage.setItem(KEY_REPO, rep.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, ""));
    cloud = null; lastError = null; blocked = false;
    try {
      await assertPrivate();
      await download(); // checks the key and the repository in one go
    } catch (e) {
      localStorage.setItem(KEY_TOKEN, prev[0]);
      localStorage.setItem(KEY_REPO, prev[1]);
      throw e;
    } finally { notify(); }
  }

  const hold = (reason) => { held = reason; clearTimeout(timer); timer = null; notify(); };
  const status = () => ({
    enabled: enabled(), repo: repo(), busy, blocked, lastError, held, cloud,
    lastAt: Number(localStorage.getItem(LAST_KEY) || 0),
  });

  return {
    enabled, download, bestSnapshot, describe, size, upload, schedule, flush, setup, hold, status,
    onChange: (f) => listeners.push(f),
  };
})();
