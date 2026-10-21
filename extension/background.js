// Saves reviews to Termékradar (Supabase) as the signed-in Termékradar user.
const SUPA = "https://sapxyvfiqyshwnwarctj.supabase.co";
const KEY = "sb_publishable_A2y7JRVx02g5ptjl72pnMA_5OnqnkyJ";
const MAX_IMAGES = 220;        // per product
const THUMB = 220;             // px, longest side

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.cmd === "session") { chrome.storage.local.set({ session: msg.session }); return false; }
  if (msg.cmd === "save") { save(msg).then(reply, (e) => reply({ ok: false, error: String(e && e.message || e) })); return true; }
  return false;
});

async function token() {
  const { session } = await chrome.storage.local.get("session");
  if (!session || !session.access_token) throw new Error("Nem vagy belépve a Termékradarba. Nyisd meg a Termékradart egy fülön, aztán próbáld újra.");
  if (session.expires_at && session.expires_at * 1000 < Date.now() + 30000)
    throw new Error("Lejárt a Termékradar belépésed ebben a bővítményben. Nyisd meg (vagy frissítsd) a Termékradart, aztán próbáld újra.");
  return session.access_token;
}

async function thumb(url) {
  try {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const s = Math.min(1, THUMB / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.66 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch (_) { return null; }
}

async function save({ pid, summary, reviews }) {
  const jwt = await token();
  // thumbnails: the problems first (low stars), at most 2 per review
  const jobs = [];
  const order = reviews.slice().sort((a, b) => (a.rating || 5) - (b.rating || 5));
  for (const r of order) {
    const urls = r.images || []; r.images = [];
    for (const u of urls.slice(0, r.rating <= 3 ? 2 : 1)) if (jobs.length < MAX_IMAGES) jobs.push([r, u]);
  }
  let images = 0;
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(async ([r, u]) => { const b = await thumb(u); if (b) { r.images.push(b); images++; } }));
  }
  let saved = 0;
  for (let i = 0; i < reviews.length; i += 60) {
    const chunk = reviews.slice(i, i + 60);
    const last = i + 60 >= reviews.length;
    const res = await fetch(SUPA + "/rest/v1/rpc/tr_save_reviews", {
      method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
      body: JSON.stringify({ pid, summary, reviews: chunk, done: last }),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 401) throw new Error("Lejárt a Termékradar belépésed. Nyisd meg (vagy frissítsd) a Termékradart, aztán próbáld újra.");
      throw new Error("Mentési hiba (" + res.status + "): " + t.slice(0, 160));
    }
    saved += Number(await res.json()) || 0;
  }
  return { ok: true, saved, images };
}
