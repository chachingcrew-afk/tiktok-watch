// "Videó link -> termék": which TikTok Shop products (and stores) are linked to a TikTok video.
// Called by the web app with the signed-in owner's token. Reads the public video page from the
// server (the TikTok app hides the shopping cart outside the US), then starts tracking the products.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const get = (url: string) => fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });

const parseMaybe = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch (_) { return null; } };

// every TikTok Shop product in the video's anchors (type 35 anchor -> list of type 33 items -> product)
function productsFrom(item: any) {
  const out: any[] = [], seen = new Set<string>();
  for (const a of item?.anchors || []) {
    for (const it of (parseMaybe(a?.extra) as any[]) || []) {
      if (!it || String(it.type) !== "33") continue;
      const d: any = parseMaybe(it.extra);
      if (!d || !d.product_id || seen.has(String(d.product_id))) continue;
      seen.add(String(d.product_id));
      const cats = (d.categories || []).map((c: any) => c?.category_name).filter(Boolean);
      const img = Array.isArray(d.img_url) ? d.img_url[0] : null;
      const price = d.price ?? d.min_price;
      out.push({
        product_id: String(d.product_id),
        title: (d.title || d.elastic_title || it.keyword || "").trim() || null,
        url: d.seo_url || `https://shop.tiktok.com/view/product/${d.product_id}?region=US`,
        image: d.cover_url || img || null,
        category: cats.join(" › ") || null,
        seller_id: d.seller_id ? String(d.seller_id) : null,
        shop_name: d.shop_name || d.seller_name || null,
        price: typeof price === "number" && price > 0 ? price : null,
      });
    }
  }
  return out;
}

// the store behind a product, from its product page
async function storeOf(productId: string) {
  try {
    const r = await get(`https://shop.tiktok.com/us/pdp/x/${productId}`);
    if (!r.ok) return null;
    const t = (await r.text()).replace(/\\\\\\"/g, '"').replace(/\\"/g, '"');
    const i = t.indexOf('"shop_info":{');
    if (i < 0) return null;
    const chunk = t.slice(i, i + 4000);
    const f = (re: RegExp) => { const m = chunk.match(re); return m ? m[1] : null; };
    return {
      shop_name: f(/"shop_name":"((?:[^"\\]|\\.)*)"/),
      seller_id: f(/"seller_id":"?(\d+)/),
      store_sold: Number(f(/"sold_count":"?(\d+)/)) || null,
      store_url: (f(/"shop_link":"([^"]+)"/) || "").replace(/\\u002F/g, "/") || null,
    };
  } catch (_) { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const rpc = (fn: string, args: unknown) => fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(args),
  });
  const who = await rpc("tr_is_owner", {});
  if (!who.ok || (await who.json()) !== true) return json({ error: "not allowed" }, 403);

  let body: { url?: string };
  try { body = await req.json(); } catch (_) { return json({ error: "bad body" }, 400); }
  let link = String(body.url || "").trim();
  if (!/^https?:\/\//.test(link)) link = "https://" + link;
  let host = "";
  try { host = new URL(link).hostname; } catch (_) { return json({ error: "Ez nem TikTok videó link." }, 400); }
  if (!/(^|\.)tiktok\.com$/.test(host)) return json({ error: "Ez nem TikTok videó link." }, 400);

  // short links (vm.tiktok.com, vt.tiktok.com, tiktok.com/t/...) redirect to the real video page
  let videoId = (link.match(/\/(?:video|photo)\/(\d{15,25})/) || [])[1] || null;
  if (!videoId) {
    try { const r = await get(link); videoId = (r.url.match(/\/(?:video|photo)\/(\d{15,25})/) || [])[1] || null; await r.body?.cancel(); } catch (_) { /* below */ }
  }
  if (!videoId) return json({ error: "Nem találtam videót ezen a linken." }, 400);

  let item: any = null;
  for (let a = 0; a < 2 && !item; a++) {
    try {
      const r = await get(`https://www.tiktok.com/@_/video/${videoId}`);
      const html = await r.text();
      const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) {
        const data = JSON.parse(m[1]);
        const detail = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
        item = detail?.itemInfo?.itemStruct || null;
        if (!item && detail?.statusCode) return json({ error: "A videó nem érhető el (törölték vagy privát)." }, 404);
      }
    } catch (_) { /* retry */ }
  }
  if (!item) return json({ error: "A TikTok most nem adta ki a videó adatait. Próbáld újra pár perc múlva." }, 502);

  const products = productsFrom(item);
  // store names for products we do not know the store of yet (product pages, at most 6)
  await Promise.all(products.slice(0, 6).map(async (p) => {
    if (p.shop_name) return;
    const s = await storeOf(p.product_id);
    if (s) { p.shop_name = s.shop_name || p.shop_name; p.seller_id = p.seller_id || s.seller_id; p.store_sold = s.store_sold; p.store_url = s.store_url; }
  }));
  let tracked: any[] = [];
  if (products.length) {
    const r = await rpc("tr_track_products", { products });
    if (r.ok) tracked = await r.json();
  }
  const extra = new Map(products.map((p) => [p.product_id, p]));
  const stats = item.statsV2 || item.stats || {};
  return json({
    video: {
      id: videoId,
      author: item.author?.uniqueId || null,
      desc: item.desc || "",
      created: item.createTime ? Number(item.createTime) : null,
      views: Number(stats.playCount) || null,
      likes: Number(stats.diggCount) || null,
      comments: Number(stats.commentCount) || null,
      cover: item.video?.cover || item.video?.originCover || null,
      url: `https://www.tiktok.com/@${item.author?.uniqueId || "_"}/video/${videoId}`,
    },
    products: tracked.map((t: any) => ({ ...t, store_sold: t.store_sold ?? extra.get(t.product_id)?.store_sold ?? null,
      store_url: t.store_url ?? extra.get(t.product_id)?.store_url ?? null })),
  });
});
