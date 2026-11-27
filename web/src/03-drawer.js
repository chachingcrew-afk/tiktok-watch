
  // ---------- product drawer ----------
  const cache = { gallery: {}, galurls: {}, videos: {}, hist: {}, reviews: {}, pcomments: {}, fb: {} };
  let galIdx = 0, lastFocus = null;
  const current = () => P.rows.find(x => x.product_id === P.sel) || P.extra[P.sel];
  async function openProduct(id) {
    lastFocus = document.activeElement;
    P.sel = id; galIdx = 0;
    $("drawer").hidden = false; $("scrim").hidden = false; document.body.style.overflow = "hidden";
    if (!current()) {
      fill($("drawer"), el("div", { class: "d-top" }, el("span", { class: "crumbs" }, "Loading…"), closeBtn()), el("div", { class: "d-sec" }, el("div", { class: "d-note" }, "Loading the product…")));
      try {
        const r = await rpc("tr_shop_page", { p: { ids: [id], seg: "all", f: { brand: "show" } } });
        const row = r && r.rows && r.rows[0];
        if (row) P.extra[id] = row;
      } catch (_) {}
      if (P.sel !== id) return;
      if (!current()) { fill($("drawer"), el("div", { class: "d-top" }, el("span", { class: "crumbs" }, ""), closeBtn()), el("div", { class: "d-sec" }, el("div", { class: "d-note" }, "This product is not in the database yet."))); return; }
    }
    renderDrawer(); renderList(); $("drawer").scrollTop = 0;
    setTimeout(() => { const b = $("drawer").querySelector(".d-top .icon-btn"); if (b) b.focus({ preventScroll: true }); }, 30);
  }
  const closeBtn = (fn) => el("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: fn || closeDrawer }, icon("M6 6l12 12M18 6L6 18"));
  function closeDrawer() {
    if (typeof MY !== "undefined") MY.edit = null;
    const was = P.sel; P.sel = null;
    $("drawer").hidden = true; $("scrim").hidden = true; document.body.style.overflow = "";
    if (was) renderList();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (LB.open) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === "ArrowLeft") stepLightbox(-1);
      return;
    }
    if (e.key === "Escape" && !$("fpanel").hidden) { closeFilters(); return; }
    if (e.key === "Escape" && !$("msheet").hidden) { closeMore(); return; }
    if ($("drawer").hidden) return;
    if (e.key === "Escape") closeDrawer();
    const tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.key === "ArrowRight") stepGallery(1);
    if (e.key === "ArrowLeft") stepGallery(-1);
  });
  async function ensure(kind, id, fn) {
    if (cache[kind][id] !== undefined) return;
    cache[kind][id] = null;
    try { cache[kind][id] = await fn(); } catch (_) { cache[kind][id] = false; }
    if (P.sel === id) renderDrawer();
  }
  function renderDrawer() {
    const p = current(), d = $("drawer");
    if (!p) { closeDrawer(); return; }
    const id = p.product_id;
    if (p.gallery_count) ensure("gallery", id, async () => (await rpc("tr_gallery", { p_product_id: id }) || []).map(r => r.data));
    if (p.gallery_count) ensure("galurls", id, () => rpc("tr_gallery_urls", { p_product_id: id }));
    ensure("hist", id, () => rpc("tr_sales_history", { p_product_id: id }));
    if (p.video_count || p.fresh_videos) ensure("videos", id, () => rpc("tr_product_videos", { p_product_id: id }));
    const orig = p.price_original && Number(p.price_original) > Number(p.price) ? Number(p.price_original) : null;
    const stat = (v, l, c) => el("div", { class: "stat " + (c || "") }, el("b", {}, v), el("span", {}, l));
    const keep = d.scrollTop;
    fill(d,
      el("div", { class: "d-top" }, el("span", { class: "crumbs" }, [p.niche ? nicheName(p.niche) : null, p.category_name, p.shop_name].filter(Boolean).join(" · ")), closeBtn()),
      el("div", { class: "d-hero" }, galleryEl(p),
        el("div", { class: "d-info" },
          el("h2", {}, p.title || "Untitled product"),
          el("div", { class: "d-price" }, usd(p.price), orig ? el("s", {}, usd(orig)) : null),
          el("div", { class: "pmeta" }, p.rating ? el("span", {}, `★ ${dec(p.rating)} · ${nf(p.reviews)} reviews`) : null,
            p.brand ? el("span", { class: "chip" }, "Brand: " + p.brand) : null,
            Number(p.other_shops) > 0 ? el("span", { class: "chip money" }, `${Number(p.other_shops) + 1} sellers`) : null,
            isWin(p) ? el("span", { class: "chip money" }, "Winner") : null, isHot(p) ? el("span", { class: "chip heat" }, "Hot") : null),
          el("div", { class: "d-actions" },
            el("button", { type: "button", class: "btn" + (p.starred ? " on" : ""), onclick: () => toggleProductStar(p) }, p.starred ? "★ Starred" : "☆ Star"),
            p.url ? chromeLink(p.url, { class: "btn" }, "TikTok Shop ↗") : null,
            el("button", { type: "button", class: "btn", title: "Adds it to My products, where you keep supplier links, photos and costs", onclick: () => addToMine(p) }, "+ My products"),
            p.image ? el("a", { class: "btn", href: "https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(p.image), target: "_blank", rel: "noopener", title: "Reverse image search: who else sells it, e.g. on AliExpress" }, "Find suppliers ↗") : null,
            p.hidden ? el("button", { type: "button", class: "btn", onclick: () => setProductHidden(p, false) }, "Restore")
                     : el("button", { type: "button", class: "btn danger", onclick: () => setProductHidden(p, true) }, "Hide")),
          storeNote(p),
          p.brand ? el("div", { class: "d-note" }, `Known brand (${p.brand}): designs and makes its own products, not dropshippable.`) : null,
          Number(p.other_shops) > 0 ? el("div", { class: "d-note" }, `Also sold by: ${(p.twin_shops || []).join(", ")}. Most likely from a shared factory.`) : null)),
      el("div", { class: "d-sec" },
        el("h3", {}, "Sales", el("span", {}, p.sold_checked_at ? "measured " + ago(p.sold_checked_at) : "")),
        el("div", { class: "stats" },
          stat(p.revenue_per_day != null ? money(p.revenue_per_day) : "–", "revenue per day", isWin(p) ? "money" : ""),
          stat(p.sold_per_day != null ? "+" + nf(p.sold_per_day) : "–", "units per day"),
          stat(p.sold_per_day_recent != null ? "+" + nf(p.sold_per_day_recent) : "–", "current pace (6 h)", p.sold_per_day_recent != null && Number(p.sold_per_day_recent) > Number(p.sold_per_day) * 1.2 ? "heat" : ""),
          stat(p.revenue_per_day != null ? money(Number(p.revenue_per_day) * 30) : "–", "estimated per month"),
          stat(short(p.sold_now), "sold in total"),
          stat(p.growth_pct != null ? "+" + pct(p.growth_pct) : "–", "growth per day", Number(p.growth_pct) >= 5 ? "heat" : ""),
          stat(p.trend != null ? "×" + dec(p.trend) : "–", "pace vs. day before", Number(p.trend) > 1.2 ? "heat" : ""),
          stat(p.sold_per_day_week != null ? "+" + nf(p.sold_per_day_week) : "–", "daily average this week")),
        salesChart(cache.hist[id]),
        periodSection(cache.hist[id], Number(p.price) || 0),
        el("div", { class: "d-note" }, "Revenue is the current price times the units sold per day, from TikTok Shop's sold counter. Growth: units sold per day as a share of all units sold so far.")),
      videosSection(p),
      commentsSection(p),
      fbProductSection(p),
      reviewsSection(p));
    d.scrollTop = keep;
  }
  function storeNote(p) {
    if (!p.seller_id || (p.store_sold == null && !p.store_url)) return null;
    const parts = [];
    if (p.store_sold != null) parts.push(`${short(p.store_sold)} sold in total`);
    if (p.store_per_day != null) parts.push(`about ${nf(p.store_per_day)} a day`);
    if (p.store_tracked != null) parts.push(`tracked products: ${nf(p.store_tracked)}/day`);
    if (p.store_added) parts.push(`${nf(p.store_added)} products added from this shop`);
    return el("div", { class: "d-note" }, "Shop: ", p.store_url ? el("a", { href: p.store_url, target: "_blank", rel: "noopener" }, (p.shop_name || "open") + " ↗") : (p.shop_name || ""), parts.length ? " · " + parts.join(" · ") : "");
  }

  // ---------- Facebook ads of the product ----------
  const fbDays = (a) => a.days != null ? a.days : a.start_date ? Math.max(0, Math.round(((a.end_date && !a.is_active ? new Date(a.end_date) : new Date()) - new Date(a.start_date)) / 864e5)) : null;
  const fbLib = (id) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
  const BASE_FB = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&search_type=keyword_unordered&q=";
  function fbProductSection(p) {
    const id = p.product_id;
    ensure("fb", id, async () => (await rpc("tr_fb_product", { pid: id })) || { none: true });
    const r0 = cache.fb[id], r = r0 && !r0.none ? r0 : null;
    let body;
    if (r0 === undefined || r0 === null) body = el("div", { class: "d-note" }, "Loading…");
    else if (r0 === false) body = el("div", { class: "d-note" }, "Could not load.");
    else if (!r) body = el("div", { class: "d-note" }, "Not checked yet. The Facebook ads job works down the list from the best sellers.");
    else {
      const ads = r.ads || [];
      body = el("div", {},
        el("div", { class: "d-note" }, `Search: “${r.query}” · ${r.results_est != null ? `about ${nf(r.results_est)} active ads in the US` : "no result count"} · ${ago(r.checked_at)} · `,
          el("a", { href: BASE_FB + encodeURIComponent(r.query || ""), target: "_blank", rel: "noopener noreferrer" }, "Ad Library ↗")),
        ads.length ? el("div", { class: "fb-mini" }, ads.slice(0, 8).map(a => el("a", { class: "fb-minirow", href: fbLib(a.id), target: "_blank", rel: "noopener noreferrer" },
          el("b", {}, a.page_name || "?"), el("span", {}, `${nf(fbDays(a) ?? 0)} days`), el("span", {}, Number(a.collation_count) > 1 ? `${a.collation_count} versions` : ""),
          el("span", { class: "muted" }, a.domain || "")))) : null);
    }
    return el("div", { class: "d-sec" }, el("h3", {}, "Facebook ads", el("span", {}, r && r.results_est != null ? `~${nf(r.results_est)}` : "")), body);
  }

  // ---------- creator-video comments ----------
  const CTAGS = [["intent", "Buying intent"], ["size", "Size & fit"], ["material", "Material & quality"], ["price", "Price, shipping, stock"],
    ["color", "Colours"], ["owner", "Buyer experiences"], ["dupe", "Bought elsewhere / dupes"]];
  function commentsSection(p) {
    const id = p.product_id;
    ensure("pcomments", id, () => rpc("tr_product_comments", { pid: id }));
    const r = cache.pcomments[id];
    let body;
    if (r === undefined || r === null) body = el("div", { class: "d-note" }, "Loading…");
    else if (r === false) body = el("div", { class: "d-note" }, "Could not load the comments.");
    else {
      const cm = r.comments || [];
      if (!cm.length) body = el("div", { class: "d-note" }, r.at ? "No relevant comments (buying intent, size, material, price…) under the videos."
        : Number(r.videos) ? "Not collected yet. About 35 products an hour, best sellers first." : "This product has no creator videos yet, so there are no comments.");
      else body = commentGroups(cm);
    }
    const n = r && r.comments ? r.comments.length : 0;
    return el("div", { class: "d-sec" }, el("h3", {}, "Comments under the videos", el("span", {}, n ? `${nf(n)} relevant` + (r.at ? " · " + ago(r.at) : "") : "")), body);
  }
  function commentGroups(cm) {
    return el("div", { class: "kit-comments" }, CTAGS.map(([key, label]) => {
      const xs = cm.filter(c => (c.tags || []).includes(key));
      if (!xs.length) return null;
      return el("details", { open: key === "intent" ? "" : null }, el("summary", {}, `${label} (${xs.length})`),
        el("ul", {}, xs.slice(0, 50).map(c => el("li", {}, String(c.text || ""), c.likes ? el("span", { class: "muted" }, ` · ${nf(c.likes)} ♥`) : null))));
    }));
  }

  // ---------- image viewer ----------
  const LB = { open: false, list: [], i: 0, node: null };
  function openLightbox(list, i) {
    LB.list = list.filter(Boolean); if (!LB.list.length) return;
    LB.i = Math.min(Math.max(0, i || 0), LB.list.length - 1); LB.open = true;
    if (!LB.node) {
      LB.node = el("div", { class: "lb", role: "dialog", "aria-modal": "true", "aria-label": "Image viewer", onclick: (e) => { if (e.target === LB.node || e.target.classList.contains("lb-stage")) closeLightbox(); } });
      document.body.append(LB.node);
    }
    renderLightbox();
  }
  function renderLightbox() {
    const item = LB.list[LB.i];
    const im = el("img", { src: item.src, alt: "Enlarged image" });
    if (item.fallback) im.addEventListener("error", () => { if (im.src !== item.fallback) im.src = item.fallback; }, { once: true });
    const many = LB.list.length > 1;
    fill(LB.node, el("div", { class: "lb-stage" }, im),
      el("button", { type: "button", class: "lb-close", "aria-label": "Close", onclick: closeLightbox }, "×"),
      many ? el("button", { type: "button", class: "lb-nav prev", "aria-label": "Previous image", onclick: () => stepLightbox(-1) }, "‹") : null,
      many ? el("button", { type: "button", class: "lb-nav next", "aria-label": "Next image", onclick: () => stepLightbox(1) }, "›") : null,
      many ? el("span", { class: "lb-count" }, `${LB.i + 1} / ${LB.list.length}`) : null);
    LB.node.hidden = false;
    LB.node.querySelector(".lb-close").focus();
  }
  function stepLightbox(d) { if (LB.list.length < 2) return; LB.i = (LB.i + d + LB.list.length) % LB.list.length; renderLightbox(); }
  function closeLightbox() { LB.open = false; if (LB.node) LB.node.hidden = true; }
  function gallerySources(p, shown) {
    const urls = cache.galurls[p.product_id];
    return shown.map((small, i) => {
      const orig = Array.isArray(urls) && urls[i] ? urls[i] : (i === 0 && p.image ? p.image : null);
      return { src: orig ? big(orig) : small, fallback: small };
    });
  }
  function galleryList(p) {
    const imgs = cache.gallery[p.product_id];
    return Array.isArray(imgs) && imgs.length ? imgs.map(b => b.startsWith("r2:") ? media(b.slice(3)) : "data:image/webp;base64," + b).filter(Boolean) : (p.image ? [sized(p.image, 600)] : []);
  }
  function galleryEl(p) {
    const list = galleryList(p);
    if (galIdx >= list.length) galIdx = 0;
    const main = el("div", { class: "gal-main" });
    if (list.length) main.append(el("img", { src: list[galIdx], alt: p.title || "", referrerpolicy: "no-referrer", class: "zoomable", title: "Click to enlarge", onclick: () => openLightbox(gallerySources(p, list), galIdx) }));
    else main.append("No image");
    if (list.length > 1) main.append(
      el("button", { type: "button", class: "gal-nav prev", "aria-label": "Previous image", onclick: () => stepGallery(-1) }, "‹"),
      el("button", { type: "button", class: "gal-nav next", "aria-label": "Next image", onclick: () => stepGallery(1) }, "›"),
      el("span", { class: "gal-count" }, `${galIdx + 1} / ${list.length}`));
    const strip = list.length > 1 ? el("div", { class: "gal-strip" }, list.map((src, i) => el("button", { type: "button", "aria-current": String(i === galIdx), "aria-label": `Image ${i + 1}`, onclick: () => { galIdx = i; renderDrawer(); } }, el("img", { src, alt: "" })))) : null;
    return el("div", { class: "gal" }, main, strip);
  }
  function stepGallery(d) {
    const p = current(); if (!p) return;
    const n = galleryList(p).length;
    if (n < 2) return;
    galIdx = (galIdx + d + n) % n; renderDrawer();
  }

  // ---------- product videos ----------
  const oembed = {};
  let oembedActive = 0; const oembedQueue = [];
  function coverFor(v, box) {
    const id = v.item_id;
    const put = (info) => {
      if (!info || !info.thumbnail_url) return;
      const i = el("img", { src: info.thumbnail_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
      i.addEventListener("error", () => i.remove(), { once: true });
      box.prepend(i);
      const a = box.closest("a");
      if (a && info.author_unique_id) a.href = `https://www.tiktok.com/@${info.author_unique_id}/video/${id}`;
    };
    if (oembed[id] !== undefined) { if (oembed[id] && oembed[id].then) oembed[id].then(put); else put(oembed[id]); return; }
    oembed[id] = new Promise((resolve) => {
      const run = async () => {
        oembedActive++;
        try {
          const r = await fetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent("https://www.tiktok.com/video/" + id));
          const info = r.ok ? await r.json() : null;
          oembed[id] = info; resolve(info);
        } catch (_) { oembed[id] = null; resolve(null); }
        finally { oembedActive--; const next = oembedQueue.shift(); if (next) next(); }
      };
      if (oembedActive < 4) run(); else oembedQueue.push(run);
    });
    oembed[id].then(put);
  }
  const isFresh = (v) => !!v.upload_time && Date.now() - new Date(v.upload_time).getTime() < setting("hot_video_days") * 864e5;
  function vcover(v, ...overlay) {
    const box = el("div", { class: "vcover" }, ...overlay);
    const cv = v.cover ? (v.cover.startsWith("r2:") ? media(v.cover.slice(3)) : "data:image/jpeg;base64," + v.cover) : null;
    if (cv) box.prepend(el("img", { src: cv, alt: "" }));
    else coverFor(v, box);
    return box;
  }
  const PV = {};
  function videosSection(p) {
    const head = el("h3", {}, "Creator videos", el("span", {}, (p.video_count ? `${nf(p.video_count)} videos · ${short(p.video_views)} views` : "") + (Number(p.fresh_videos) ? ` · ${nf(p.fresh_videos)} fresh` : "")));
    if (!p.video_count && !p.fresh_videos) return el("div", { class: "d-sec" }, head, el("div", { class: "d-note" }, p.video_count === 0 ? "TikTok Shop shows no video for this product." : "Videos are downloaded daily for products with 100+ sales and for starred products."));
    const vids = cache.videos[p.product_id];
    if (!Array.isArray(vids)) return el("div", { class: "d-sec" }, head, el("div", { class: "d-note" }, vids === false ? "Could not load the videos." : "Loading videos…"));
    const sorted = vids.slice().sort((a, b) => (isFresh(b) - isFresh(a)) || (Number(b.play_count) - Number(a.play_count)));
    const lim = PV[p.product_id] || 24;
    return el("div", { class: "d-sec" }, head,
      el("div", { class: "vgrid" }, sorted.slice(0, lim).map(v => {
        const days = v.prev_checked_at ? Math.max((new Date(v.checked_at) - new Date(v.prev_checked_at)) / 864e5, 0.25) : null;
        const grow = days && v.prev_play_count != null ? (Number(v.play_count) - Number(v.prev_play_count)) / days : null;
        return el("a", { class: "vcard", href: "https://www.tiktok.com/@/video/" + v.item_id, target: "_blank", rel: "noopener", title: v.title || "" },
          vcover(v, el("span", { class: "views" }, "▶ " + short(v.play_count)),
            grow > 0 ? el("span", { class: "grow" }, "+" + short(grow) + "/day") : isFresh(v) ? el("span", { class: "grow", style: "background:var(--heat)" }, "fresh") : null),
          el("div", { class: "vname" }, v.author_name || "?"),
          el("div", { class: "vsub" }, `♥ ${short(v.like_count)}` + (v.upload_time ? " · " + ago(v.upload_time) : "")));
      })),
      sorted.length > lim ? el("button", { type: "button", class: "btn wide", onclick: () => { PV[p.product_id] = lim + 24; renderDrawer(); } }, `Show ${Math.min(24, sorted.length - lim)} more videos`) : null,
      el("div", { class: "d-note" }, "Fresh videos from the daily collection first, then the videos on the TikTok Shop product page by views."));
  }

  // ---------- charts ----------
  function lineChart(points, color, label, emptyText) {
    const w = 600, h = 170, L = 50, R = 10, T = 10, B = 24;
    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", role: "img" });
    if (!Array.isArray(points) || points.length < 2) {
      const t = svgEl("text", { x: w / 2, y: h / 2, "text-anchor": "middle", fill: "var(--muted)", "font-size": 13 });
      t.textContent = points === undefined || points === null ? "Loading…" : emptyText; svg.append(t); return svg;
    }
    const xs = points.map(q => q[0]), ys = points.map(q => Number(q[1]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = x => L + (x - x0) / Math.max(x1 - x0, 1) * (w - L - R), sy = y => T + (1 - (y - y0) / Math.max(y1 - y0, 1)) * (h - T - B);
    for (const v of (y1 > y0 ? [y0, (y0 + y1) / 2, y1] : [y0])) {
      svg.append(svgEl("line", { x1: L, x2: w - R, y1: sy(v), y2: sy(v), stroke: "var(--line)", "stroke-width": 1 }));
      const t = svgEl("text", { x: L - 6, y: sy(v) + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": 11 }); t.textContent = short(v); svg.append(t);
    }
    for (const [x, a] of [[x0, "start"], [x1, "end"]]) { const t = svgEl("text", { x: sx(x), y: h - 6, "text-anchor": a, fill: "var(--muted)", "font-size": 11 }); t.textContent = when(x * 1000); svg.append(t); }
    const d = points.map((q, i) => (i ? "L" : "M") + sx(q[0]).toFixed(1) + " " + sy(Number(q[1])).toFixed(1)).join(" ");
    svg.append(svgEl("path", { d: d + ` L${sx(x1)} ${h - B} L${sx(x0)} ${h - B} Z`, fill: color, opacity: .1, stroke: "none" }));
    svg.append(svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linejoin": "round" }));
    svg.setAttribute("aria-label", `${label}: ${nf(ys[0])} → ${nf(ys[ys.length - 1])}`);
    return svg;
  }
  const salesChart = (pts) => lineChart(pts, "var(--money)", "Units sold", "The curve appears after the second measurement.");
  function dailySales(pts) {
    if (!Array.isArray(pts) || pts.length < 2) return [];
    const last = new Map();
    for (const [t, s] of pts) last.set(Math.floor(t / 86400), Number(s));
    const days = [...last.keys()].sort((a, b) => a - b), out = [];
    for (let i = 1; i < days.length; i++) {
      const d0 = days[i - 1], d1 = days[i], v = Math.max(0, last.get(d1) - last.get(d0)) / (d1 - d0);
      for (let d = d0 + 1; d <= d1; d++) out.push([d, v]);
    }
    return out;
  }
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayDate = (d) => new Date(d * 864e5);
  const mdLabel = (d) => { const x = dayDate(d); return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}`; };
  function periodBuckets(pts, per) {
    const daily = dailySales(pts);
    if (!daily.length) return [];
    const today = Math.floor(Date.now() / 864e5);
    if (per === "day") return daily.map(([d, v]) => [mdLabel(d), v, d >= today]);
    const m = new Map();
    for (const [d, v] of daily) {
      const k = per === "week" ? d - ((d + 3) % 7) : dayDate(d).getUTCFullYear() * 12 + dayDate(d).getUTCMonth();
      const a = m.get(k) || { v: 0, n: 0 }; a.v += v; a.n++; m.set(k, a);
    }
    const first = daily[0][0];
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, a]) => {
      if (per === "week") return ["Week of " + mdLabel(k), a.v, k + 6 >= today || k < first];
      const y = Math.floor(k / 12), mo = k % 12, len = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      return [MON[mo] + (mo === 0 ? " " + y : ""), a.v, a.n < len];
    });
  }
  function barChart(buckets, color, emptyText, price) {
    const w = 600, h = 170, L = 50, R = 10, T = 10, B = 24;
    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", role: "img" });
    if (!buckets.length) {
      const t = svgEl("text", { x: w / 2, y: h / 2, "text-anchor": "middle", fill: "var(--muted)", "font-size": 13 });
      t.textContent = emptyText; svg.append(t); return svg;
    }
    const y1 = Math.max(1, ...buckets.map(b => b[1])), sy = y => T + (1 - y / y1) * (h - T - B);
    for (const v of [0, y1 / 2, y1]) {
      svg.append(svgEl("line", { x1: L, x2: w - R, y1: sy(v), y2: sy(v), stroke: "var(--line)", "stroke-width": 1 }));
      const t = svgEl("text", { x: L - 6, y: sy(v) + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": 11 }); t.textContent = short(Math.round(v)); svg.append(t);
    }
    const slot = (w - L - R) / buckets.length, bw = Math.max(2, Math.min(40, slot * 0.7));
    const every = Math.ceil(buckets.length / 8);
    const bars = [];
    buckets.forEach(([label, v, partial], i) => {
      const x = L + i * slot + (slot - bw) / 2, top = sy(v);
      const r = svgEl("rect", { x: x.toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: Math.max(0, h - B - top).toFixed(1), rx: Math.min(4, bw / 3), fill: color, opacity: partial ? .4 : .9 });
      svg.append(r); bars.push(r);
      svg.append(svgEl("rect", { x: (L + i * slot).toFixed(1), y: T, width: slot.toFixed(1), height: h - T - B, fill: "transparent", "data-i": i }));
      if (i % every === 0 || i === buckets.length - 1) {
        if (i !== buckets.length - 1 && buckets.length - 1 - i < every) return;
        const t = svgEl("text", { x: x + bw / 2, y: h - 6, "text-anchor": "middle", fill: "var(--muted)", "font-size": 11 }); t.textContent = label.replace("Week of ", ""); svg.append(t);
      }
    });
    svg.setAttribute("aria-label", "Units sold per period: " + buckets.map(b => `${b[0]} ${Math.round(b[1])}`).join(", "));
    const tip = el("div", { class: "bar-tip", hidden: true });
    const box = el("div", { class: "bar-wrap" }, svg, tip);
    const showTip = (i) => {
      const [label, v, partial] = buckets[i];
      bars.forEach((b, j) => b.setAttribute("opacity", j === i ? 1 : (buckets[j][2] ? .3 : .55)));
      fill(tip, el("b", {}, label), el("span", {}, `${nf(Math.round(v))} units sold`), price ? el("span", {}, `≈ ${money(Math.round(v * price))} revenue`) : null, partial ? el("em", {}, "period not complete yet") : null);
      tip.hidden = false;
      const sw = box.clientWidth / w, cx = (L + (i + .5) * slot) * sw;
      tip.style.left = Math.min(Math.max(cx, 70), box.clientWidth - 70) + "px";
      tip.style.top = Math.max(0, sy(v) * (box.clientHeight / h) - 8) + "px";
    };
    const hide = () => { tip.hidden = true; bars.forEach((b, j) => b.setAttribute("opacity", buckets[j][2] ? .4 : .9)); };
    svg.addEventListener("mouseover", (e) => { const i = e.target.getAttribute && e.target.getAttribute("data-i"); if (i != null) showTip(Number(i)); });
    svg.addEventListener("click", (e) => { const i = e.target.getAttribute && e.target.getAttribute("data-i"); if (i != null) showTip(Number(i)); });
    svg.addEventListener("mouseleave", hide);
    return box;
  }
  let PER = store.get("per") || "day";
  function periodSection(pts, price) {
    const OPTS = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]];
    const daily = dailySales(pts), today = Math.floor(Date.now() / 864e5);
    const full = daily.filter(([d]) => d < today), sum = (a) => a.reduce((s, x) => s + x[1], 0);
    const last7 = full.slice(-7), prev7 = full.slice(-14, -7);
    let cmp = null;
    if (last7.length === 7 && prev7.length === 7) {
      const a = sum(last7), b = sum(prev7), ch = b > 0 ? (a - b) / b * 100 : null;
      cmp = el("div", { class: "per-cmp" }, `Last 7 days: ${nf(Math.round(a))} units · 7 days before: ${nf(Math.round(b))} units`,
        ch != null ? el("b", { class: ch >= 10 ? "up" : ch <= -10 ? "down" : "" }, ` (${ch >= 0 ? "+" : ""}${Math.round(ch)}%)`) : null);
    }
    return el("div", { class: "per" },
      el("div", { class: "per-head" }, el("h4", {}, "Sales by period"),
        el("div", { class: "seg-mini", role: "tablist" }, OPTS.map(([k, l]) => el("button", { type: "button", role: "tab", "aria-selected": String(PER === k), onclick: () => { PER = k; store.set("per", k); renderDrawer(); } }, l)))),
      pts === undefined || pts === null ? barChart([], "var(--blue)", "Loading…") : barChart(periodBuckets(pts, PER), "var(--blue)", "The daily breakdown appears after measurements on two different days.", price),
      cmp);
  }

  // ---------- customer reviews (saved by the Termékradar Chrome extension) ----------
  let extVersion = null;
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.src === "tr-ext" && e.data.cmd === "pong") {
      const was = extVersion; extVersion = e.data.version || "?";
      if (!was && P.sel) renderDrawer();
    }
  });
  window.postMessage({ src: "tr-app", cmd: "ping" }, location.origin);
  window.addEventListener("focus", () => {
    const id = P.sel;
    if (id && cache.reviews[id] !== undefined && cache.reviews[id] !== null) { delete cache.reviews[id]; renderDrawer(); }
  });
  const REVIEW_TOPICS = [
    ["size", "Size & fit", /\b(size|sizes|sizing|small|smaller|big|bigger|large|tight|loose|fit|fits|fitting|runs?|length|long|short|waist|petite|tall|roll(s|ing)? (down|up)|slid|falls? down|talla|grande|chic[oa])\b|\bx+l\b/i],
    ["quality", "Material & quality", /\b(quality|material|fabric|thin|thick|cheap|rip|ripped|tear|tore|torn|hole|holes|snag|pill|pilling|seam|stitch|broke|broken|damaged|stain|smell|itch|itchy|see.?through|sheer|transparent|squeak|squeaky|warm|cold|soft|lint|fuzz|run in|static)\b/i],
    ["look", "Colour & look", /\b(colou?r|shade|dark|darker|light|lighter|tone|looks? (different|nothing)|picture|pictures|photo|advertis|not as (shown|pictured|described))\b/i],
    ["shipping", "Shipping & package", /\b(ship|shipping|shipped|deliver|delivery|arriv|package|late|missing|wrong (item|size|color)|never (came|received|got)|refund|return|returned)\b/i],
    ["praise", "Praise", /\b(love|loved|great|perfect|comfortable|comfy|recommend|amazing|obsessed|cute|best|worth|happy)\b/i],
  ];
  const reviewTopics = (r) => REVIEW_TOPICS.filter(([, , re]) => re.test(r.text || "")).map(([k]) => k);
  const RV = { star: 0, topic: "", imgs: false, limit: 30 };
  let rvFor = null, rvPoll = null;
  function requestReviews(p) {
    const url = (p.url || `https://shop.tiktok.com/view/product/${p.product_id}?region=US`).split("#")[0] + "#tr-reviews";
    window.postMessage({ src: "tr-app", cmd: "session" }, location.origin);
    window.open(url, "_blank", "noopener");
    clearInterval(rvPoll);
    const id = p.product_id, until = Date.now() + 4 * 60 * 1000;
    rvPoll = setInterval(async () => {
      if (Date.now() > until || P.sel !== id) { clearInterval(rvPoll); return; }
      try {
        const res = await rpc("tr_reviews", { pid: id });
        const prev = cache.reviews[id];
        cache.reviews[id] = res;
        const changed = !prev || (prev.reviews || []).length !== (res.reviews || []).length || (prev.request || {}).status !== (res.request || {}).status;
        if (changed) renderDrawer();
        if (res.request && res.request.status === "done" && res.request.finished_at && Date.now() - new Date(res.request.finished_at).getTime() < 5 * 60 * 1000) clearInterval(rvPoll);
      } catch (_) {}
    }, 5000);
  }
  function installHelp() {
    return el("div", { class: "d-note rv-help" },
      el("b", {}, "This needs the Termékradar Chrome extension (install once):"),
      el("ol", {},
        el("li", {}, el("a", { href: "termekradar-bovitmeny.zip", download: "" }, "Download the extension"), " and unzip it into a folder."),
        el("li", {}, "In Chrome open ", el("code", {}, "chrome://extensions")),
        el("li", {}, "Turn on Developer mode (top right)."),
        el("li", {}, "Click “Load unpacked” and pick the unzipped folder."),
        el("li", {}, "Reload this page.")));
  }
  function reviewsSection(p) {
    const id = p.product_id;
    if (rvFor !== id) { rvFor = id; Object.assign(RV, { star: 0, topic: "", imgs: false, limit: 30 }); }
    ensure("reviews", id, () => rpc("tr_reviews", { pid: id }));
    const data = cache.reviews[id];
    const list = data && Array.isArray(data.reviews) ? data.reviews : [];
    const req = data && data.request;
    const sum = req && req.summary;
    const head = el("h3", {}, "Customer reviews", el("span", {}, req && req.finished_at ? `${nf(list.length)} saved · ${ago(req.finished_at)}` : req && req.status === "running" ? "saving…" : ""));
    const actions = el("div", { class: "d-actions" }, el("button", { type: "button", class: "btn" + (list.length ? "" : " primary"), onclick: () => requestReviews(p) }, list.length ? "Refresh reviews" : "Fetch reviews"));
    if (!extVersion) return el("div", { class: "d-sec" }, head, list.length ? null : el("div", { class: "d-note" }, "TikTok Shop buyer reviews with photos, grouped by size, quality, colour and shipping."), installHelp(), list.length ? reviewsBody(p, list, sum) : null);
    if (!data) return el("div", { class: "d-sec" }, head, el("div", { class: "d-note" }, "Loading…"));
    if (!list.length) return el("div", { class: "d-sec" }, head, actions,
      el("div", { class: "d-note" }, "The product's TikTok Shop page opens in a new tab and the extension saves the reviews: every 1–3 star one, the recent 4–5 star ones and those with photos. About half a minute, then they show up here."));
    return el("div", { class: "d-sec" }, head, actions, reviewsBody(p, list, sum));
  }
  function reviewsBody(p, list, sum) {
    const stars = (n) => "★".repeat(n || 0) + "☆".repeat(Math.max(0, 5 - (n || 0)));
    let dist = null;
    if (sum && sum.rating_result) {
      const tot = Object.values(sum.rating_result).reduce((a, b) => a + Number(b), 0) || 1;
      dist = el("div", { class: "rv-dist" },
        el("div", { class: "rv-score" }, el("b", {}, dec(sum.overall_score)), el("span", {}, `${nf(sum.review_count)} reviews`)),
        el("div", { class: "rv-bars" }, [5, 4, 3, 2, 1].map(s => {
          const n = Number(sum.rating_result[s] || 0);
          return el("button", { type: "button", class: "rv-bar" + (RV.star === s ? " on" : ""), onclick: () => { RV.star = RV.star === s ? 0 : s; RV.limit = 30; renderDrawer(); } },
            el("span", {}, s + "★"), el("i", {}, el("u", { style: `width:${(n / tot * 100).toFixed(1)}%` })), el("em", {}, nf(n) + " · " + Math.round(n / tot * 100) + "%"));
        })));
    }
    const low = list.filter(r => r.rating <= 3);
    const topicCount = (k) => (k === "praise" ? list : low).filter(r => reviewTopics(r).includes(k)).length;
    const chips = el("div", { class: "rv-chips" },
      REVIEW_TOPICS.map(([k, label]) => el("button", { type: "button", class: "rv-chip" + (RV.topic === k ? " on" : ""), "aria-pressed": String(RV.topic === k),
        onclick: () => { RV.topic = RV.topic === k ? "" : k; RV.limit = 30; renderDrawer(); } }, label, el("b", {}, nf(topicCount(k))))),
      el("button", { type: "button", class: "rv-chip" + (RV.imgs ? " on" : ""), "aria-pressed": String(RV.imgs), onclick: () => { RV.imgs = !RV.imgs; RV.limit = 30; renderDrawer(); } },
        "With photos", el("b", {}, nf(list.filter(r => r.images && r.images.length).length))));
    const chipNote = el("div", { class: "d-note" }, "Topic counts come from the 1–3 star reviews (where the complaints are); praise from all of them.");
    const bad = list.filter(r => r.rating <= 2 && r.sku);
    let variants = null;
    if (bad.length >= 5) {
      const cnt = new Map(), all = new Map();
      for (const r of bad) cnt.set(r.sku, (cnt.get(r.sku) || 0) + 1);
      for (const r of list) if (r.sku) all.set(r.sku, (all.get(r.sku) || 0) + 1);
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      variants = el("div", { class: "rv-vars" }, el("div", { class: "rv-vars-h" }, "Variants bought by 1–2 star reviewers"),
        top.map(([sku, n]) => el("div", { class: "rv-var" }, el("span", {}, sku), el("b", {}, `${n} complaints`), el("em", {}, `${Math.round(n / all.get(sku) * 100)}% of its saved reviews`))));
    }
    let shown = list.slice();
    if (RV.star) shown = shown.filter(r => r.rating === RV.star);
    if (RV.topic) shown = shown.filter(r => reviewTopics(r).includes(RV.topic) && (RV.topic === "praise" || RV.star || r.rating <= 3));
    if (RV.imgs) shown = shown.filter(r => r.images && r.images.length);
    const filterNote = (RV.star || RV.topic || RV.imgs) ? el("div", { class: "d-note" }, `${nf(shown.length)} reviews match. `,
      el("button", { type: "button", class: "link", onclick: () => { Object.assign(RV, { star: 0, topic: "", imgs: false, limit: 30 }); renderDrawer(); } }, "Clear")) : null;
    const items = shown.slice(0, RV.limit).map(r => el("div", { class: "rv" },
      el("div", { class: "rv-top" }, el("span", { class: "rv-stars s" + r.rating, "aria-label": r.rating + " stars" }, stars(r.rating)),
        r.review_time ? el("span", {}, new Date(r.review_time).toLocaleDateString("en-US")) : null,
        r.verified ? el("span", { class: "chip" }, "Verified purchase") : null,
        r.sku ? el("span", { class: "chip blue" }, r.sku) : null),
      r.text ? el("p", {}, r.text) : el("p", { class: "d-note" }, "(stars only, no text)"),
      r.images && r.images.length ? el("div", { class: "rv-imgs" }, r.images.map((b, bi) => el("a", { href: "data:image/jpeg;base64," + b, title: "Click to enlarge",
        onclick: (e) => { e.preventDefault(); openLightbox(r.images.map(x => ({ src: "data:image/jpeg;base64," + x })), bi); } },
        el("img", { src: "data:image/jpeg;base64," + b, alt: "Buyer photo", loading: "lazy" })))) : null));
    const more = shown.length > RV.limit ? el("button", { type: "button", class: "btn wide", onclick: () => { RV.limit += 50; renderDrawer(); } }, `Show ${nf(Math.min(50, shown.length - RV.limit))} more reviews`) : null;
    return el("div", { class: "rv-wrap" }, dist, chips, chipNote, variants, filterNote, ...items, more);
  }
