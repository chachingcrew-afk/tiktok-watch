// "Videó / termék link": which TikTok Shop products (and stores) are linked to a TikTok video, or what
// a TikTok Shop product link is. Called by the web app with the signed-in owner's token, in the US
// region (TikTok hides the shop links from European visitors). Read only: adding a product to the
// watch list is a separate call from the page (tr_watch_products).
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

// a product page: name, picture, price, units sold, and the store behind it
async function productPage(productId: string) {
  try {
    const r = await get(`https://shop.tiktok.com/us/pdp/x/${productId}`);
    if (!r.ok) return null;
    const raw = await r.text();
    const t = raw.replace(/\\\\\\"/g, '"').replace(/\\"/g, '"');
    const meta = (prop: string) => { const m = raw.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`)) || raw.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`)); return m ? m[1] : null; };
    const unent = (x: string | null) => x ? x.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : x;
    const out: any = { product_id: productId };
    let title = unent(meta("og:title"));
    if (!title) { const m = raw.match(/<title>([^<]*)<\/title>/); title = m ? unent(m[1]) : null; }
    out.title = title ? title.replace(/\s*-\s*TikTok Shop\s*$/i, "").trim() : null;
    out.image = unent(meta("og:image"));
    const pm = t.match(/"min_sku_price":\s*"([\d.,]+)"/);
    out.price = pm ? Number(pm[1].replace(/,/g, "")) : null;
    let sm = t.match(new RegExp(`"sold_count":\\s*"?(\\d+)"?,\\s*"product_id":\\s*"${productId}"`));
    if (!sm) { const st = t.indexOf('"product_info":'); if (st >= 0) sm = t.slice(st, st + 3000).match(/"sold_count":\s*"?(\d+)/); }
    out.sold_now = sm ? Number(sm[1]) : null;
    const cats = [...new Set([...t.matchAll(/"category_name":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]))].slice(0, 3);
    out.category = cats.length ? cats.join(" › ") : null;
    out.url = `https://shop.tiktok.com/us/pdp/x/${productId}`;
    const i = t.indexOf('"shop_info":{');
    if (i >= 0) {
      const chunk = t.slice(i, i + 4000);
      const f = (re: RegExp) => { const m = chunk.match(re); return m ? m[1] : null; };
      out.shop_name = f(/"shop_name":"((?:[^"\\]|\\.)*)"/);
      out.seller_id = f(/"seller_id":"?(\d+)/);
      out.store_sold = Number(f(/"sold_count":"?(\d+)/)) || null;
      out.store_url = (f(/"shop_link":"([^"]+)"/) || "").replace(/\\u002F/g, "/") || null;
    }
    return out;
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

  // short links (vm.tiktok.com, vt.tiktok.com, tiktok.com/t/...) redirect to the real page
  const VIDEO = /\/(?:video|photo)\/(\d{15,25})/;
  const PRODUCT = /(?:\/pdp\/(?:[^/?#]+\/)?|\/view\/product\/|\/product\/)(\d{15,25})/;
  let videoId = (link.match(VIDEO) || [])[1] || null;
  let productId = videoId ? null : (link.match(PRODUCT) || [])[1] || null;
  if (!videoId && !productId) {
    try {
      const r = await get(link);
      videoId = (r.url.match(VIDEO) || [])[1] || null;
      productId = videoId ? null : (r.url.match(PRODUCT) || [])[1] || null;
      await r.body?.cancel();
    } catch (_) { /* below */ }
  }
  if (!videoId && !productId) return json({ error: "Ezen a linken nem találtam TikTok videót vagy TikTok Shop terméket." }, 400);

  // what we already know about these products (no changes here: adding to tracking is a separate click)
  const known = async (ids: string[]) => {
    if (!ids.length) return new Map();
    const r = await rpc("tr_products_info", { ids });
    const rows: any[] = r.ok ? await r.json() : [];
    return new Map(rows.map((x) => [x.product_id, x]));
  };

  if (productId) {
    const [page, db] = await Promise.all([productPage(productId), known([productId])]);
    const k = db.get(productId);
    if (!page && !k) return json({ error: "A termékoldal most nem érhető el. Próbáld újra pár perc múlva." }, 502);
    return json({ kind: "product", products: [{ ...(page || {}), ...(k ? Object.fromEntries(Object.entries(k).filter(([, v]) => v !== null)) : {}), known: !!k }] });
  }

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
  const db = await known(products.map((p) => p.product_id));
  // store and sales for products we do not know yet (product pages, at most 6)
  await Promise.all(products.slice(0, 6).map(async (p) => {
    if (db.has(p.product_id)) return;
    const s = await productPage(p.product_id);
    if (s) for (const key of ["shop_name", "seller_id", "store_sold", "store_url", "sold_now", "price", "image"]) if (p[key] == null && s[key] != null) p[key] = s[key];
  }));
  const stats = item.statsV2 || item.stats || {};
  return json({
    kind: "video",
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
    products: products.map((p) => {
      const k = db.get(p.product_id);
      return { ...p, ...(k ? Object.fromEntries(Object.entries(k).filter(([, v]) => v !== null)) : {}), known: !!k };
    }),
  });
});
