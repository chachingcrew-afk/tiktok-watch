
  // ---------- products ----------
  const SEGMENTS = [["all", "In price band"], ["hot", "Hot now"], ["win", "Winners"], ["rising", "Rising"], ["accel", "Accelerating"], ["multi", "Multi-seller"],
    ["starred", "Starred"], ["new", "New"], ["brand", "Brands"], ["hidden", "Hidden"]];
  const SEG_TIPS = {
    hot: () => `Sales are growing and there is a creator video at most ${setting("hot_video_days")} days old`,
    win: () => `At least $${nf(setting("shop_min_revenue_day"))} revenue a day`,
    rising: () => "Daily sales are at least 5% of all units sold so far",
    accel: () => "Selling at least 1.2× as much as the day before (10+ a day)",
    multi: () => "Other sellers have the same product: likely from a shared factory, so it can be sourced",
    brand: () => "Own products of known brands. Not dropshippable, left out of the other lists.",
    new: () => "Found in the last 30 hours",
  };
  const SORTS = [["revenue_per_day", "Revenue per day"], ["sold_per_day", "Sales per day"], ["spark_chg", "14-day trend %"], ["sold_7d", "Units, last 7 days"],
    ["growth_pct", "Growth %"], ["trend", "Acceleration"], ["sold_per_day_recent", "Current pace"], ["sold_per_day_week", "Weekly daily average"],
    ["sold_now", "Total sold"], ["video_views", "Video views"], ["video_count", "Video count"], ["fresh_videos", "Fresh videos"], ["other_shops", "Seller count"],
    ["price", "Price"], ["rating", "Rating"], ["reviews", "Review count"], ["first_seen", "Newest"], ["title", "Name (A–Z)"]];
  const WTYPE_EN = { tights: "Tights", shape: "Shapewear", work: "Workwear, scrubs", bra: "Bras", sleep: "Sleep & lounge", under: "Underwear", set: "Sets, two-piece",
    jump: "Jumpsuits", party: "Party dresses", dress: "Casual dresses", skirt: "Skirts", shorts: "Shorts", leggings: "Leggings", coat: "Coats & jackets",
    knit: "Sweaters & cardigans", jeans: "Jeans", pants: "Pants", sleeveless: "Sleeveless tops", long: "Long-sleeve tops", short: "T-shirts & short sleeves", top: "Other tops", other: "Other" };
  const saved0 = store.json("pstate", {});
  const P = Object.assign({ niche: "", seg: "all", q: "", cat: "", sort: "revenue_per_day", dir: "desc", page: 0, f: {} }, saved0, { q: "", page: 0 });
  P.sel = null; P.data = null; P.rows = []; P.extra = {};
  const saveP = () => store.put("pstate", { niche: P.niche, seg: P.seg, cat: P.cat, sort: P.sort, dir: P.dir, f: P.f });
  const pNext = latest();
  let pTimer = null;
  const reloadProducts = (delay) => { clearTimeout(pTimer); pTimer = setTimeout(loadProducts, delay || 0); };
  $("sort").replaceChildren(...SORTS.map(([v, l]) => el("option", { value: v }, l)));

  async function loadProducts() {
    const mine = pNext();
    if (!P.data) fill($("plist"), skeleton(8));
    else $("plist").style.opacity = ".55";
    $("refresh").disabled = true;
    try {
      const data = await rpc("tr_shop_page", { p: { niche: P.niche || null, seg: P.seg, q: P.q.trim() || null, cat: P.cat || null, sort: P.sort, dir: P.dir, page: P.page, f: cleanF(P.f) } });
      if (!mine()) return;
      P.data = data || { total: 0, rows: [] };
      P.rows = P.data.rows || [];
      renderProducts();
    } catch (e) {
      if (!mine()) return;
      banner(errText(e), true, { label: "Retry", fn: loadProducts });
      if (!P.data) fill($("plist"), el("div", { class: "empty" }, el("b", {}, "Could not load the products"), errText(e)));
    } finally {
      if (mine()) { $("plist").style.opacity = ""; $("refresh").disabled = false; }
    }
  }
  $("refresh").addEventListener("click", () => { P.data = null; loadProducts(); refreshStatus(); });

  function cleanF(f) {
    const o = {};
    for (const [k, v] of Object.entries(f || {})) {
      if (v === "" || v == null || v === false) continue;
      if (Array.isArray(v) && !v.length) continue;
      o[k] = v;
    }
    return o;
  }
  function renderProducts() {
    const d = P.data;
    const n = nicheBy(P.niche);
    $("products-title").textContent = n ? nicheName(P.niche) : "Products";
    $("products-sub").textContent = P.q.trim()
      ? `Searching every stored product for “${P.q.trim()}”, outside the price band too.`
      : n ? `TikTok Shop products in this niche, $${n.min_price}–${n.max_price} by default, ranked by daily sales and revenue.`
          : "TikTok Shop products by niche, ranked by daily sales and revenue.";
    renderNiches(); renderKpis(); renderSegs(); renderToolbar(); renderActive(); renderTypes(); renderList();
    pager($("pager"), d.total, P.page, (p) => { P.page = p; loadProducts(); toTop($("plist")); }, "products");
    if (!$("fpanel").hidden) { $("fpanel-apply").textContent = `Show ${nf(d.total)} results`; renderCatPills(); }
  }
  function setNiche(k) { P.niche = k || ""; P.cat = ""; P.page = 0; P.f.cats = []; saveP(); loadProducts(); }
  function renderNiches() {
    const agg = (P.data && P.data.niches) || {};
    const total = Object.values(agg).reduce((s, a) => s + (a.n || 0), 0);
    const totalRev = Object.values(agg).reduce((s, a) => s + (Number(a.rev) || 0), 0);
    const pill = (k, label, a) => el("button", { type: "button", class: "niche", role: "tab", "aria-selected": String(P.niche === k), onclick: () => setNiche(k) },
      el("b", {}, label), el("span", {}, `${nf(a ? a.n : 0)} products · ${money(a ? a.rev : 0)}/day`));
    fill($("niches"), pill("", "All niches", { n: total, rev: totalRev }), nicheList().map(n => pill(n.key, nicheName(n.key), agg[n.key])));
  }
  function renderKpis() {
    const k = (P.data && P.data.kpis) || {};
    const lo = P.f.price_min != null && P.f.price_min !== "" ? P.f.price_min : null, hi = P.f.price_max != null && P.f.price_max !== "" ? P.f.price_max : null;
    const n = nicheBy(P.niche);
    const band = lo != null || hi != null ? `$${lo ?? 0}–${hi ?? "∞"}` : n ? `$${n.min_price}–${n.max_price}` : "each niche's band";
    fill($("kpis"),
      el("div", { class: "kpi" }, el("span", {}, "Products in band"), el("b", {}, nf(k.live)), el("small", {}, `${band}, brands left out`)),
      el("button", { type: "button", class: "kpi money", onclick: () => setSeg("win") }, el("span", {}, "Winners"), el("b", {}, nf(k.win)), el("small", {}, `at least $${nf(setting("shop_min_revenue_day"))} a day`)),
      el("button", { type: "button", class: "kpi money", onclick: () => k.best_id && openProduct(k.best_id) }, el("span", {}, "Best daily revenue"), el("b", {}, money(k.best_rev)), el("small", {}, k.best_title || "no measurement yet")),
      el("button", { type: "button", class: "kpi heat", onclick: () => setSeg("hot") }, el("span", {}, "Hot now"), el("b", {}, nf(k.hot)), el("small", {}, `growing + video under ${setting("hot_video_days")} days`)));
  }
  function setSeg(k) { P.seg = k; P.page = 0; saveP(); loadProducts(); }
  function renderSegs() {
    const c = (P.data && P.data.segs) || {};
    fill($("seg"), SEGMENTS.map(([k, label]) => el("button", { type: "button", class: "seg", role: "tab", "aria-selected": String(P.seg === k),
      title: SEG_TIPS[k] ? SEG_TIPS[k]() : null, onclick: () => setSeg(k) }, label, el("em", {}, short(c[k] || 0)))));
  }
  function renderToolbar() {
    $("sort").value = P.sort;
    const asc = P.dir === "asc";
    $("dir").replaceChildren(icon(asc ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"));
    $("dir").setAttribute("aria-label", asc ? "Ascending (click for descending)" : "Descending (click for ascending)");
    const nf_ = activeFilters().length;
    $("filter-count").hidden = !nf_; $("filter-count").textContent = nf_;
    $("filter-open").classList.toggle("active", nf_ > 0);
  }
  const setSort = (k, dir) => { P.sort = k; P.dir = dir; P.page = 0; saveP(); loadProducts(); };
  $("sort").addEventListener("change", () => setSort($("sort").value, $("sort").value === "title" ? "asc" : "desc"));
  $("dir").addEventListener("click", () => setSort(P.sort, P.dir === "asc" ? "desc" : "asc"));
  $("q").addEventListener("input", () => { P.q = $("q").value; P.page = 0; const q = P.q.trim(); if (q.length === 1) return; reloadProducts(300); });

  // ---------- filter definitions ----------
  const range = (min, max, label, unit) => ({ min, max, label, unit });
  const FR = [
    range("sold_min", "sold_max", "Sales per day"), range("week_min", "week_max", "Weekly daily average"), range("rev_min", "rev_max", "Revenue per day", "$"),
    range("total_min", "total_max", "Total sold"), range("price_min", "price_max", "Price", "$"), range("vids_min", "vids_max", "Creator videos")];
  const FMIN = [["growth_min", "Growth % ≥"], ["trend_min", "14-day trend % ≥"], ["rating_min", "Rating ≥"], ["reviews_min", "Reviews ≥"], ["views_min", "Video views ≥"], ["fresh_min", "Fresh videos ≥"]];
  const CHOICES = {
    shops: [["", "Any"], ["one", "Only one seller"], ["multi", "Several sellers"]],
    brand: [["hide", "Hide brands"], ["show", "Show brands"], ["only", "Only brands"]],
    found_days: [["", "Any time"], ["1", "Last day"], ["7", "7 days"], ["14", "14 days"], ["30", "30 days"]],
    seen_days: [["", "Any time"], ["7", "7 days"], ["21", "21 days"]],
  };
  const BOOLS = [["accel", "Accelerating only"], ["rising", "Rising only"]];
  function activeFilters() {
    const f = P.f, out = [];
    for (const r of FR) {
      const a = f[r.min], b = f[r.max], u = r.unit || "";
      if ((a != null && a !== "") || (b != null && b !== "")) out.push([r.label + " " + ((a != null && a !== "") && (b != null && b !== "") ? `${u}${a}–${u}${b}` : (a != null && a !== "") ? `≥ ${u}${a}` : `≤ ${u}${b}`), () => { delete f[r.min]; delete f[r.max]; }]);
    }
    for (const [k, l] of FMIN) if (f[k] != null && f[k] !== "") out.push([`${l} ${f[k]}`, () => { delete f[k]; }]);
    for (const [k, l] of BOOLS) if (f[k]) out.push([l, () => { delete f[k]; }]);
    if (f.shops) out.push([f.shops === "one" ? "One seller" : "Several sellers", () => { delete f.shops; }]);
    if (f.brand && f.brand !== "hide") out.push([f.brand === "only" ? "Only brands" : "Brands shown", () => { delete f.brand; }]);
    if (f.found_days) out.push([`Found in ${f.found_days} d`, () => { delete f.found_days; }]);
    if (f.seen_days) out.push([`Seen in ${f.seen_days} d`, () => { delete f.seen_days; }]);
    if (Array.isArray(f.cats) && f.cats.length) out.push([f.cats.length === 1 ? catLabel(f.cats[0]) : `${f.cats.length} categories`, () => { f.cats = []; }]);
    return out;
  }
  function renderActive() {
    const list = activeFilters();
    if (P.cat && P.cat.startsWith("t:")) list.push(["Type: " + (WTYPE_EN[P.cat.slice(2)] || P.cat.slice(2)), () => { P.cat = ""; }]);
    const box = $("active-filters");
    box.hidden = !list.length;
    if (!list.length) return;
    fill(box, el("span", { class: "lbl" }, "Filters:"),
      list.map(([label, off]) => el("button", { type: "button", class: "fchip", "aria-label": "Remove filter: " + label, onclick: () => { off(); P.page = 0; saveP(); loadProducts(); } }, label, el("i", { "aria-hidden": "true" }, "×"))),
      el("button", { type: "button", class: "link", onclick: () => { P.f = {}; P.cat = ""; P.page = 0; saveP(); loadProducts(); } }, "Clear all"));
  }
  function renderTypes() {
    const box = $("wtypes");
    if (P.niche !== "fashion" || !P.data || !P.data.wtypes) { box.hidden = true; return; }
    box.hidden = false;
    fill(box, P.data.wtypes.filter(w => w.n).map(w => el("button", { type: "button", class: "wt" + (P.cat === "t:" + w.k ? " on" : ""), "aria-pressed": String(P.cat === "t:" + w.k),
      onclick: () => { P.cat = P.cat === "t:" + w.k ? "" : "t:" + w.k; P.page = 0; saveP(); loadProducts(); } }, WTYPE_EN[w.k] || w.k, el("b", {}, money(w.rev)), el("em", {}, nf(w.n)))));
  }

  // ---------- list ----------
  function img(p, size) {
    const box = el("div", { class: "pimg" });
    if (p.image) {
      const i = el("img", { src: sized(p.image, size || 160), alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
      i.addEventListener("error", () => { box.replaceChildren("▢"); queueThumb(p.product_id, box); }, { once: true });
      box.append(i);
    } else { box.append("▢"); queueThumb(p.product_id, box); }
    return box;
  }
  const thumbs = {};
  let thumbQueue = new Map(), thumbTimer = null;
  function queueThumb(id, box) {
    if (!id) return;
    if (thumbs[id]) { box.replaceChildren(el("img", { src: "data:image/webp;base64," + thumbs[id], alt: "" })); return; }
    thumbQueue.set(id, (thumbQueue.get(id) || []).concat(box));
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(async () => {
      const q = thumbQueue; thumbQueue = new Map();
      try {
        const rowsT = await rpc("tr_thumbs", { p_ids: [...q.keys()] });
        for (const r of rowsT || []) { thumbs[r.product_id] = r.thumb; for (const b of q.get(r.product_id) || []) b.replaceChildren(el("img", { src: "data:image/webp;base64," + r.thumb, alt: "" })); }
      } catch (_) {}
    }, 150);
  }
  const isWin = (p) => Number(p.revenue_per_day) >= setting("shop_min_revenue_day");
  const isGrowing = (p) => Number(p.sold_per_day) > 0 && (Number(p.trend) >= 1 || Number(p.sold_per_day_recent) >= Number(p.sold_per_day) || Number(p.growth_pct) >= 2);
  const isHot = (p) => Number(p.fresh_videos) > 0 && isGrowing(p);
  const isNew = (p) => p.first_seen && Date.now() - new Date(p.first_seen).getTime() < 30 * 36e5;
  const growthChip = (p) => {
    if (p.trend == null) return null;
    const t = Number(p.trend);
    if (t > 1.2) return el("span", { class: "chip heat" }, "×" + dec(t) + " faster");
    if (t < 0.8) return el("span", { class: "chip" }, "×" + dec(t) + " slower");
    return null;
  };
  function starBtn(p, onToggle) {
    return el("button", { type: "button", class: "star", "aria-pressed": String(!!p.starred), "aria-label": p.starred ? "Remove star" : "Star",
      onclick: (e) => { e.stopPropagation(); onToggle(p); } }, p.starred ? "★" : "☆");
  }
  function sparkCell(p) {
    const s = Array.isArray(p.spark) ? p.spark : null;
    const vals = s ? s.filter(v => v != null) : [];
    if (vals.length < 3) return el("span", { class: "na" }, "–");
    const w = 104, h = 30, max = Math.max(1, ...vals), n = s.length;
    const recent = p.spark_recent == null ? null : Number(p.spark_recent), before = p.spark_before == null ? null : Number(p.spark_before);
    const dir = recent == null || before == null ? 0 : before === 0 ? (recent > 0 ? 1 : 0) : recent / before >= 1.15 ? 1 : recent / before <= 0.85 ? -1 : 0;
    const color = dir > 0 ? "var(--money)" : dir < 0 ? "var(--bad)" : "var(--faint)";
    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "spark", role: "img" });
    let d = "", pen = false;
    s.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const x = (i / (n - 1)) * (w - 4) + 2, y = h - 3 - (v / max) * (h - 6);
      d += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " "; pen = true;
    });
    svg.append(svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 1.8, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const li = s.length - 1 - [...s].reverse().findIndex(v => v != null);
    svg.append(svgEl("circle", { cx: ((li / (n - 1)) * (w - 4) + 2).toFixed(1), cy: (h - 3 - (s[li] / max) * (h - 6)).toFixed(1), r: 2.4, fill: color }));
    svg.setAttribute("aria-label", "Daily sales over the last 14 days: " + s.map(v => v == null ? "no data" : v).join(", "));
    const ch = before ? Math.round((recent - before) / before * 100) : null;
    return el("div", { class: "spark-box", title: "Daily sales over the last 14 days. Colour: the last 4 days against the 7 before." }, svg,
      el("div", { class: "small " + (dir > 0 ? "pos" : dir < 0 ? "neg" : "") }, ch == null ? "" : (ch >= 0 ? "▲ " : "▼ ") + Math.abs(ch) + "%"));
  }
  const HEAD = [["", null], ["Product", "title"], ["Price", "price", "r"], ["Sales / day", "sold_per_day", "r"], ["14-day trend", "spark_chg"], ["Revenue / day", "revenue_per_day", "r"], ["Growth", "growth_pct", "r"], ["Rating", "rating", "r"]];
  function renderList() {
    const box = $("plist");
    const head = el("div", { class: "phead", role: "row" }, HEAD.map(([l, k, c]) => el("div", { class: c || null, role: "columnheader" },
      k ? el("button", { type: "button", "aria-sort": P.sort === k ? (P.dir === "asc" ? "ascending" : "descending") : null,
        onclick: () => setSort(k, k === P.sort ? (P.dir === "asc" ? "desc" : "asc") : k === "title" ? "asc" : "desc") }, l) : l)));
    if (!P.rows.length) {
      const any = P.data && (P.data.segs || {}).all;
      fill(box, head, el("div", { class: "empty" }, el("b", {}, any || P.q ? "No matching products" : "No products yet"),
        any || P.q ? "Try another segment, fewer filters or a different search." : "They appear after the next product scan.",
        activeFilters().length ? el("button", { type: "button", class: "btn", onclick: () => { P.f = {}; P.page = 0; saveP(); loadProducts(); } }, "Clear filters") : null));
      return;
    }
    fill(box, head, P.rows.map(productRow));
  }
  function productRow(p) {
    const meta = [];
    if (p.brand) meta.push(el("span", { class: "chip" }, p.brand));
    if (Number(p.other_shops) > 0) meta.push(el("span", { class: "chip money", title: (p.twin_shops || []).join(", ") }, `${Number(p.other_shops) + 1} sellers`));
    if (isHot(p)) meta.push(el("span", { class: "chip heat" }, "Hot"));
    if (isWin(p)) meta.push(el("span", { class: "chip money" }, "Winner"));
    if (isNew(p)) meta.push(el("span", { class: "chip blue" }, "New"));
    if (!P.niche && p.niche && nicheBy(p.niche)) meta.push(el("span", { class: "chip blue" }, nicheName(p.niche)));
    meta.push(el("span", {}, [p.niche === "fashion" && p.wtype && p.wtype !== "other" ? WTYPE_EN[p.wtype] : p.category_name, p.shop_name].filter(Boolean).join(" · ")));
    const facts = [p.sold_now != null ? short(p.sold_now) + " sold" : null, Number(p.video_views) > 0 ? short(p.video_views) + " video views" : null].filter(Boolean);
    if (facts.length) meta.push(el("span", {}, facts.join(" · ")));
    if (Number(p.fresh_videos) > 0) meta.push(el("span", { style: "color:var(--heat);font-weight:600" }, `${nf(p.fresh_videos)} fresh videos`));
    const orig = p.price_original && Number(p.price_original) > Number(p.price) ? Number(p.price_original) : null;
    const ms = (v, l, c) => el("div", {}, el("b", { class: c || null }, v), el("span", {}, l));
    return el("div", { class: "prow" + (P.sel === p.product_id ? " sel" : ""), role: "row", tabindex: "0", onclick: () => openProduct(p.product_id),
        onkeydown: (e) => { if (e.key === "Enter") openProduct(p.product_id); } },
      el("div", { class: "c-star" }, starBtn(p, toggleProductStar)),
      el("div", { class: "c-prod" }, el("div", { class: "prod" }, img(p, 160),
        el("div", { style: "min-width:0" }, el("div", { class: "ptitle" }, p.title || "Untitled product"), el("div", { class: "pmeta" }, ...meta)))),
      el("div", { class: "cell r" }, el("div", { class: "big" }, usd(p.price)), orig ? el("div", { class: "small" }, el("s", {}, usd(orig))) : null),
      el("div", { class: "cell r" }, p.sold_per_day != null ? el("div", { class: "big" }, "+" + nf(p.sold_per_day)) : el("span", { class: "na" }, "measuring"),
        p.sold_per_day_recent != null ? el("div", { class: "small" }, "now " + short(p.sold_per_day_recent) + "/day") : null),
      el("div", { class: "cell" }, sparkCell(p)),
      el("div", { class: "cell r" }, p.revenue_per_day != null ? el("div", { class: "big money" }, money(p.revenue_per_day)) : el("span", { class: "na" }, "–"),
        p.revenue_per_day != null ? el("div", { class: "small" }, "≈ " + money(Number(p.revenue_per_day) * 30) + "/mo") : null),
      el("div", { class: "cell r" }, p.growth_pct != null ? el("div", { class: "big" + (Number(p.growth_pct) >= 5 ? " pos" : "") }, "+" + pct(p.growth_pct)) : el("span", { class: "na" }, "–"), growthChip(p)),
      el("div", { class: "cell r" }, p.rating ? [el("div", { class: "big" }, "★ " + dec(p.rating)), el("div", { class: "small" }, short(p.reviews) + " reviews")] : el("span", { class: "na" }, "–")),
      el("div", { class: "c-stats" }, el("div", { class: "mstats" },
        ms(usd(p.price), "price"),
        ms(p.sold_per_day != null ? "+" + nf(p.sold_per_day) : "–", "sold / day"),
        ms(money(p.revenue_per_day), "rev. / day", "pos"),
        ms(p.spark_chg != null ? (Number(p.spark_chg) >= 0 ? "▲ " : "▼ ") + Math.abs(Math.round(p.spark_chg)) + "%" : p.growth_pct != null ? "+" + pct(p.growth_pct) : "–",
          p.spark_chg != null ? "14-day" : "growth", p.spark_chg != null ? (Number(p.spark_chg) >= 0 ? "pos" : "neg") : null))));
  }

  async function toggleProductStar(p) {
    const next = !p.starred; p.starred = next; renderList(); if (P.sel === p.product_id) renderDrawer();
    try { await rpc("tr_set_product", { p_product_id: p.product_id, p_starred: next }); }
    catch (e) { p.starred = !next; banner("Could not save the star. " + errText(e), true); renderList(); }
  }
  async function setProductHidden(p, hide) {
    const prev = { hidden: p.hidden, starred: p.starred };
    p.hidden = hide; if (hide) p.starred = false;
    if (hide) closeDrawer();
    try {
      await rpc("tr_set_product", { p_product_id: p.product_id, p_hidden: hide });
      banner((hide ? "Hidden: " : "Restored: ") + String(p.title || "").slice(0, 60), false, hide ? { label: "Undo", fn: () => setProductHidden(p, false) } : null);
      loadProducts();
    } catch (e) { Object.assign(p, prev); banner("Could not save. " + errText(e), true); renderList(); }
  }

  // ---------- filter panel ----------
  let F = {};
  let catsAll = false;
  function openFilters() {
    F = JSON.parse(JSON.stringify(P.f || {}));
    if (!Array.isArray(F.cats)) F.cats = [];
    catsAll = false;
    renderFilterPanel();
    $("fpanel").hidden = false; $("fscrim").hidden = false;
    $("filter-open").setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    $("fpanel-apply").textContent = `Show ${nf(P.data ? P.data.total : 0)} results`;
    setTimeout(() => { const first = $("fpanel-body").querySelector("input, button"); if (first) first.focus({ preventScroll: true }); }, 30);
  }
  function closeFilters() {
    $("fpanel").hidden = true; $("fscrim").hidden = true;
    $("filter-open").setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    $("filter-open").focus({ preventScroll: true });
  }
  // every change is applied live: the list behind the panel and the count on the button follow
  let fTimer = null;
  function fChanged(delay) {
    clearTimeout(fTimer);
    fTimer = setTimeout(() => { P.f = JSON.parse(JSON.stringify(F)); P.page = 0; saveP(); loadProducts(); }, delay == null ? 350 : delay);
  }
  $("filter-open").addEventListener("click", openFilters);
  $("fpanel-close").addEventListener("click", closeFilters);
  $("fscrim").addEventListener("click", closeFilters);
  $("fpanel-apply").addEventListener("click", () => { clearTimeout(fTimer); P.f = JSON.parse(JSON.stringify(F)); P.page = 0; saveP(); loadProducts(); closeFilters(); });
  $("fpanel-clear").addEventListener("click", () => { F = { cats: [] }; renderFilterPanel(); fChanged(0); });

  const numIn = (key, ph, label, step) => el("input", { type: "number", inputmode: "decimal", min: "0", step: step || "any", placeholder: ph, "aria-label": label, value: F[key] ?? "",
    oninput: (e) => { const v = e.target.value.trim(); if (v === "") delete F[key]; else F[key] = Number(v); fChanged(); } });
  function rangeField(r) {
    const band = r.min === "price_min" && nicheBy(P.niche) ? [nicheBy(P.niche).min_price, nicheBy(P.niche).max_price] : null;
    return el("div", { class: "ffield" }, el("span", { class: "lbl" }, r.label + (r.unit ? ` (${r.unit})` : "")),
      el("div", { class: "range2" }, numIn(r.min, band ? String(band[0]) : "min", r.label + " from"), numIn(r.max, band ? String(band[1]) : "max", r.label + " to")));
  }
  const minField = (k, label, step) => el("div", { class: "ffield" }, el("label", { for: "f-" + k }, label), Object.assign(numIn(k, "any", label, step), { id: "f-" + k }));
  function choice(key, opts) {
    const cur = F[key] == null ? "" : String(F[key]);
    return el("div", { class: "pills", role: "group" }, opts.map(([v, l]) => el("button", { type: "button", class: "pill", "aria-pressed": String(cur === v || (!cur && key === "brand" && v === "hide")),
      onclick: () => { if (v === "" || (key === "brand" && v === "hide")) delete F[key]; else F[key] = v; renderFilterPanel(); fChanged(0); } }, l)));
  }
  const toggle = (key, label) => el("button", { type: "button", class: "pill", "aria-pressed": String(!!F[key]), onclick: () => { if (F[key]) delete F[key]; else F[key] = true; renderFilterPanel(); fChanged(0); } }, label);
  function renderCatPills() {
    const box = document.getElementById("f-cats"); if (!box) return;
    const cats = (P.data && P.data.cats) || [];
    const sel = new Set(F.cats || []);
    const sorted = cats.slice().sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || (b.n - a.n));
    const shown = catsAll ? sorted : sorted.slice(0, 16);
    fill(box, shown.map(c => el("button", { type: "button", class: "pill", "aria-pressed": String(sel.has(c.id)),
      onclick: () => { if (sel.has(c.id)) F.cats = F.cats.filter(x => x !== c.id); else F.cats = [...(F.cats || []), c.id]; renderCatPills(); fChanged(0); } }, `${c.name} · ${short(c.n)}`)),
      !catsAll && sorted.length > 16 ? el("button", { type: "button", class: "pill add", onclick: () => { catsAll = true; renderCatPills(); } }, `+ ${sorted.length - 16} more`) : null);
  }
  function renderFilterPanel() {
    const sec = (title, ...kids) => el("section", { class: "fsec" }, el("h3", {}, title), ...kids);
    const sortSel = el("select", { id: "f-sort", class: "select", onchange: (e) => { P.sort = e.target.value; P.dir = P.sort === "title" ? "asc" : "desc"; P.page = 0; saveP(); renderFilterPanel(); loadProducts(); } },
      SORTS.map(([v, l]) => el("option", { value: v, selected: v === P.sort ? "" : null }, l)));
    const dirPills = el("div", { class: "pills", role: "group", "aria-label": "Sort direction" },
      [["desc", P.sort === "title" ? "Z–A" : "Highest first"], ["asc", P.sort === "title" ? "A–Z" : "Lowest first"]].map(([v, l]) =>
        el("button", { type: "button", class: "pill", "aria-pressed": String(P.dir === v), onclick: () => { P.dir = v; P.page = 0; saveP(); renderFilterPanel(); loadProducts(); } }, l)));
    fill($("fpanel-body"),
      savedSection(),
      sec("Sort by", el("div", { class: "ffield" }, el("label", { class: "sr", for: "f-sort" }, "Sort by"), sortSel), dirPills),
      sec("Sales", el("div", { class: "fgrid" }, rangeField(FR[0]), rangeField(FR[1]), rangeField(FR[2]), rangeField(FR[3]))),
      sec("Growth", el("div", { class: "fgrid" }, minField("growth_min", "Growth % ≥", "0.5"), minField("trend_min", "14-day trend % ≥", "5")),
        el("div", { class: "pills" }, BOOLS.map(([k, l]) => toggle(k, l))),
        el("p", { class: "fhint" }, "Growth: daily sales as a share of all units sold so far. 14-day trend: the last 4 days against the 7 before.")),
      sec("Product", el("div", { class: "fgrid" }, rangeField(FR[4]), minField("rating_min", "Rating ≥", "0.1")), el("div", { class: "fgrid" }, minField("reviews_min", "Reviews ≥", "1")),
        el("div", { class: "ffield" }, el("span", { class: "lbl" }, "Categories"), el("div", { class: "catlist", id: "f-cats" })),
        el("p", { class: "fhint" }, "An empty price field keeps the niche's own price band.")),
      sec("Competition and content",
        el("div", { class: "ffield" }, el("span", { class: "lbl" }, "Sellers"), choice("shops", CHOICES.shops)),
        el("div", { class: "ffield" }, el("span", { class: "lbl" }, "Brands"), choice("brand", CHOICES.brand)),
        el("div", { class: "fgrid" }, rangeField(FR[5]), minField("views_min", "Video views ≥", "1000")), el("div", { class: "fgrid" }, minField("fresh_min", "Fresh videos ≥", "1"))),
      sec("Time",
        el("div", { class: "ffield" }, el("span", { class: "lbl" }, "Found"), choice("found_days", CHOICES.found_days)),
        el("div", { class: "ffield" }, el("span", { class: "lbl" }, "Last seen in a category"), choice("seen_days", CHOICES.seen_days))));
    renderCatPills();
  }

  // saved filters: kept in the database, so the phone and the computer share them
  let savingName = false;
  const savedList = () => Array.isArray(S.settings.ui_saved_filters) ? S.settings.ui_saved_filters : [];
  async function storeSaved(list) {
    S.settings.ui_saved_filters = list;
    try { await rpc("tr_save_ui", { p_key: "ui_saved_filters", p_value: list }); }
    catch (e) { banner("Could not save the filter set. " + errText(e), true); }
  }
  function savedSection() {
    const list = savedList();
    const apply = (s) => {
      const st = s.state || {};
      Object.assign(P, { niche: st.niche || "", seg: st.seg || "all", cat: st.cat || "", sort: st.sort || "revenue_per_day", dir: st.dir || "desc", f: st.f || {}, page: 0 });
      F = JSON.parse(JSON.stringify(P.f)); if (!Array.isArray(F.cats)) F.cats = [];
      saveP(); renderFilterPanel(); loadProducts();
    };
    const pills = list.map((s, i) => el("button", { type: "button", class: "pill", onclick: () => apply(s), title: "Apply this filter set" }, s.name,
      el("i", { role: "button", "aria-label": "Delete " + s.name, title: "Delete", onclick: (e) => { e.stopPropagation(); storeSaved(list.filter((_, j) => j !== i)).then(renderFilterPanel); } }, "×")));
    let row = null;
    if (savingName) {
      const inp = el("input", { type: "text", placeholder: "Name, e.g. Brand candidates", "aria-label": "Name of the filter set", maxlength: "40" });
      const ok = async () => {
        const name = inp.value.trim(); if (!name) { inp.focus(); return; }
        const st = { niche: P.niche, seg: P.seg, cat: P.cat, sort: P.sort, dir: P.dir, f: cleanF(F) };
        savingName = false;
        await storeSaved([...list.filter(s => s.name !== name), { name, state: st }]);
        renderFilterPanel();
      };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } if (e.key === "Escape") { savingName = false; renderFilterPanel(); } });
      row = el("div", { class: "tagadd" }, inp, el("button", { type: "button", class: "btn primary", onclick: ok }, "Save"), el("button", { type: "button", class: "btn", onclick: () => { savingName = false; renderFilterPanel(); } }, "Cancel"));
      setTimeout(() => inp.focus(), 20);
    }
    return el("section", { class: "fsec" }, el("h3", {}, "Saved filters"),
      el("div", { class: "saved" }, pills, savingName ? null : el("button", { type: "button", class: "pill add", onclick: () => { savingName = true; renderFilterPanel(); } }, "+ Save current")),
      row, !list.length && !savingName ? el("p", { class: "fhint" }, "Save a combination you use often (niche, segment, sort and filters) and load it with one tap.") : null);
  }
