// Copies a TikTok Shop product's gallery pictures into one of "Saját termékek" (my products).
// Called by the web app with the signed-in owner's token; the database functions check the owner,
// so this function only fetches the pictures (the browser cannot read TikTok's image server).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_IMAGES = 9;
const TPLV = /~tplv-([a-z0-9]+)-[a-z\-]+(?::\d+:\d+)?\.(?:webp|jpeg|jpg|png|image)/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function sized(url: string, size: number): string {
  url = url.replace(/&amp;/g, "&");
  return TPLV.test(url) ? url.replace(TPLV, (_m, k) => `~tplv-${k}-resize-jpeg:${size}:${size}.jpeg`) : url;
}

// The product gallery: the first "images":[...] array on the product page, in order.
function galleryUrls(html: string): string[] {
  const text = html.replace(/\\\\\\"/g, '"').replace(/\\"/g, '"');
  const i = text.indexOf('"images":[');
  const out: string[] = [];
  const seen = new Set<string>();
  if (i >= 0) {
    const start = text.indexOf("[", i);
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = start; j < Math.min(text.length, start + 200000); j++) {
      const c = text[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end > 0) {
      try {
        const items = JSON.parse(text.slice(start, end + 1));
        for (const it of Array.isArray(items) ? items : []) {
          const urls = it && Array.isArray(it.url_list) ? it.url_list : [];
          const key = (it && it.uri) || urls[0];
          if (urls.length && !seen.has(key)) { seen.add(key); out.push(String(urls[0]).replace(/&amp;/g, "&")); }
        }
      } catch (_) { /* fall through */ }
    }
  }
  if (!out.length) {
    for (const m of text.matchAll(/"url_list":\["(https:\/\/[^"]+)"/g)) {
      let u = m[1];
      try { u = JSON.parse('"' + u + '"'); } catch (_) { /* keep raw */ }
      const id = u.match(/\/([0-9a-f]{32})~/);
      if (id && !seen.has(id[1])) { seen.add(id[1]); out.push(u.replace(/&amp;/g, "&")); }
    }
  }
  return out;
}

async function b64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://shop.tiktok.com/", "Accept": "image/jpeg,image/*" } });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 500) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch (_) { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  let body: { my_product_id?: string; product_id?: string };
  try { body = await req.json(); } catch (_) { return json({ error: "bad body" }, 400); }
  const pid = String(body.product_id || "").replace(/\D/g, "");
  const mine = String(body.my_product_id || "");
  if (!pid || !/^[0-9a-f-]{36}$/.test(mine)) return json({ error: "missing ids" }, 400);

  const rpc = (fn: string, args: unknown) => fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(args),
  });
  // owner check before touching TikTok (the database refuses anyone else anyway)
  const who = await rpc("tr_is_owner", {});
  if (!who.ok || (await who.json()) !== true) return json({ error: "not allowed" }, 403);

  let html = "";
  for (let a = 0; a < 2 && !html; a++) {
    try {
      const r = await fetch(`https://shop.tiktok.com/us/pdp/x/${pid}`, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
      if (r.ok) html = await r.text();
    } catch (_) { /* retry */ }
  }
  if (!html) return json({ error: "product page not reachable" }, 502);
  const urls = galleryUrls(html).slice(0, MAX_IMAGES);
  let added = 0;
  for (const u of urls) {
    const [data, thumb] = await Promise.all([b64(sized(u, 1200)), b64(sized(u, 240))]);
    if (!data) continue;
    const r = await rpc("tr_add_my_image", { pid: mine, kind: "photo", data, thumb: thumb || null });
    if (r.ok) added++;
  }
  return json({ found: urls.length, added });
});
