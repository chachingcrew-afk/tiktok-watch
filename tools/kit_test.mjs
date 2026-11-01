// Test harness for supabase/functions/tr-kit (run on the GitHub runner by probe_kit3.py).
import { kitFrom, creatorVideos, videoFile, resolveProductId } from "./kitlib.mjs";
const pid = await resolveProductId(process.argv[2] || "https://shop.tiktok.com/us/pdp/dress-by-oys-womens-one-shoulder-satin-high-split-cocktail-dress/1729467441089778277");
const html = await (await fetch(`https://shop.tiktok.com/us/pdp/x/${pid}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" } })).text();
const kit = kitFrom(pid, html);
const out = { pid, ok: !!kit };
if (kit) {
  kit.videos = await creatorVideos(pid, kit.seller_id);
  out.summary = { title: kit.title, price: kit.price, orig: kit.price_original, rating: kit.rating, reviews: kit.review_count, sold: kit.sold, shop: kit.shop_name,
    specs: kit.specifications.length, desc: kit.description, colors: kit.colors.length, sizes: kit.sizes, skus: kit.skus.length,
    gallery: kit.gallery.length, gallery0: kit.gallery[0], desc_images: kit.description_images.length, videos: kit.videos.length, video0: kit.videos[0] };
  const img = await fetch(kit.gallery[0], { headers: { Referer: "https://shop.tiktok.com/" } });
  out.img = { status: img.status, type: img.headers.get("content-type"), bytes: (await img.arrayBuffer()).byteLength };
  if (kit.videos[0]) {
    const r = await videoFile(kit.videos[0].item_id, kit.videos[0].author);
    out.video = { status: r.status, type: r.headers.get("X-File-Type"), bytes: (await r.arrayBuffer()).byteLength };
  }
}
console.log(JSON.stringify(out));
