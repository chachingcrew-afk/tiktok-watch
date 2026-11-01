// "Termékcsomagok" (product kits): everything about a TikTok Shop product that a product page and its
// photos are later made from. Called by the web app with the signed-in owner's token, in the US region
// (the product page and TikTok's video files are served to US visitors).
//   { action: "info",  url }               -> product data (title, specs, description, colors, sizes, prices,
//                                             gallery, description images, rating, store, creator videos)
//   { action: "file",  url }               -> one image from TikTok's image servers (bytes)
//   { action: "video", item_id, author }   -> one creator video as mp4 (bytes)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const HTML_HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const IMG_HOST = /(^|\.)(ttcdn-us\.com|tiktokcdn-us\.com|tiktokcdn\.com|ibyteimg\.com|ttwstatic\.com|byteimg\.com)$/;
const TPLV = /~tplv-([a-z0-9]+)-[a-z\-]+(?::\d+:\d+)?\.(?:webp|jpeg|jpg|png|image)/;

// full-size JPEG instead of the 800px WebP the page uses
const jpeg = (url: string, size = 1600) => {
  url = url.replace(/&amp;/g, "&");
  return TPLV.test(url) ? url.replace(TPLV, (_m, k) => `~tplv-${k}-resize-jpeg:${size}:${size}.jpeg`) : url;
};
const first = (img: any) => (img && Array.isArray(img.url_list) && img.url_list[0]) || null;
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return isFinite(n) && String(v ?? "") !== "" ? n : null; };

async function resolveProductId(link: string): Promise<string | null> {
  const PRODUCT = /(?:\/pdp\/(?:[^/?#]+\/)?|\/view\/product\/|\/product\/)(\d{15,25})/;
  if (/^\d{15,25}$/.test(link)) return link;
  let id = (link.match(PRODUCT) || [])[1] || null;
  if (id) return id;
  try {
    const r = await fetch(link, { headers: HTML_HEADERS, redirect: "follow" });
    id = (r.url.match(PRODUCT) || [])[1] || null;
    await r.body?.cancel();
  } catch (_) { /* none */ }
  return id;
}

// the product data the page itself is rendered from (__MODERN_ROUTER_DATA__)
function productFromPage(html: string): { info: any; shop: any } | null {
  const m = html.match(/<script[^>]*id="__MODERN_ROUTER_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: any;
  try { data = JSON.parse(m[1]); } catch (_) { return null; }
  for (const page of Object.values(data?.loaderData || {}) as any[]) {
    for (const comp of page?.page_config?.components_map || []) {
      const cd = comp?.component_data;
      if (cd?.product_info?.product_id) return { info: cd.product_info, shop: cd.shop_info || null };
    }
  }
  return null;
}

function blockText(b: any): string {
  if (!b) return "";
  if (typeof b.text === "string") return b.text;
  if (Array.isArray(b.content)) return b.content.map((x: any) => typeof x === "string" ? x : (x?.text || "")).filter(Boolean).join("\n");
  if (typeof b.content === "string") return b.content;
  return "";
}

function kitFrom(productId: string, html: string) {
  const p = productFromPage(html);
  if (!p) return null;
  const info = p.info, shop = p.shop || {};
  const seller = info.seller || {};
  const colorProp = (info.sale_props || []).find((s: any) => /colou?r|shade|pattern/i.test(s?.prop_name || "")) || (info.sale_props || []).find((s: any) => s?.has_image);
  const sizeProp = (info.sale_props || []).find((s: any) => /size/i.test(s?.prop_name || ""));
  const colors = (colorProp?.sale_prop_values || []).map((v: any) => ({ name: v.prop_value, image: first(v.image) ? jpeg(first(v.image)) : null }));
  const sizes = (sizeProp?.sale_prop_values || []).map((v: any) => v.prop_value);
  const options = (info.sale_props || []).map((s: any) => ({ name: s.prop_name, values: (s.sale_prop_values || []).map((v: any) => v.prop_value) }));
  const skus = (info.skus || []).map((s: any) => {
    const o: any = {};
    for (const sp of s.sku_sale_props || []) o[sp.prop_name] = sp.prop_value;
    return { options: o, price: num(s.price?.sale_price_decimal), price_original: num(s.price?.origin_price_decimal), stock: s.stock ?? null };
  });
  const prices = skus.map((s: any) => s.price).filter((x: any) => x != null);
  const origs = skus.map((s: any) => s.price_original).filter((x: any) => x != null);
  const gallery = (info.images || []).map(first).filter(Boolean).map((u: string) => jpeg(u));
  const description: string[] = [], descImages: string[] = [];
  for (const b of info.desc_blocks || []) {
    if (b?.type === "image") { const u = first(b.image); if (u) descImages.push(jpeg(u, 1600)); }
    else { const t = blockText(b).trim(); if (t) description.push(t); }
  }
  const meta = (name: string) => { const mm = html.match(new RegExp(`<meta[^>]+name="${name}"[^>]+content="([^"]*)"`)); return mm ? mm[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"') : null; };
  return {
    product_id: productId,
    url: `https://shop.tiktok.com/us/pdp/x/${productId}`,
    title: info.title || null,
    summary: meta("description"),
    keywords: meta("keywords"),
    price: prices.length ? Math.min(...prices) : null,
    price_max: prices.length ? Math.max(...prices) : null,
    price_original: origs.length ? Math.max(...origs) : null,
    rating: num(info.review?.product_rating),
    review_count: num(info.review?.review_count),
    sold: num(info.sold_count ?? info.product_base?.sold_count),
    shop_name: seller.name || shop.shop_name || null,
    seller_id: seller.seller_id || shop.seller_id || null,
    shop_rating: num(seller.rating_value ?? seller.rating),
    shop_followers: num(seller.follower_count),
    specifications: (info.specifications || []).map((s: any) => ({ name: s.name, value: s.value })),
    description,
    options, colors, sizes, skus,
    gallery,
    description_images: descImages,
    fetched_at: new Date().toISOString(),
  };
}

// "Videos for this product": the same request the product page makes for its video list
async function creatorVideos(productId: string, sellerId: string | null) {
  const body = (seller: string | null) => {
    const pinfo: any = { product_id: productId };
    if (seller) pinfo.seller_id = seller;
    const page_config = {
      global_fe_config: { page_name: "product_detail" },
      global_api_data_config: { nova_config: { api: "nova_config", params: { resource_type_list: [1], nova_source_key_list: ["view_tts_web_seo_source_key_black_friday_settings"] } } },
      components_map: [{ component_type: "video_list", component_name: "video_list",
        fe_config: { data_source: { need_split_request: true, need_product_info: true, need_fetch_at_first_screen: false } } }],
      global_data: { product_info: { error_code: 0, product_info: { ...pinfo, product_model: { ...pinfo } } } },
    };
    return JSON.stringify({ page_config: JSON.stringify(page_config) });
  };
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch("https://shop.tiktok.com/api/shop/pdp_desktop/page_data", {
        method: "POST", body: body(a % 2 === 0 ? sellerId : null),
        headers: { "User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json, text/plain, */*",
          "Origin": "https://shop.tiktok.com", "Referer": `https://shop.tiktok.com/us/pdp/x/${productId}` },
      });
      if (r.ok) {
        const j = await r.json();
        if (j?.code === 0) {
          const out: any[] = [];
          for (const comp of j?.data?.components_map || []) {
            for (const v of comp?.component_data?.related_videos || []) {
              if (!v?.item_id) continue;
              out.push({ item_id: String(v.item_id), author: v.author_name || null, author_id: v.author_id ? String(v.author_id) : null,
                title: (v.title || "").trim() || null, plays: num(v.play_count), likes: num(v.like_count),
                duration_ms: num(v.duration), uploaded: v.upload_time ? new Date(Number(v.upload_time) * 1000).toISOString() : null,
                cover: v.cover_image_url || null });
            }
          }
          return out.sort((x, y) => (y.plays || 0) - (x.plays || 0));
        }
      }
    } catch (_) { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (a + 1)));
  }
  return [];
}

function cookieHeader(r: Response, jar: Map<string, string>) {
  const all = (r.headers as any).getSetCookie ? (r.headers as any).getSetCookie() : [r.headers.get("set-cookie") || ""];
  for (const c of all) { const m = String(c).match(/^\s*([^=;\s]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function videoFile(itemId: string, author: string | null): Promise<Response> {
  const jar = new Map<string, string>();
  for (let a = 0; a < 2; a++) {
    const page = await fetch(`https://www.tiktok.com/@${encodeURIComponent(author || "_")}/video/${itemId}`, { headers: HTML_HEADERS, redirect: "follow" });
    const cookies = cookieHeader(page, jar);
    const html = await page.text();
    const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) continue;
    let item: any = null;
    try { item = JSON.parse(m[1])?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct; } catch (_) { /* retry */ }
    const v = item?.video || {};
    for (const u of [v.playAddr, v.downloadAddr].filter(Boolean)) {
      const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": "https://www.tiktok.com/", "Range": "bytes=0-", "Cookie": cookies } });
      if ((r.status === 200 || r.status === 206) && (r.headers.get("content-type") || "").includes("video")) {
        return new Response(r.body, { status: 200, headers: { ...CORS, "Content-Type": "application/octet-stream", "X-File-Type": "video/mp4" } });
      }
      await r.body?.cancel();
    }
  }
  return json({ error: "A videót a TikTok most nem adta ki." }, 502);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/tr_is_owner`, {
    method: "POST", headers: { apikey, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  if (!who.ok || (await who.json()) !== true) return json({ error: "not allowed" }, 403);

  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "bad body" }, 400); }
  const action = String(body.action || "info");

  if (action === "file") {
    let u: URL;
    try { u = new URL(String(body.url || "")); } catch (_) { return json({ error: "bad url" }, 400); }
    if (u.protocol !== "https:" || !IMG_HOST.test(u.hostname)) return json({ error: "not a TikTok image" }, 400);
    for (let a = 0; a < 2; a++) {
      try {
        const r = await fetch(u.toString(), { headers: { "User-Agent": UA, "Referer": "https://shop.tiktok.com/", "Accept": "image/jpeg,image/*" } });
        if (r.ok) return new Response(r.body, { status: 200, headers: { ...CORS, "Content-Type": "application/octet-stream", "X-File-Type": r.headers.get("content-type") || "image/jpeg" } });
        await r.body?.cancel();
      } catch (_) { /* retry */ }
    }
    return json({ error: "A képet most nem sikerült letölteni." }, 502);
  }

  if (action === "video") {
    const id = String(body.item_id || "").replace(/\D/g, "");
    if (!id) return json({ error: "missing item_id" }, 400);
    try { return await videoFile(id, body.author ? String(body.author) : null); }
    catch (_) { return json({ error: "A videót most nem sikerült letölteni." }, 502); }
  }

  // info
  let link = String(body.url || "").trim();
  if (!/^\d+$/.test(link) && !/^https?:\/\//.test(link)) link = "https://" + link;
  if (!/^\d+$/.test(link)) {
    try { if (!/(^|\.)tiktok\.com$/.test(new URL(link).hostname)) return json({ error: "Ez nem TikTok Shop link." }, 400); }
    catch (_) { return json({ error: "Ez nem TikTok Shop link." }, 400); }
  }
  const productId = await resolveProductId(link);
  if (!productId) return json({ error: "Ezen a linken nem találtam TikTok Shop terméket." }, 400);
  let kit: any = null;
  for (let a = 0; a < 2 && !kit; a++) {
    try {
      const r = await fetch(`https://shop.tiktok.com/us/pdp/x/${productId}`, { headers: HTML_HEADERS });
      if (r.ok) kit = kitFrom(productId, await r.text());
    } catch (_) { /* retry */ }
  }
  if (!kit) return json({ error: "A termékoldalt most nem sikerült beolvasni. Próbáld újra pár perc múlva." }, 502);
  kit.videos = await creatorVideos(productId, kit.seller_id);
  return json(kit);
});
