
  // ---------- videos ----------
  const VSEG = [["tracking", "Tracking"], ["accel", "Accelerating"], ["starred", "Starred"], ["out", "Dropped"], ["hidden", "Hidden"]];
  const V = { seg: store.get("vseg") || "tracking", sort: store.get("vsort") || "recent_views_per_hour", q: "", page: 0, data: null };
  const vNext = latest();
  let vTimer = null;
  $("vsort").value = V.sort;
  async function loadVideos() {
    const mine = vNext();
    if (!V.data) fill($("vlist"), skeleton(6)); else $("vlist").style.opacity = ".55";
    try {
      const d = await rpc("tr_videos_page", { p: { seg: V.seg, sort: V.sort, q: V.q.trim(), page: V.page } });
      if (!mine()) return;
      V.data = d || { total: 0, rows: [], segs: {} };
      renderVideos();
    } catch (e) { if (mine()) { banner(errText(e), true, { label: "Retry", fn: loadVideos }); if (!V.data) fill($("vlist"), el("div", { class: "empty" }, el("b", {}, "Could not load the videos"), errText(e))); } }
    finally { if (mine()) $("vlist").style.opacity = ""; }
  }
  function renderVideos() {
    const d = V.data, c = d.segs || {};
    fill($("vseg"), VSEG.map(([k, l]) => el("button", { type: "button", class: "seg", role: "tab", "aria-selected": String(V.seg === k),
      onclick: () => { V.seg = k; V.page = 0; store.set("vseg", k); loadVideos(); } }, l, el("em", {}, short(c[k] || 0)))));
    const head = el("div", { class: "vhead" }, el("div", {}), el("div", {}, "Video and product"), el("div", { class: "r" }, "Views / hour"), el("div", { class: "r" }, "Accel."),
      el("div", { class: "r" }, "Views"), el("div", { class: "r" }, "Price"), el("div", { class: "r" }, "Product sold"), el("div", { class: "r" }, "Age"));
    const rows = d.rows || [];
    if (!rows.length) { fill($("vlist"), head, el("div", { class: "empty" }, el("b", {}, "No videos here"), "New videos appear after the morning collection.")); }
    else fill($("vlist"), head, rows.map(videoRow));
    pager($("vpager"), d.total, V.page, (p) => { V.page = p; loadVideos(); toTop($("vlist")); }, "videos");
  }
  function videoRow(v) {
    const a = Number(v.acceleration);
    const badge = v.status === "expired" ? el("span", { class: "chip" }, "expired") : v.status === "dropped" ? el("span", { class: "chip" }, "dropped")
      : v.acceleration == null ? el("span", { class: "chip blue" }, "new") : a > 1.2 ? el("span", { class: "chip heat" }, "×" + dec(a) + " faster") : a < .8 ? el("span", { class: "chip" }, "slowing") : el("span", { class: "chip" }, "steady");
    const vph = v.recent_views_per_hour ?? v.avg_views_per_hour;
    const ms = (val, l, c) => el("div", {}, el("b", { class: c || null }, val), el("span", {}, l));
    return el("div", { class: "vrow", role: "row", tabindex: "0", onclick: () => window.open(v.url, "_blank", "noopener"), onkeydown: (e) => { if (e.key === "Enter") window.open(v.url, "_blank", "noopener"); } },
      el("div", { class: "c-star" }, starBtn(v, toggleVideoStar)),
      el("div", { class: "c-prod" }, el("div", { class: "prod" }, img({ product_id: v.product_id, image: v.product_image }, 160),
        el("div", { style: "min-width:0" }, el("div", { class: "ptitle" }, v.product_title || (v.description || "").replace(/#\w+/g, "").trim() || "Video"),
          el("div", { class: "pmeta" }, badge, el("span", {}, "@" + (v.author || "?")),
            v.product_id ? el("button", { type: "button", class: "link", onclick: (e) => { e.stopPropagation(); openProduct(v.product_id); } }, "Product") : null,
            el("button", { type: "button", class: "link", style: "color:var(--muted)", onclick: (e) => { e.stopPropagation(); setVideoHidden(v, !v.hidden); } }, v.hidden ? "Restore" : "Hide"))))),
      el("div", { class: "cell r" }, el("div", { class: "big" }, short(vph) + "/h")),
      el("div", { class: "cell r" }, v.acceleration != null ? "×" + dec(v.acceleration) : "–"),
      el("div", { class: "cell r" }, short(v.views)),
      el("div", { class: "cell r" }, v.product_price != null ? usd(v.product_price) : "–"),
      el("div", { class: "cell r" }, v.product_sold != null ? [el("div", { class: "big" }, short(v.product_sold)), v.product_sold_per_day != null ? el("div", { class: "small pos" }, "+" + short(v.product_sold_per_day) + "/day") : null] : "–"),
      el("div", { class: "cell r small" }, ageText(v.age_hours)),
      el("div", { class: "c-stats" }, el("div", { class: "mstats" }, ms(short(vph) + "/h", "views now"), ms(short(v.views), "views"),
        ms(v.product_price != null ? usd(v.product_price) : "–", "price"), ms(v.product_sold_per_day != null ? "+" + short(v.product_sold_per_day) : "–", "sold / day", "pos"))));
  }
  $("vq").addEventListener("input", () => { V.q = $("vq").value; V.page = 0; clearTimeout(vTimer); vTimer = setTimeout(loadVideos, 300); });
  $("vsort").addEventListener("change", () => { V.sort = $("vsort").value; V.page = 0; store.set("vsort", V.sort); loadVideos(); });
  async function toggleVideoStar(v) {
    const next = !v.starred; v.starred = next; renderVideos();
    try { const st = await rpc("tr_set_video", { p_video_id: v.video_id, p_starred: next }); if (st) v.status = st; }
    catch (e) { v.starred = !next; banner("Could not save. " + errText(e), true); }
    renderVideos();
  }
  async function setVideoHidden(v, hide) {
    try { await rpc("tr_set_video", { p_video_id: v.video_id, p_hidden: hide }); loadVideos(); }
    catch (e) { banner("Could not save. " + errText(e), true); }
  }

  // ---------- Facebook ads ----------
  const FB = { niche: store.get("fbniche") || "", tab: "ads", minDays: Number(store.get("fbdays") ?? 30), active: true, shop: store.get("fbshop") !== "0", q: "", sort: "score",
               page: 0, data: null, pages: null, pg: null, pgData: null, pgPage: 0, summary: null, msg: "" };
  const fbNext = latest();
  let fbTimer = null;
  async function loadFb() {
    if (!FB.summary || !FB.pages) {
      try { const [s, pg] = await Promise.all([rpc("tr_fb_summary"), rpc("tr_fb_pages")]); FB.summary = s || {}; FB.pages = pg || []; } catch (e) { FB.msg = errText(e); }
    }
    renderFb();
    if (FB.tab === "ads") loadFbAds();
  }
  async function loadFbAds() {
    const mine = fbNext();
    const grid = $("fb-grid"); if (grid) grid.style.opacity = ".55";
    try {
      const d = await rpc("tr_fb_ads_page", { p: { niche: FB.niche || null, q: FB.q.trim(), min_days: FB.minDays, active: FB.active, shop: FB.shop, sort: FB.sort, page: FB.page } });
      if (!mine()) return;
      FB.data = d || { total: 0, rows: [] }; FB.msg = "";
    } catch (e) { if (!mine()) return; FB.msg = errText(e); }
    renderFbGrid();
  }
  async function fbOpenPage(pid, name) {
    FB.tab = "pages"; FB.pg = { page_id: pid, name }; FB.pgData = null; FB.pgPage = 0; renderFb(); loadFbPage();
  }
  async function loadFbPage() {
    try { FB.pgData = await rpc("tr_fb_ads_page", { p: { page_id: FB.pg.page_id, sort: "new", page: FB.pgPage } }); } catch (e) { FB.pgData = { total: 0, rows: [] }; FB.msg = errText(e); }
    renderFb();
  }
  async function fbWatch(pid, on, name) {
    try { await rpc("tr_fb_watch", { p_page_id: pid, p_on: on, p_name: name || null }); FB.pages = await rpc("tr_fb_pages") || []; FB.msg = on ? `Watching ${name || pid}. The next run fetches all of its ads.` : "Stopped watching."; }
    catch (e) { FB.msg = errText(e); }
    if (FB.data) for (const a of FB.data.rows || []) if (a.page_id === pid) a.watched = on;
    renderFb(); if (FB.tab === "ads") renderFbGrid();
  }
  function fbCard(a) {
    const days = fbDays(a);
    const vid = media(a.video_key) || a.video_url, poster = media(a.poster_key) || a.video_preview, im = media(a.image_key) || a.image_url;
    const fallback = () => el("div", { class: "fb-media fb-noimg" }, el("span", {}, "The image has expired"), el("a", { href: fbLib(a.id), target: "_blank", rel: "noopener noreferrer" }, "See it in the Ad Library ↗"));
    const shot = !CFG.supabaseUrl
      ? el("a", { class: "fb-media fb-noimg", href: fbLib(a.id), target: "_blank", rel: "noopener noreferrer" }, el("span", {}, vid ? "▶ Video ad" : "Image ad"), el("small", {}, "The chat copy does not load ad media. Open the website or the Ad Library ↗"))
      : vid ? el("video", { src: vid, poster: poster || null, controls: "", preload: "none", playsinline: "", class: "fb-media" })
      : im ? el("img", { src: im, alt: a.title || "Ad image", loading: "lazy", referrerpolicy: "no-referrer", class: "fb-media", onerror: (e) => e.target.replaceWith(fallback()) })
      : fallback();
    const watched = a.watched || (FB.pages || []).some(p => p.page_id === a.page_id);
    return el("article", { class: "fb-card" },
      el("div", { class: "fb-shot" }, shot,
        el("div", { class: "fb-over" },
          days != null ? el("span", { class: "fb-pill " + (days >= 90 ? "hot" : days >= 30 ? "warm" : "") }, `running ${nf(days)} days`) : null,
          Number(a.collation_count) > 1 ? el("span", { class: "fb-pill", title: "Runs in this many versions: the advertiser is scaling" }, `${nf(a.collation_count)} versions`) : null,
          a.is_active === false ? el("span", { class: "fb-pill off" }, "stopped") : null)),
      el("div", { class: "fb-body" },
        el("div", { class: "fb-who" }, el("button", { type: "button", class: "fb-pagename", onclick: () => fbOpenPage(a.page_id, a.page_name), title: "All ads of this page" }, a.page_name || a.page_id),
          a.page_likes ? el("span", { class: "muted" }, `${short(a.page_likes)} followers`) : null),
        a.title ? el("div", { class: "fb-title" }, a.title) : null,
        a.body ? el("p", { class: "fb-text" }, a.body) : null,
        el("div", { class: "fb-foot" },
          a.link_url ? el("a", { class: "fb-shop", href: a.link_url, target: "_blank", rel: "noopener noreferrer" }, a.domain || "website") : el("span", { class: "muted" }, "no website"),
          el("a", { href: fbLib(a.id), target: "_blank", rel: "noopener noreferrer", title: "Open in the Meta Ad Library" }, "Ad Library ↗"),
          a.page_id ? el("button", { type: "button", class: "fb-watch" + (watched ? " on" : ""), "aria-pressed": String(watched), onclick: () => fbWatch(a.page_id, !watched, a.page_name) }, watched ? "★ Watching" : "☆ Watch") : null)));
  }
  function renderFb() {
    const root = $("fb-root"); if (!root) return;
    const sum = FB.summary || {};
    const total = Object.values(sum).reduce((t, x) => t + (x.n || 0), 0);
    const tabs = el("div", { class: "fb-head" },
      el("div", { class: "seg-mini", role: "tablist" },
        el("button", { type: "button", role: "tab", "aria-selected": String(FB.tab === "ads"), onclick: () => { FB.tab = "ads"; renderFb(); loadFbAds(); } }, "Winning ads"),
        el("button", { type: "button", role: "tab", "aria-selected": String(FB.tab === "pages"), onclick: () => { FB.tab = "pages"; FB.pg = null; renderFb(); } }, `Watched pages · ${(FB.pages || []).length}`)),
      el("span", { class: "muted" }, `${nf(total)} ads from the last 30 days`));
    const msg = FB.msg ? el("div", { class: "fb-msg", role: "status" }, FB.msg) : null;
    if (FB.tab === "pages") { fill(root, tabs, msg, el("div", { class: "card list-card" }, fbPagesView())); return; }
    const pills = el("div", { class: "niches", role: "tablist", "aria-label": "Niches" },
      el("button", { type: "button", class: "niche", role: "tab", "aria-selected": String(!FB.niche), onclick: () => { FB.niche = ""; FB.page = 0; store.set("fbniche", ""); renderFb(); loadFbAds(); } }, el("b", {}, "All niches"), el("span", {}, `${nf(total)} ads`)),
      nicheList().map(n => el("button", { type: "button", class: "niche", role: "tab", "aria-selected": String(FB.niche === n.key),
        onclick: () => { FB.niche = n.key; FB.page = 0; store.set("fbniche", n.key); renderFb(); loadFbAds(); } }, el("b", {}, nicheName(n.key)), el("span", {}, `${nf((sum[n.key] || {}).n || 0)} ads`))));
    const sel = (label, value, opts, on) => el("label", { class: "fb-field" }, el("span", {}, label),
      el("select", { onchange: (e) => on(e.target.value) }, opts.map(([v, l]) => el("option", { value: v, selected: String(value) === String(v) ? "" : null }, l))));
    const tg = (label, on, set, title) => el("button", { type: "button", class: "pill", "aria-pressed": String(on), title, onclick: () => { set(!on); FB.page = 0; renderFb(); loadFbAds(); } }, label);
    const search = el("label", { class: "search", style: "max-width:none;flex:1 1 220px" }, icon("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4"),
      el("input", { type: "search", placeholder: "Search text, page or domain", value: FB.q, "aria-label": "Search ads",
        oninput: (e) => { FB.q = e.target.value; FB.page = 0; clearTimeout(fbTimer); fbTimer = setTimeout(loadFbAds, 300); } }));
    const bar = el("div", { class: "fb-bar" }, search,
      sel("Running at least", FB.minDays, [[0, "any time"], [7, "7 days"], [30, "30 days"], [60, "60 days"], [90, "90 days"]], (v) => { FB.minDays = Number(v); FB.page = 0; store.set("fbdays", FB.minDays); loadFbAds(); }),
      sel("Sort by", FB.sort, [["score", "Winning score"], ["days", "Running longest"], ["variants", "Most versions"], ["new", "Newest"], ["likes", "Biggest page"]], (v) => { FB.sort = v; FB.page = 0; loadFbAds(); }),
      el("div", { class: "fb-toggles" },
        tg("Webshops only", FB.shop, (v) => { FB.shop = v; store.set("fbshop", v ? "1" : "0"); }, "Only ads that lead to a webshop (not a Facebook page, Amazon or an app store)"),
        tg("Still running", FB.active, (v) => { FB.active = v; })));
    fill(root, tabs, msg, pills, el("div", { class: "card list-card" }, bar, el("div", { id: "fb-count", class: "fb-count" }), el("div", { id: "fb-grid", class: "fb-grid" }, skeleton(3)), el("nav", { class: "pager", id: "fb-pager", "aria-label": "Pages" })));
    if (FB.data) renderFbGrid();
  }
  function renderFbGrid() {
    const grid = $("fb-grid"); if (!grid) return;
    grid.style.opacity = "";
    const d = FB.data || { total: 0, rows: [] };
    $("fb-count").textContent = d.total ? `${nf(d.total)} ads match. Winning score: the longer an ad runs and the more versions it has, the more likely it makes money.` : "";
    if (!d.rows.length) fill(grid, el("div", { class: "empty", style: "grid-column:1/-1" }, el("b", {}, "No ads match"), "Loosen the filters, e.g. the running time or Webshops only."));
    else fill(grid, d.rows.map(fbCard));
    pager($("fb-pager"), d.total, FB.page, (p) => { FB.page = p; loadFbAds(); toTop(grid); }, "ads");
  }
  function fbPagesView() {
    if (FB.pg) {
      const d = FB.pgData;
      const box = el("div", {},
        el("div", { class: "fb-pagehead" }, el("button", { type: "button", class: "btn", onclick: () => { FB.pg = null; renderFb(); } }, "← Pages"),
          el("h3", {}, FB.pg.name || FB.pg.page_id),
          el("a", { class: "btn", href: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${FB.pg.page_id}`, target: "_blank", rel: "noopener noreferrer" }, "Ad Library ↗"),
          (FB.pages || []).some(p => p.page_id === FB.pg.page_id) ? null : el("button", { type: "button", class: "btn primary", onclick: () => fbWatch(FB.pg.page_id, true, FB.pg.name) }, "Watch page")),
        d === null ? el("div", { class: "fb-grid" }, skeleton(3)) : el("div", { class: "fb-grid" }, d.rows.map(fbCard)));
      if (d) { const pg = el("nav", { class: "pager", "aria-label": "Pages" }); pager(pg, d.total, FB.pgPage, (p) => { FB.pgPage = p; FB.pgData = null; renderFb(); loadFbPage(); }, "ads"); box.append(pg); }
      return box;
    }
    const input = el("input", { type: "text", placeholder: "Facebook page ID, or an Ad Library link (view_all_page_id=…)", "aria-label": "Facebook page to watch" });
    const add = () => {
      const v = input.value.trim(), m = v.match(/view_all_page_id=(\d+)/) || v.match(/^(\d{5,25})$/);
      if (!m) { FB.msg = "Paste the page ID (digits only) or the page's Ad Library link with view_all_page_id= in it. The Watch button on an ad card works too."; renderFb(); return; }
      fbWatch(m[1], true);
    };
    const pages = FB.pages || [];
    return el("div", {},
      el("div", { class: "fb-add" }, input, el("button", { type: "button", class: "btn primary", onclick: add }, "Watch")),
      pages.length ? pages.map(p => el("div", { class: "fb-pagerow" },
        el("button", { type: "button", class: "link", style: "text-align:left", onclick: () => fbOpenPage(p.page_id, p.name) }, p.name || p.page_id),
        el("span", {}, `${nf(p.active || 0)} active ads`),
        el("span", { class: Number(p.new_7d) ? "pos" : "muted" }, `${nf(p.new_7d || 0)} new in 7 days`),
        el("span", { class: "muted" }, p.checked_at ? "updated " + ago(p.checked_at) : "not fetched yet"),
        el("button", { type: "button", class: "btn sm", onclick: () => fbWatch(p.page_id, false) }, "Stop")))
        : el("div", { class: "empty" }, el("b", {}, "No watched pages yet."), "Use Watch on an ad card, or add a page ID above."));
  }

  // ---------- runs ----------
  const JOB = { shop: "Product scan", shop_track: "Sales check", videos: "Product videos", collect: "Video collection", track: "Video tracking",
    fbads: "Facebook ads", comments_products: "Video comments", comments: "Kit comments", migrate_gallery_r2: "Gallery to R2", parcels: "Parcels" };
  const R = { page: 0, job: "", data: null, open: null };
  async function loadRuns() {
    if (!R.data) fill($("runs"), skeleton(6));
    try { R.data = await rpc("tr_runs_page", { p: { page: R.page, job: R.job || null } }); renderRuns(); }
    catch (e) { banner(errText(e), true, { label: "Retry", fn: loadRuns }); }
  }
  function renderRuns() {
    const d = R.data || { rows: [], total: 0, jobs: [] };
    fill($("runs-jobs"), el("button", { type: "button", class: "seg", "aria-pressed": String(!R.job), onclick: () => { R.job = ""; R.page = 0; loadRuns(); } }, "All jobs"),
      (d.jobs || []).map(j => el("button", { type: "button", class: "seg", "aria-pressed": String(R.job === j), onclick: () => { R.job = j; R.page = 0; loadRuns(); } }, JOB[j] || j)));
    const head = el("div", { class: "rhead" }, ["Job", "Started", "Took", "Status", "Result", "Proxy", "Errors"].map((h, i) => el("div", { class: i >= 5 ? "r" : null }, h)));
    const out = [head];
    for (const r of d.rows || []) {
      const s = r.stats || {};
      const mins = r.finished_at ? Math.max(1, Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 60000)) + " min" : "running";
      const st = !r.finished_at ? el("span", { class: "chip gold" }, "running") : r.ok ? el("span", { class: "chip money" }, "ok") : el("span", { class: "chip bad" }, "failed");
      let result;
      if (r.job === "shop") result = `${nf(s.seen)} seen, ${nf(s.in_range)} in band, ${nf(s.product_pages)} product pages`;
      else if (r.job === "shop_track") result = `${nf(s.product_pages)} of ${nf(s.selected)} products measured`;
      else if (r.job === "videos") result = `${nf(s.video_products)} products, ${nf(s.videos)} videos`;
      else if (r.job === "collect") result = `${nf(s.seen)} videos seen, ${nf(s.ok)} new`;
      else if (r.job === "fbads") result = `${nf((s.niche_searches || 0) + (s.product_searches || 0) + (s.page_searches || 0))} searches, ${nf(s.ads_seen || 0)} ads` + (s.blocked ? ", Facebook asked to sign in" : "");
      else if (r.job === "comments_products" || r.job === "comments") result = `${nf(s.kits || 0)} products' comments`;
      else result = `${nf(s.tracking)} tracking, ${nf(s.dropped || 0)} dropped`;
      const errs = (s.feed_errors || 0) + (s.failed || 0) + (s.category_errors || 0) + (s.product_page_errors || 0) + (s.video_errors || 0);
      const feeds = r.job === "shop" ? s.categories : s.feeds;
      const canOpen = (feeds && Object.keys(feeds).length) || r.error;
      const open = R.open === r.id;
      out.push(el("div", { class: "rrow" + (canOpen ? " click" : ""), onclick: canOpen ? () => { R.open = open ? null : r.id; renderRuns(); } : null },
        el("div", {}, el("b", {}, (canOpen ? (open ? "▾ " : "▸ ") : "") + (JOB[r.job] || r.job))), el("div", {}, when(r.started_at)), el("div", {}, mins), el("div", {}, st), el("div", {}, result),
        el("div", { class: "r" }, s.proxy_mb != null ? dec(s.proxy_mb) + " MB" : "–"), el("div", { class: "r" }, nf(errs))));
      if (open) {
        out.push(el("div", { class: "rdetail" }, r.error ? el("div", { style: "color:var(--bad);margin-bottom:8px" }, r.error) : null,
          feeds ? el("div", { class: "feedgrid" }, Object.entries(feeds).sort((a, b) => (b[1].in_range ?? b[1].new ?? 0) - (a[1].in_range ?? a[1].new ?? 0)).map(([name, f]) =>
            el("div", { class: f.error ? "err" : "", title: f.error || null }, el("span", {}, r.job === "shop" ? catLabel(name) : name),
              el("span", {}, f.error && !f.loads ? "error" : r.job === "shop" ? `${f.in_range || 0} / ${f.products || 0}` : `${f.new || 0} new / ${f.seen || 0}`)))) : null));
      }
    }
    if (!(d.rows || []).length) out.push(el("div", { class: "empty" }, "No runs yet."));
    fill($("runs"), out);
    pager($("runs-pager"), d.total, R.page, (p) => { R.page = p; loadRuns(); toTop($("runs")); }, "runs");
  }

  // ---------- settings ----------
  let dirty = false, tags = [], brands = [];
  const DEFAULT_BRANDS = ["VEVOR","Merach","Anker","Soundcore","eufy","Ninja","Shark","SharkNinja","Dyson","Bissell","Hoover","iRobot","Roborock","Tineco","Keurig","Cuisinart","KitchenAid","Hamilton Beach","Instant Pot","Instant","COSORI","Chefman","BLACK+DECKER","DEWALT","Milwaukee","Makita","Ryobi","Bosch","Philips","Braun","Oral-B","Waterpik","Conair","Revlon","Remington","Wahl","Andis","BaBylissPRO","Laifen","Panasonic","Samsung","Apple","JBL","Sony","Bose","Beats","Logitech","Garmin","Fitbit","Coleman","YETI","Stanley","Hydro Flask","Owala","Lodge","OXO","Rubbermaid","Sunbeam","Igloo","Theragun","Therabody","Hyperice","RENPHO","Bowflex","Gorilla Grip","Amazon Basics","LEGO","Hasbro","Mattel","Nerf","Fisher-Price","Crayola","Furbo","PetSafe","Cricut","BlendJet","Medicube","Govee","TP-Link","Ring","Blink","Wyze","Ecovacs","Dreame","Xiaomi","Ugreen","Baseus","Belkin","OtterBox","Spigen","Casetify","Shokz","Soundpeats","Sterilite","Mueller","Gourmia","Bella","Dash","Bear","AquaSonic","Snow","Crest","Sol de Janeiro","CeraVe","Olaplex","T3","GHD"];
  const NUM = [
    ["shop_min_revenue_day", "“Winner” from this daily revenue ($)", 0, 1e7, ""],
    ["hot_video_days", "“Hot now”: video at most this many days old", 7, 365, "A product needs a fresher video than this to count as hot."],
    ["shop_track_min_sold", "Videos and gallery from this many sales", 0, 1e9, "Below this the product's videos and images are not downloaded."],
    ["videos_per_hashtag", "Videos per hashtag", 10, 1000, "TikTok stops after about 150–190 videos."], ["trending_count", "Trending videos", 0, 1000, ""],
    ["max_age_days", "Videos at most this many days old", 1, 30, ""], ["min_views", "At least this many views", 0, 1e9, ""],
    ["min_avg_views_per_hour", "At least this many views per hour", 0, 1e8, ""], ["min_product_price", "Minimum product price for videos ($)", 0, 10000, "0 turns it off."],
    ["drop_below_views_per_hour", "Drop below this many views per hour", 0, 1e8, ""], ["min_snapshots_before_drop", "After at least this many measurements", 2, 20, ""],
  ];
  const BOOL = [["include_trending", "Trending feed too", "Besides the hashtags it also scans the trending feed."],
    ["require_shop_product", "Only videos with a TikTok Shop product", "Only videos with a linked TikTok Shop product are added."],
    ["require_product_signal", "Only videos that mention a product", "Also filters on product words in the caption."]];
  const numField = (k) => { const d = NUM.find(x => x[0] === k); const v = S.settings[k] ?? DEFAULTS[k] ?? "";
    return el("div", { class: "field" }, el("label", { for: "s-" + k }, d[1]), el("input", { type: "number", id: "s-" + k, min: d[2], max: d[3], value: v }), d[4] ? el("small", {}, d[4]) : null); };
  const boolField = (k) => { const d = BOOL.find(x => x[0] === k);
    return el("label", { class: "toggle" }, el("input", { type: "checkbox", id: "s-" + k, checked: !!S.settings[k] || null }), el("span", { class: "lbl" }, d[1]), el("small", {}, d[2])); };
  function tagEditor(id, list, label, help, placeholder, parse, display) {
    const box = el("div", { class: "tags", id: id + "-tags" });
    const draw = () => fill(box, list.map((t, i) => el("span", { class: "tag" }, display(t), el("button", { type: "button", "aria-label": "Remove " + display(t), onclick: () => { list.splice(i, 1); draw(); markDirty(); } }, "×"))));
    draw();
    const input = el("input", { type: "text", id: id + "-input", placeholder, autocomplete: "off" });
    const add = () => { let added = false; for (const part of input.value.split(/[,\n]+/).map(x => x.trim()).filter(Boolean)) { const v = parse(part); if (v && !list.includes(v)) { list.push(v); added = true; } } input.value = ""; draw(); if (added) markDirty(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    return el("div", { class: "field" }, el("span", { class: "lbl" }, label), box, el("div", { class: "tagadd" }, input, el("button", { type: "button", class: "btn", onclick: add }, "Add")), el("small", {}, help));
  }
  function markDirty() { dirty = true; const b = document.querySelector(".savebar"); if (b) { b.classList.add("dirty"); b.querySelector("span").textContent = "You have unsaved changes."; } }
  function renderSettings() {
    if (dirty) return;
    const s = S.settings;
    tags = Array.isArray(s.hashtags) ? s.hashtags.slice() : [];
    brands = Array.isArray(s.known_brands) && s.known_brands.length ? s.known_brands.slice() : DEFAULT_BRANDS.slice();
    fill($("settings-form"),
      el("div", { class: "scard wide" }, el("h2", {}, "Niches"),
        el("p", {}, "Every scan goes through these niches' TikTok Shop categories in each niche's own price band. Sales are measured twice a day."),
        el("div", { class: "niche-set" }, nicheList().map(n => el("div", { class: "niche-row" },
          el("div", { class: "niche-name" }, el("b", {}, nicheName(n.key))),
          el("label", {}, "Min $", el("input", { type: "number", id: `n-${n.key}-min`, min: 0, max: 10000, value: n.min_price })),
          el("label", {}, "Max $", el("input", { type: "number", id: `n-${n.key}-max`, min: 1, max: 10000, value: n.max_price })),
          el("label", { title: "Pages to load per category (one page is about 20 products)" }, "Pages", el("input", { type: "number", id: `n-${n.key}-loads`, min: 0, max: 60, value: n.loads })),
          el("div", { class: "niche-cats" }, [...(n.cats || []), ...(n.deep || [])].map(c => el("span", { class: "tag" }, catLabel(c))))))),
        el("div", { class: "srow" }, numField("shop_min_revenue_day"), numField("shop_track_min_sold"), numField("hot_video_days")),
        tagEditor("brands", brands, "Known brands", "Their products are marked as Brand and left out of the lists (when the title starts with it or the shop is named after it). Applies after the next sales check.",
          "e.g. VEVOR", (x) => x.slice(0, 40), (b) => b)),
      el("div", { class: "scard" }, el("h2", {}, "Video collection: where to look"), el("p", {}, "Fresh videos of these hashtags are scanned every morning."),
        tagEditor("tags", tags, "Hashtags", "Press Enter to add, without #.", "e.g. tiktokshopfinds", (x) => x.toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "") || null, (t) => "#" + t),
        numField("videos_per_hashtag"), boolField("include_trending"), numField("trending_count")),
      el("div", { class: "scard" }, el("h2", {}, "Video collection: what gets in"),
        boolField("require_shop_product"), boolField("require_product_signal"), numField("max_age_days"), numField("min_views"), numField("min_avg_views_per_hour"), numField("min_product_price"),
        el("h2", {}, "When a video drops out"), numField("drop_below_views_per_hour"), numField("min_snapshots_before_drop")),
      el("div", { class: "savebar" }, el("button", { type: "submit", class: "btn primary", id: "save" }, "Save settings"), el("span", {}, "Applies from the next run.")));
    dirty = false;
  }
  $("settings-form").addEventListener("input", (e) => { if (!/-input$/.test(e.target.id)) markDirty(); });
  $("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = document.querySelector(".savebar span");
    const vals = {};
    for (const [k, label, lo, hi] of NUM) {
      if (!$("s-" + k)) continue;
      const n = Number($("s-" + k).value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < lo || n > hi) { note.textContent = `Check “${label}”: a whole number between ${nf(lo)} and ${nf(hi)}.`; $("s-" + k).focus(); return; }
      vals[k] = n;
    }
    for (const [k] of BOOL) if ($("s-" + k)) vals[k] = $("s-" + k).checked;
    const niches = [];
    for (const n of nicheList()) {
      const lo = Number($(`n-${n.key}-min`).value), hi = Number($(`n-${n.key}-max`).value), ld = Number($(`n-${n.key}-loads`).value);
      if (![lo, hi, ld].every(Number.isFinite) || lo < 0 || hi <= lo || ld < 0 || ld > 60) { note.textContent = `Check “${nicheName(n.key)}”: the minimum price must be below the maximum, pages between 0 and 60.`; $(`n-${n.key}-min`).focus(); return; }
      niches.push({ ...n, min_price: lo, max_price: hi, loads: Math.round(ld) });
    }
    if (niches.length) vals.niches = niches;
    if (!tags.length) { note.textContent = "At least one hashtag is needed."; return; }
    Object.assign(vals, { hashtags: tags.slice(), known_brands: brands.slice() });
    $("save").disabled = true; $("save").textContent = "Saving…";
    try {
      await rpc("tr_save_settings", { p_values: vals });
      S.settings = Object.assign({}, S.settings, vals);
      dirty = false; document.querySelector(".savebar").classList.remove("dirty");
      note.textContent = "Saved. The next run uses these.";
      P.data = null;
    } catch (err) { note.textContent = errText(err); }
    finally { $("save").disabled = false; $("save").textContent = "Save settings"; }
  });

  // ---------- link lookup ----------
  const VL = { busy: false, res: null, err: "" };
  $("lookup-toggle").addEventListener("click", () => {
    const f = $("vlink-form"), open = f.hidden;
    f.hidden = !open; $("lookup-toggle").setAttribute("aria-expanded", String(open));
    if (open) $("vlink").focus(); else { VL.res = null; VL.err = ""; renderVlink(); }
  });
  async function lookupVideo(url) {
    if (!url) return;
    if (!(sb.functions && sb.functions.invoke)) { VL.err = "This lookup only works on the website, not in the chat copy."; VL.res = null; renderVlink(); return; }
    if (!/tiktok\.com/i.test(url)) { VL.err = "Paste a TikTok video or TikTok Shop product link."; VL.res = null; renderVlink(); return; }
    VL.busy = true; VL.err = ""; VL.res = null; renderVlink();
    try {
      const { data, error } = await sb.functions.invoke("tr-video-products", { body: { url }, region: "us-east-1" });
      if (error) { let msg = error.message || "unknown error"; try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {} throw new Error(msg); }
      VL.res = data;
    } catch (e) { VL.err = "Did not work: " + (e.message || e); }
    finally { VL.busy = false; renderVlink(); }
  }
  async function watchProduct(p, on) {
    try {
      if (on) {
        const rows = await rpc("tr_watch_products", { products: [{ product_id: p.product_id, title: p.title, url: p.url, image: p.image, category: p.category, seller_id: p.seller_id, shop_name: p.shop_name, price: p.price }] }) || [];
        const r = rows.find(x => x.product_id === p.product_id) || {};
        Object.assign(p, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)), { starred: true, tracked: true, known: true });
        try { await rpc("tr_refresh_rows", { p_ids: [p.product_id] }); } catch (_) {}
        delete P.extra[p.product_id];
        banner("Added to the watched products and starred. Sales are measured twice a day; the daily figure shows after the second measurement.");
      } else {
        await rpc("tr_set_product", { p_product_id: p.product_id, p_starred: false });
        p.starred = false;
      }
      renderVlink(); loadProducts();
    } catch (e) { banner("Could not save. " + errText(e), true); }
  }
  function renderVlink() {
    const box = $("vlink-res"), btn = $("vlink-btn");
    btn.disabled = VL.busy; btn.textContent = VL.busy ? "Looking up…" : "Look up";
    if (VL.busy) { box.hidden = false; fill(box, el("div", { class: "d-note" }, "Fetching from TikTok, a few seconds…")); return; }
    if (VL.err) { box.hidden = false; fill(box, el("div", { class: "vl-err" }, VL.err), el("button", { type: "button", class: "link", onclick: () => { VL.err = ""; box.hidden = true; } }, "Close")); return; }
    if (!VL.res) { box.hidden = true; return; }
    const v = VL.res.video, prods = VL.res.products || [];
    const close = closeBtn(() => { VL.res = null; renderVlink(); });
    box.hidden = false;
    fill(box,
      v ? el("div", { class: "vl-head" },
        el("div", {}, el("b", {}, v.author ? "@" + v.author : "Video"),
          el("span", {}, [v.views != null ? short(v.views) + " views" : null, v.likes != null ? short(v.likes) + " likes" : null, v.created ? ago(new Date(v.created * 1000).toISOString()) : null].filter(Boolean).join(" · ")),
          v.desc ? el("p", {}, v.desc.slice(0, 220)) : null),
        el("div", { class: "vl-actions" }, v.url ? el("a", { class: "btn", href: v.url, target: "_blank", rel: "noopener" }, "Video ↗") : null, close))
        : el("div", { class: "vl-head" }, el("div", {}, el("b", {}, "TikTok Shop product")), el("div", { class: "vl-actions" }, close)),
      prods.length ? prods.map(p => {
        const watched = !!(p.starred && p.tracked !== false);
        return el("div", { class: "vl-item" },
          el("div", { class: "vl-img" }, p.image ? el("img", { src: sized(p.image, 160) || p.image, alt: "", referrerpolicy: "no-referrer", onclick: () => openLightbox([{ src: big(p.image) || p.image, fallback: p.image }], 0) }) : "▢"),
          el("div", { class: "vl-info" }, el("b", {}, p.title || "Untitled product"),
            el("div", { class: "vl-meta" }, p.price != null ? el("span", {}, usd(p.price)) : null, p.sold_now != null ? el("span", {}, short(p.sold_now) + " sold") : null,
              p.sold_per_day != null ? el("span", { class: "money" }, "+" + nf(p.sold_per_day) + "/day · " + money(p.revenue_per_day) + "/day") : el("span", { class: "muted" }, p.known ? "daily sales: after the 2nd measurement" : "not tracked yet")),
            el("div", { class: "vl-meta" }, "Shop: ", p.store_url ? el("a", { href: p.store_url, target: "_blank", rel: "noopener" }, (p.shop_name || "open") + " ↗") : el("b", {}, p.shop_name || "unknown"),
              p.store_sold ? el("span", {}, short(p.store_sold) + " sold in total") : null, p.store_per_day ? el("span", {}, "about " + nf(p.store_per_day) + "/day") : null)),
          el("div", { class: "vl-btns" },
            p.url ? chromeLink(p.url, { class: "btn sm" }, "TikTok Shop ↗") : null,
            p.known ? el("button", { type: "button", class: "btn sm", onclick: () => openProduct(p.product_id) }, "Details") : null,
            watched ? el("button", { type: "button", class: "btn sm on", title: "Click to remove the star", onclick: () => watchProduct(p, false) }, "★ Watching")
                    : el("button", { type: "button", class: "btn sm primary", onclick: () => watchProduct(p, true) }, "+ Watch"),
            el("button", { type: "button", class: "btn sm", onclick: () => addToMine(p) }, "+ My products")));
      }) : el("div", { class: "d-note" }, "No TikTok Shop product is linked to this video (no cart icon on it)."),
      prods.length ? el("div", { class: "d-note" }, "“+ Watch” adds the product to the sales measurements and stars it. Starred products are in the Starred segment.") : null);
  }
  $("vlink-form").addEventListener("submit", (e) => { e.preventDefault(); lookupVideo($("vlink").value.trim()); });
