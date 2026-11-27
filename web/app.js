(() => {
  "use strict";
  // Built from web/src/*.js by tools/build_web.py. Edit the sources, not web/app.js.
  const CFG = window.TR_CONFIG;
  const media = (key) => key && CFG.mediaUrl ? CFG.mediaUrl.replace(/\/$/, "") + "/" + key : null;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const PAGE = 50;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("en-US");
  const nf = (n) => n == null || n === "" || isNaN(n) ? "–" : fmt.format(Math.round(n));
  const short = (n) => {
    if (n == null || n === "" || isNaN(n)) return "–";
    n = Number(n);
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e4) return Math.round(n / 1e3) + "K";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return fmt.format(Math.round(n));
  };
  const dec = (n, d = 1) => n == null || isNaN(n) ? "–" : Number(n).toFixed(d);
  const money = (n) => n == null || isNaN(n) ? "–" : "$" + (Math.abs(n) >= 1e5 ? short(n) : nf(n));
  const usd = (n) => n == null || isNaN(n) ? "–" : "$" + Number(n).toFixed(2);
  const pct = (n) => n == null || isNaN(n) ? "–" : (Math.abs(Number(n)) >= 10 ? Math.round(n) : dec(n)) + "%";
  const ago = (iso) => {
    if (!iso) return "–";
    const h = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + " min ago";
    if (h < 48) return Math.round(h) + " h ago";
    if (h < 24 * 60) return Math.round(h / 24) + " days ago";
    return Math.round(h / 24 / 30) + " months ago";
  };
  const when = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const ageText = (h) => h == null ? "–" : h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " d";
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (n, a) => { const x = document.createElementNS(NS, n); for (const [k, v] of Object.entries(a)) x.setAttribute(k, v); return x; };
  const icon = (d) => { const s = svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }); s.append(svgEl("path", { d })); return s; };
  const fill = (node, ...kids) => { node.replaceChildren(...kids.flat().filter(k => k != null && k !== false)); return node; };
  // TikTok Shop links open in Chrome on phones, so the TikTok app does not catch them.
  const UA = navigator.userAgent || "";
  const IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/i.test(UA) && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/i.test(UA);
  function chromeHref(url) {
    if (!url || !/^https?:\/\//i.test(url)) return url;
    if (IS_IOS) return url.replace(/^http(s?):\/\//i, (_m, s) => s ? "googlechromes://" : "googlechrome://");
    if (IS_ANDROID) return "intent://" + url.replace(/^https?:\/\//i, "") + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
    return url;
  }
  const chromeLink = (url, attrs, ...kids) => el("a", Object.assign({ href: chromeHref(url), target: IS_IOS || IS_ANDROID ? null : "_blank", rel: "noopener" }, attrs), ...kids);
  const store = {
    get(k) { try { return localStorage.getItem("tr-" + k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem("tr-" + k, v); } catch (_) {} },
    json(k, d) { try { const v = localStorage.getItem("tr-" + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    put(k, v) { try { localStorage.setItem("tr-" + k, JSON.stringify(v)); } catch (_) {} },
  };
  let bannerTimer;
  function banner(text, isErr, action) {
    const b = $("banner"); clearTimeout(bannerTimer);
    if (!text) { b.hidden = true; return; }
    b.className = "banner" + (isErr ? " err" : "");
    fill(b, el("span", {}, text), action ? el("button", { type: "button", class: "btn", onclick: () => { b.hidden = true; action.fn(); } }, action.label) : null);
    b.hidden = false;
    if (!isErr || action) bannerTimer = setTimeout(() => { b.hidden = true; }, 9000);
  }
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }
  const errText = (e) => (e && e.code === "42501") ? "This account has no access." : "Something went wrong: " + ((e && e.message) || "unknown error");
  // TikTok's image CDN resizes on the fly
  const sized = (url, size) => url ? url.replace(/~tplv-([a-z0-9]+)-[a-z-]+(?::\d+:\d+)?\.(webp|jpeg|jpg|png|image)/, `~tplv-$1-crop-webp:${size}:${size}.webp`) : null;
  const big = (url) => url ? url.replace(/~tplv-([a-z0-9]+)-[a-z-]+(?::\d+:\d+)?\.(webp|jpeg|jpg|png|image)/, "~tplv-$1-resize-webp:1200:1200.webp") : null;
  // a "latest request wins" guard for paged loads
  function latest() { let n = 0; return () => { const id = ++n; return () => id === n; }; }
  // numbered pager: 1 … 4 5 [6] 7 8 … 40
  function pager(box, total, page, onPage, noun) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (!total) { box.replaceChildren(); return; }
    const from = page * PAGE + 1, to = Math.min(total, (page + 1) * PAGE);
    const go = (p) => { if (p < 0 || p >= pages || p === page) return; onPage(p); };
    const nums = [];
    const add = (p) => nums.push(el("button", { type: "button", class: "num", "aria-current": p === page ? "page" : null, "aria-label": `Page ${p + 1}`, onclick: () => go(p) }, String(p + 1)));
    const set = new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 0 && p < pages));
    let last = -1;
    for (const p of [...set].sort((a, b) => a - b)) { if (p - last > 1) nums.push(el("span", { class: "gap" }, "…")); add(p); last = p; }
    fill(box,
      el("span", { class: "info" }, `${nf(from)}–${nf(to)} of ${nf(total)} ${noun || "results"}`),
      el("div", { class: "pg" },
        el("button", { type: "button", disabled: page === 0 || null, "aria-label": "Previous page", onclick: () => go(page - 1) }, "‹ Prev"),
        ...nums,
        el("button", { type: "button", disabled: page >= pages - 1 || null, "aria-label": "Next page", onclick: () => go(page + 1) }, "Next ›")));
  }
  const toTop = (node) => { const y = node.getBoundingClientRect().top + window.scrollY - 70; if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y) }); };
  const skeleton = (n) => Array.from({ length: n }, () => el("div", { class: "skel" }));

  // ---------- auth ----------
  const back = () => location.origin + location.pathname;
  let mode = "signin";
  function show(id) { for (const s of ["login", "recover", "noaccess"]) $(s).hidden = s !== id; $("app").hidden = id !== "app"; }
  function note(text, isErr) { $("login-note").textContent = text || ""; $("login-note").className = "auth-note" + (isErr ? " err" : ""); }
  async function boot() {
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === "PASSWORD_RECOVERY") { show("recover"); return; }
      if (ev === "SIGNED_IN" && session && $("app").hidden && $("recover").hidden) startApp(session);
      if (ev === "SIGNED_OUT") showLogin();
    });
    const { data } = await sb.auth.getSession();
    if (/type=recovery/.test(location.hash)) { show("recover"); return; }
    if (data.session) startApp(data.session); else showLogin();
  }
  function showLogin(msg, isErr) { show("login"); if (msg) note(msg, isErr); }
  function setMode(m) {
    mode = m;
    $("tab-signin").setAttribute("aria-selected", String(m === "signin"));
    $("tab-signup").setAttribute("aria-selected", String(m === "signup"));
    $("auth-pass2").hidden = $("auth-pass2-label").hidden = m !== "signup";
    $("auth-pass").setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
    $("auth-btn").textContent = m === "signup" ? "Create account" : "Sign in";
    $("forgot").hidden = m === "signup";
    note("");
  }
  $("tab-signin").addEventListener("click", () => setMode("signin"));
  $("tab-signup").addEventListener("click", () => setMode("signup"));
  const authMsg = (e) => {
    const m = (e && e.message) || "";
    if (/Invalid login credentials/i.test(m)) return "Wrong e-mail or password.";
    if (/Email not confirmed/i.test(m)) return "Your e-mail is not confirmed yet. Click the link in the sign-up e-mail.";
    if (/already registered/i.test(m)) return "There is already an account with this e-mail. Sign in or reset your password.";
    if (/provider is not enabled/i.test(m)) return "Google sign-in is not turned on in Supabase yet.";
    return m || "Unknown error.";
  };
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("auth-email").value.trim(), pass = $("auth-pass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { note("Enter a valid e-mail address.", true); return; }
    if (pass.length < 8) { note("The password needs at least 8 characters.", true); return; }
    $("auth-btn").disabled = true;
    try {
      if (mode === "signup") {
        if (pass !== $("auth-pass2").value) { note("The two passwords do not match.", true); return; }
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: back() } });
        if (error) throw error;
        if (data.session) startApp(data.session);
        else note("We sent you a confirmation e-mail. Click the link in it, then sign in.");
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        startApp(data.session);
      }
    } catch (err) { note(authMsg(err), true); }
    finally { $("auth-btn").disabled = false; }
  });
  $("google-btn").addEventListener("click", async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: back() } });
    if (error) note(authMsg(error), true);
  });
  $("forgot").addEventListener("click", async () => {
    const email = $("auth-email").value.trim();
    if (!email) { note("Type your e-mail above, then click again.", true); $("auth-email").focus(); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back() });
    note(error ? authMsg(error) : "If there is an account with this e-mail, we sent a link to set a new password.", !!error);
  });
  $("recover-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = $("new-pass").value;
    if (pass.length < 8) { $("recover-note").textContent = "At least 8 characters."; return; }
    const { data, error } = await sb.auth.updateUser({ password: pass });
    if (error) { $("recover-note").textContent = authMsg(error); return; }
    history.replaceState(null, "", back());
    const s = await sb.auth.getSession();
    startApp(s.data.session || { user: data.user });
  });
  const signOut = async () => { await sb.auth.signOut(); location.replace(back()); };
  $("logout").addEventListener("click", signOut);
  $("logout2").addEventListener("click", signOut);
  $("noaccess-out").addEventListener("click", signOut);

  // ---------- app state ----------
  const S = { settings: {}, runs: [], categories: {}, builtAt: null };
  const DEFAULTS = { fashion_min_price: 20, fashion_max_price: 70, fashion_fetches_per_category: 10, hot_video_days: 60, shop_min_price: 30, shop_max_price: 70, shop_min_revenue_day: 1000, shop_fetches_per_category: 3, shop_track_min_sold: 100, retire_below_per_day: 3 };
  const setting = (k) => { const v = S.settings[k]; return v != null ? Number(v) : DEFAULTS[k]; };
  // niche names in English (the settings keep the scraper's own labels)
  const NICHE_EN = { midlife: "Midlife comfort", kids: "Kids & baby", supplements: "Supplements", hair: "Hair loss & care", pain: "Pain & recovery",
    sleep: "Sleep", fashion: "Women's fashion", pets: "Pets", skin: "Skin & beauty devices" };
  const nicheList = () => Array.isArray(S.settings.niches) ? S.settings.niches : [];
  const nicheBy = (k) => nicheList().find(n => n.key === k);
  const nicheName = (k) => NICHE_EN[k] || (nicheBy(k) || {}).label || k;
  const catLabel = (c) => {
    const id = String(c || "").split("/").pop();
    return S.categories[id] || String(c || "").split("/")[0].replace(/-s-/g, "'s ").replace(/-/g, " ").replace(/^./, m => m.toUpperCase());
  };

  async function startApp(session) {
    show("app");
    $("user-email").textContent = session.user.email;
    try {
      const b = await rpc("tr_boot");
      S.settings = b.settings || {}; S.runs = b.last_runs || []; S.categories = b.categories || {}; S.builtAt = b.built_at;
    } catch (e) {
      if (e && e.code === "42501") { $("noaccess-text").textContent = `The account ${session.user.email} has no access to the data yet. Ask the owner to add it.`; show("noaccess"); return; }
      banner(errText(e), true, { label: "Retry", fn: () => startApp(session) });
      return;
    }
    renderStatus();
    selectView(store.get("view") || "products");
    setInterval(refreshStatus, 5 * 60 * 1000);
  }
  async function refreshStatus() {
    try { const b = await rpc("tr_boot"); S.runs = b.last_runs || []; S.builtAt = b.built_at; renderStatus(); } catch (_) {}
  }

  // ---------- navigation ----------
  const VIEWS = ["products", "videos", "fbads", "mine", "kits", "runs", "settings"];
  const TITLES = { products: "Products", videos: "Videos", fbads: "Facebook ads", mine: "My products", kits: "Product kits", runs: "Runs", settings: "Settings" };
  let currentView = null;
  function selectView(v) {
    if (!VIEWS.includes(v)) v = "products";
    currentView = v;
    for (const b of document.querySelectorAll(".nav-item[data-view], .bnav-item[data-view]")) {
      const on = b.dataset.view === v || (b.id === "bnav-more" && ["kits", "runs", "settings"].includes(v));
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    $("bnav-more").toggleAttribute("aria-current", ["kits", "runs", "settings"].includes(v));
    if (["kits", "runs", "settings"].includes(v)) $("bnav-more").setAttribute("aria-current", "page"); else $("bnav-more").removeAttribute("aria-current");
    for (const s of VIEWS) $("view-" + s).hidden = s !== v;
    $("mtop-title").textContent = TITLES[v];
    document.title = TITLES[v] + " · Termékradar";
    store.set("view", v);
    closeMore();
    window.scrollTo({ top: 0 });
    if (v === "products") loadProducts();
    if (v === "videos") loadVideos();
    if (v === "fbads") loadFb();
    if (v === "mine") loadMine();
    if (v === "kits") loadKits();
    if (v === "runs") loadRuns();
    if (v === "settings") renderSettings();
  }
  for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click", () => selectView(b.dataset.view));
  function openMore() { $("msheet").hidden = false; $("mscrim").hidden = false; renderStatus(); }
  function closeMore() { $("msheet").hidden = true; $("mscrim").hidden = true; }
  $("bnav-more").addEventListener("click", openMore);
  $("mtop-status").addEventListener("click", openMore);
  $("mscrim").addEventListener("click", closeMore);

  const JOBS = [["shop", "Product scan"], ["shop_track", "Sales check"], ["videos", "Product videos"], ["collect", "Video collection"], ["track", "Video tracking"], ["fbads", "Facebook ads"], ["comments_products", "Comments"]];
  function renderStatus() {
    let worst = "ok";
    const rows = JOBS.map(([job, label]) => {
      const r = S.runs.find(x => x.job === job);
      let dot = "dot", txt = "not run yet";
      if (r) {
        if (!r.finished_at) { dot = "dot run"; txt = "running"; }
        else if (r.ok) { dot = "dot ok"; txt = ago(r.finished_at); }
        else { dot = "dot err"; txt = "failed " + ago(r.finished_at); worst = "err"; }
      }
      return [dot, label, txt, r && r.error];
    });
    const mk = () => rows.map(([dot, label, txt, err]) => el("div", { title: err || null }, el("span", { class: dot }), el("b", {}, label), txt));
    fill($("side-status"), mk());
    fill($("msheet-status"), mk());
    $("mtop-dot").className = "dot " + worst;
  }


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


  // ---------- my products ----------
  const MY = { list: null, loading: false, edit: null, imgs: null, busy: 0, pasteKind: "photo", note: "", cat: "", page: 0 };
  const NOCAT = "\u0000none";
  const mineCats = () => [...new Set((MY.list || []).map(m => (m.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
  const CUR = { USD: "$", CNY: "¥", EUR: "€" };
  const curFmt = (n, c) => n == null || n === "" || isNaN(n) ? "–" : (CUR[c] || "") + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  async function loadMine(force) {
    if (MY.loading || (MY.list && !force)) { renderMine(); return; }
    MY.loading = true; renderMine();
    try { MY.list = await rpc("tr_my_products") || []; }
    catch (e) { MY.list = MY.list || []; banner("Could not load your products. " + errText(e), true); }
    finally { MY.loading = false; renderMine(); }
  }
  const linkChips = (m) => [["tiktok_url", "TikTok"], ["ali_url", "AliExpress"], ["url_1688", "1688"], ["other_url", "Other"]].filter(([k]) => m[k]).map(([k, l]) => k === "tiktok_url"
    ? chromeLink(m[k], { class: "chip blue", onclick: (e) => e.stopPropagation() }, l + " ↗")
    : el("a", { class: "chip blue", href: m[k], target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, l + " ↗"));
  function costLine(m) {
    const u = m.unit_price != null && m.unit_price !== "" ? Number(m.unit_price) : null, sh = m.shipping_price != null && m.shipping_price !== "" ? Number(m.shipping_price) : null;
    if (u == null && sh == null) return null;
    return (u || 0) + (sh || 0);
  }
  function renderMine() {
    const box = $("mine-grid"); if (!box) return;
    if (MY.loading && !MY.list) { fill(box, el("div", { class: "empty", style: "grid-column:1/-1" }, "Loading…")); return; }
    const q = ($("mine-q").value || "").trim().toLowerCase();
    const all = MY.list || [];
    const cats = mineCats();
    if (MY.cat && MY.cat !== NOCAT && !cats.includes(MY.cat)) MY.cat = "";
    const none = all.filter(m => !(m.category || "").trim()).length;
    const chip = (key, label, n) => el("button", { type: "button", class: "seg", "aria-pressed": String(MY.cat === key), onclick: () => { MY.cat = MY.cat === key ? "" : key; MY.page = 0; renderMine(); } }, label, el("em", {}, nf(n)));
    fill($("mine-cats"), cats.length ? [chip("", "All", all.length), ...cats.map(c => chip(c, c, all.filter(m => (m.category || "").trim() === c).length)), none ? chip(NOCAT, "No category", none) : null] : []);
    const list = all.filter(m => (!MY.cat || (MY.cat === NOCAT ? !(m.category || "").trim() : (m.category || "").trim() === MY.cat))
      && (!q || [m.name, m.notes, m.category, m.tiktok_url, m.ali_url, m.url_1688].some(x => (x || "").toLowerCase().includes(q))));
    if (!list.length) {
      fill(box, el("div", { class: "empty", style: "grid-column:1/-1" }, el("b", {}, all.length ? "No matches." : "No products of your own yet."),
        "Add one with “+ New product”, or open a product in Products and press “+ My products”."));
      $("mine-pager").replaceChildren();
      return;
    }
    const pages = Math.ceil(list.length / PAGE); if (MY.page >= pages) MY.page = 0;
    const slice = list.slice(MY.page * PAGE, MY.page * PAGE + PAGE);
    const card = (m) => {
      const cost = costLine(m);
      const margin = m.sale_price && cost != null && m.currency === "USD" ? Number(m.sale_price) - cost : null;
      return el("button", { type: "button", class: "mcard", onclick: () => openMine(m) },
        el("div", { class: "mthumb" }, m.thumb ? el("img", { src: "data:image/jpeg;base64," + m.thumb, alt: "" }) : "No image"),
        el("div", { class: "mbody" }, el("b", {}, m.name || "Untitled product"),
          el("div", { class: "mcost" }, cost != null ? el("span", {}, "Landed cost: ", el("strong", {}, curFmt(cost, m.currency))) : el("span", {}, "No cost yet"),
            margin != null ? el("span", { class: margin > 0 ? "pos" : "neg" }, `Profit: ${curFmt(margin, "USD")}/unit`) : null),
          el("div", { class: "mlinks" }, ...linkChips(m), m.photos ? el("span", { class: "chip" }, `${m.photos} photos`) : null, m.size_charts ? el("span", { class: "chip" }, "Size chart") : null)));
    };
    if (MY.cat || !cats.length) fill(box, slice.map(card));
    else {
      const groups = new Map();
      for (const m of slice) { const c = (m.category || "").trim() || NOCAT; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(m); }
      const order = [...groups.keys()].sort((a, b) => a === NOCAT ? 1 : b === NOCAT ? -1 : a.localeCompare(b, "en"));
      fill(box, order.flatMap(c => [el("div", { class: "group-h" }, c === NOCAT ? "No category" : c, el("em", {}, nf(groups.get(c).length))), ...groups.get(c).map(card)]));
    }
    pager($("mine-pager"), list.length, MY.page, (p) => { MY.page = p; renderMine(); toTop(box); }, "products");
  }
  $("mine-q").addEventListener("input", () => { MY.page = 0; renderMine(); });
  $("mine-new").addEventListener("click", () => openMine(null));
  function openMine(m) {
    MY.edit = m ? Object.assign({}, m) : { id: null, name: "", currency: "USD" };
    MY.imgs = m ? null : []; MY.note = ""; P.sel = null;
    $("drawer").hidden = false; $("scrim").hidden = false; document.body.style.overflow = "hidden";
    renderMineEditor(); $("drawer").scrollTop = 0;
    if (m) rpc("tr_my_product_images", { pid: m.id }).then(r => { if (MY.edit && MY.edit.id === m.id) { MY.imgs = r || []; renderMineEditor(); } })
      .catch(e => { MY.imgs = []; MY.note = "Could not load the photos. " + errText(e); renderMineEditor(); });
  }
  function closeMine() { MY.edit = null; $("drawer").hidden = true; $("scrim").hidden = true; document.body.style.overflow = ""; }
  async function addToMine(p) {
    try {
      const t = p.niche === "fashion" && p.wtype && p.wtype !== "other" ? WTYPE_EN[p.wtype] : null;
      const id = await rpc("tr_save_my_product", { p: { name: p.title || "", category: t, tiktok_url: (p.url || "").split("?")[0] || null, source_product_id: p.product_id, currency: "USD", sale_price: p.price } });
      closeDrawer(); selectView("mine");
      MY.list = await rpc("tr_my_products") || []; renderMine();
      const m = MY.list.find(x => x.id === id); if (m) openMine(m);
      banner("Added to My products. Copying the product photos…");
      importImages(id, p.product_id);
    } catch (e) { banner("Could not add it. " + errText(e), true); }
  }
  async function importImages(mineId, productId) {
    let added = 0;
    try {
      if (sb.functions && sb.functions.invoke) {
        const { data, error } = await sb.functions.invoke("tr-import-images", { body: { my_product_id: mineId, product_id: productId }, region: "us-east-1" });
        if (!error && data) added = Number(data.added) || 0;
      }
    } catch (_) {}
    let small = false;
    if (!added) { try { added = Number(await rpc("tr_copy_gallery_to_mine", { mine: mineId, src: productId })) || 0; small = added > 0; } catch (_) {} }
    banner(added ? `${added} product photos copied${small ? " (smaller size)" : ""}.` : "The product photos could not be copied, add them by hand.", !added);
    loadMine(true);
    if (MY.edit && MY.edit.id === mineId) { try { MY.imgs = await rpc("tr_my_product_images", { pid: mineId }) || []; renderMineEditor(); } catch (_) {} }
  }
  const slug = (t) => (t || "product").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "product";
  const extOf = (mime) => mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
  const b64ToBlob = (b64, mime) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime || "image/jpeg" }); };
  function saveBlob(blob, name) { const url = URL.createObjectURL(blob); const a = el("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
  const imageName = (m, im, i) => `${slug(m.name)}-${im.kind === "size_chart" ? "size-chart" : "photo"}-${String(i + 1).padStart(2, "0")}.${extOf(im.mime)}`;
  async function downloadAll(kind) {
    const m = MY.edit; if (!m) return;
    const imgs = (MY.imgs || []).filter(x => !kind || x.kind === kind);
    if (!imgs.length) return;
    if (!window.JSZip) { imgs.forEach((im, i) => setTimeout(() => saveBlob(b64ToBlob(im.data, im.mime), imageName(m, im, i)), i * 400)); return; }
    const zip = new JSZip(), counters = {};
    for (const im of imgs) { counters[im.kind] = (counters[im.kind] || 0) + 1; zip.file(imageName(m, im, counters[im.kind] - 1), im.data, { base64: true }); }
    saveBlob(await zip.generateAsync({ type: "blob" }), `${slug(m.name)}-photos.zip`);
  }
  function readMineForm() {
    const v = (id) => { const n = document.getElementById(id); return n ? n.value.trim() : ""; };
    Object.assign(MY.edit, { name: v("m-name"), category: v("m-cat"), tiktok_url: v("m-tiktok"), ali_url: v("m-ali"), url_1688: v("m-1688"), other_url: v("m-other"),
      currency: v("m-cur") || "USD", unit_price: v("m-unit").replace(",", "."), shipping_price: v("m-ship").replace(",", "."), sale_price: v("m-sale").replace(",", "."), notes: v("m-notes") });
  }
  async function saveMine(quiet) {
    readMineForm();
    for (const k of ["unit_price", "shipping_price", "sale_price"]) if (MY.edit[k] !== "" && isNaN(Number(MY.edit[k]))) { MY.note = "Use numbers for the prices, e.g. 4.50"; renderMineEditor(); return null; }
    MY.busy++; if (!quiet) { MY.note = "Saving…"; renderMineEditor(); }
    try { const id = await rpc("tr_save_my_product", { p: MY.edit }); MY.edit.id = id; MY.note = quiet ? MY.note : "Saved."; loadMine(true); return id; }
    catch (e) { MY.note = "Could not save. " + errText(e); return null; }
    finally { MY.busy--; renderMineEditor(); }
  }
  function loadBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  async function toJpeg(file, max, q) {
    const bmp = await loadBitmap(file);
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q).split(",")[1];
  }
  async function addMineImages(files, kind) {
    files = [...files].filter(f => f && f.type && f.type.startsWith("image/"));
    if (!files.length || !MY.edit) return;
    if (!MY.edit.id) { if (!MY.edit.name) { const n = document.getElementById("m-name"); MY.edit.name = n && n.value.trim() ? n.value.trim() : "New product"; } if (!(await saveMine(true))) return; }
    const pid = MY.edit.id;
    MY.busy++; MY.note = `Uploading ${files.length} photo(s)…`; renderMineEditor();
    let ok = 0;
    for (const f of files) {
      try {
        const data = await toJpeg(f, kind === "size_chart" ? 1800 : 1400, 0.82), thumb = await toJpeg(f, 240, 0.7);
        const id = await rpc("tr_add_my_image", { pid, kind, data, thumb });
        if (MY.edit && MY.edit.id === pid) { (MY.imgs = MY.imgs || []).push({ id, kind, idx: 999, data, thumb }); ok++; renderMineEditor(); }
      } catch (e) { MY.note = "A photo could not be uploaded. " + errText(e); }
    }
    MY.busy--; if (ok) MY.note = `${ok} photo(s) added.`; renderMineEditor(); loadMine(true);
  }
  async function removeMineImage(im) {
    try { await rpc("tr_remove_my_image", { iid: im.id }); MY.imgs = MY.imgs.filter(x => x !== im); renderMineEditor(); loadMine(true); }
    catch (e) { MY.note = "Could not delete. " + errText(e); renderMineEditor(); }
  }
  async function removeMine() {
    if (!MY.edit || !MY.edit.id) { closeMine(); return; }
    if (!MY.confirmDel) { MY.confirmDel = true; MY.note = "Delete this product? Press Delete again to confirm."; renderMineEditor(); setTimeout(() => { MY.confirmDel = false; }, 6000); return; }
    MY.confirmDel = false;
    try { await rpc("tr_remove_my_product", { pid: MY.edit.id }); closeMine(); loadMine(true); banner("Deleted."); }
    catch (e) { MY.note = "Could not delete. " + errText(e); renderMineEditor(); }
  }
  function imageZone(kind, title, help) {
    const imgs = (MY.imgs || []).filter(x => x.kind === kind);
    const input = el("input", { type: "file", accept: "image/*", multiple: kind === "photo" ? true : null, hidden: true, onchange: (e) => { addMineImages(e.target.files, kind); e.target.value = ""; } });
    const zone = el("div", { class: "mz", tabindex: "0", onmouseenter: () => { MY.pasteKind = kind; }, onfocus: () => { MY.pasteKind = kind; },
      ondragover: (e) => { e.preventDefault(); zone.classList.add("over"); }, ondragleave: () => zone.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); zone.classList.remove("over"); addMineImages(e.dataTransfer.files, kind); } },
      imgs.map((im, i) => el("div", { class: "mz-img" },
        el("img", { src: `data:${im.mime || "image/jpeg"};base64,` + (im.thumb || im.data), alt: "", title: "Click to enlarge", onclick: () => openLightbox(imgs.map(x => ({ src: `data:${x.mime || "image/jpeg"};base64,` + x.data })), i) }),
        el("button", { type: "button", class: "mz-dl", "aria-label": "Download photo", onclick: () => saveBlob(b64ToBlob(im.data, im.mime), imageName(MY.edit, im, i)) }, "⤓"),
        el("button", { type: "button", class: "mz-del", "aria-label": "Delete photo", onclick: () => removeMineImage(im) }, "×"))),
      el("button", { type: "button", class: "mz-add", onclick: () => input.click() }, el("span", {}, "+"), kind === "photo" ? "Photos" : "Image"));
    return el("div", { class: "d-sec" }, el("h3", {}, title, el("span", { class: "mz-head" }, imgs.length ? `${imgs.length}` : "",
        imgs.length ? el("button", { type: "button", class: "link", onclick: () => downloadAll(kind) }, imgs.length > 1 ? "Download all (ZIP)" : "Download") : null)), zone, input,
      el("div", { class: "d-note" }, help));
  }
  function renderMineEditor() {
    const m = MY.edit, d = $("drawer");
    if (!m) return;
    const field = (id, label, value, attrs) => el("div", { class: "field" }, el("label", { for: id }, label), el("input", Object.assign({ id, value: value ?? "", autocomplete: "off" }, attrs || {})));
    const linkField = (id, label, value, ph) => el("div", { class: "field" }, el("label", { for: id }, label),
      el("div", { class: "mlink" }, el("input", { id, type: "url", value: value || "", placeholder: ph, autocomplete: "off" }), value ? el("a", { class: "btn", href: value, target: "_blank", rel: "noopener" }, "Open ↗") : null));
    const cur = m.currency || "USD";
    fill(d,
      el("div", { class: "d-top" }, el("span", { class: "crumbs" }, "My product" + (m.created_at ? " · added " + new Date(m.created_at).toLocaleDateString("en-US") : "")), closeBtn(closeMine)),
      el("form", { class: "mine-form", novalidate: true, onsubmit: (e) => { e.preventDefault(); saveMine(false); } },
        el("div", { class: "d-sec" },
          field("m-name", "Product name", m.name, { placeholder: "e.g. Fleece-lined winter tights" }),
          field("m-cat", "Category", m.category, { list: "m-cat-list", placeholder: "e.g. " + (mineCats()[0] || "Party dresses") }),
          el("datalist", { id: "m-cat-list" }, [...new Set([...mineCats(), ...Object.values(WTYPE_EN)])].map(c => el("option", { value: c }))),
          linkField("m-tiktok", "TikTok Shop link", m.tiktok_url, "https://shop.tiktok.com/us/pdp/…"),
          linkField("m-ali", "AliExpress link", m.ali_url, "https://www.aliexpress.com/item/…"),
          linkField("m-1688", "1688.com link", m.url_1688, "https://detail.1688.com/offer/…"),
          linkField("m-other", "Other supplier (CJ etc.)", m.other_url, "https://…")),
        el("div", { class: "d-sec" }, el("h3", {}, "Costs", el("span", {}, "per unit")),
          el("div", { class: "mprices" },
            el("div", { class: "field" }, el("label", { for: "m-cur" }, "Currency"), el("select", { id: "m-cur" }, ["USD", "CNY", "EUR"].map(c => el("option", { value: c, selected: c === cur ? "" : null }, c + " (" + CUR[c] + ")")))),
            field("m-unit", "Unit price", m.unit_price, { inputmode: "decimal", placeholder: "0.00" }),
            field("m-ship", "Shipping per unit", m.shipping_price, { inputmode: "decimal", placeholder: "0.00" }),
            field("m-sale", "Selling price (USD)", m.sale_price, { inputmode: "decimal", placeholder: "0.00" })),
          mineSum(m)),
        el("div", { class: "d-sec" }, el("div", { class: "field" }, el("label", { for: "m-notes" }, "Notes"), el("textarea", { id: "m-notes", rows: "3", placeholder: "e.g. MOQ, shipping time, colours, supplier name" }, m.notes || ""))),
        el("div", { class: "msave" },
          el("button", { type: "submit", class: "btn primary", disabled: MY.busy ? "" : null }, MY.edit.id ? "Save" : "Create"),
          el("span", { class: "d-note", role: "status" }, MY.note || ""),
          m.id ? el("button", { type: "button", class: "btn danger", onclick: removeMine }, "Delete") : null)),
      ...(MY.imgs == null ? [el("div", { class: "d-sec" }, el("div", { class: "d-note" }, "Loading photos…"))] : [
        imageZone("photo", "Product photos", "Drop photos here, press “+ Photos” or paste them (Ctrl+V). The browser shrinks them before saving."),
        imageZone("size_chart", "Size chart", "The supplier's size chart as an image. Drop or paste it while the pointer is over this box.")]));
    for (const id of ["m-cur", "m-unit", "m-ship", "m-sale"])
      document.getElementById(id).addEventListener("input", () => { readMineForm(); const old = d.querySelector(".msumwrap"); if (old) old.replaceWith(mineSum(MY.edit)); });
  }
  function mineSum(m) {
    const cur = m.currency || "USD", cost = costLine(m);
    const sale = m.sale_price !== "" && m.sale_price != null && !isNaN(m.sale_price) ? Number(m.sale_price) : null;
    const margin = sale != null && cost != null && cur === "USD" ? sale - cost : null;
    return el("div", { class: "msumwrap" },
      el("div", { class: "msum" },
        el("div", {}, el("span", {}, "Landed cost / unit"), el("b", {}, cost != null && !isNaN(cost) ? curFmt(cost, cur) : "–")),
        el("div", {}, el("span", {}, "Profit / unit"), el("b", { class: margin == null ? "" : margin > 0 ? "pos" : "neg" }, margin != null && !isNaN(margin) ? curFmt(margin, "USD") : "–")),
        el("div", {}, el("span", {}, "Margin"), el("b", {}, margin != null && sale ? Math.round(margin / sale * 100) + "%" : "–"))),
      cur !== "USD" && sale != null ? el("div", { class: "d-note" }, "For the profit, enter the cost in USD too (or change the currency).") : null);
  }
  document.addEventListener("paste", (e) => {
    if (!MY.edit || $("drawer").hidden) return;
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault(); addMineImages(files, MY.pasteKind);
  });

  // ---------- product kits ----------
  const KIT = { list: null, loading: false, adding: false, msg: "", busy: {}, comments: {}, root: null, rootName: "", videos: 10, page: 0 };
  const KIT_DIRS = ["01_info", "02_gallery", "03_colors", "04_description_images", "05_videos", "06_reviews", "07_models", "08_references", "09_prompts", "10_output"];
  const canFolders = () => typeof window.showDirectoryPicker === "function";
  const canFns = () => !!(sb.functions && sb.functions.invoke);
  function kitDb() { return new Promise((res, rej) => { const r = indexedDB.open("tr-kits", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function kvGet(k) { try { const d = await kitDb(); return await new Promise((res) => { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch (_) { return null; } }
  async function kvSet(k, v) { try { const d = await kitDb(); await new Promise((res) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (_) {} }
  (async () => { const h = await kvGet("root"); if (h) { KIT.root = h; KIT.rootName = h.name; if (currentView === "kits") renderKits(); } })();
  async function pickRoot() {
    if (!canFolders()) { KIT.msg = "This browser cannot save into a folder. Use Chrome or Edge on a computer."; renderKits(); return; }
    try { const h = await window.showDirectoryPicker({ id: "tr-kits", mode: "readwrite" }); KIT.root = h; KIT.rootName = h.name; await kvSet("root", h); KIT.msg = ""; renderKits(); }
    catch (e) { if (e && e.name !== "AbortError") { KIT.msg = "The folder could not be selected. " + (e.message || ""); renderKits(); } }
  }
  async function rootReady() {
    if (!KIT.root) { await pickRoot(); if (!KIT.root) return null; }
    const opts = { mode: "readwrite" };
    if ((await KIT.root.queryPermission(opts)) === "granted" || (await KIT.root.requestPermission(opts)) === "granted") return KIT.root;
    KIT.msg = "The browser did not get write permission for the folder."; renderKits(); return null;
  }
  async function loadKits(force) {
    if (KIT.loading || (KIT.list && !force)) { renderKits(); return; }
    KIT.loading = true; renderKits();
    try { KIT.list = await rpc("tr_kits") || []; }
    catch (e) { KIT.list = KIT.list || []; banner("Could not load the product kits. " + errText(e), true); }
    finally { KIT.loading = false; renderKits(); }
  }
  async function kitCall(body) {
    const { data, error } = await sb.functions.invoke("tr-kit", { body, region: "us-east-1" });
    if (error) { let msg = error.message || "unknown error"; try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {} throw new Error(msg); }
    return data;
  }
  async function addKits() {
    const box = $("kit-links");
    const links = [...new Set((box.value || "").split(/[\s,]+/).map(s => s.trim()).filter(s => /tiktok\.com|^\d{15,25}$/.test(s)))];
    if (!links.length) { KIT.msg = "Paste at least one TikTok Shop product link."; renderKits(); return; }
    if (!canFns()) { KIT.msg = "Fetching only works on the website, not in the chat copy."; renderKits(); return; }
    KIT.adding = true; let ok = 0; const errs = [];
    for (let i = 0; i < links.length; i++) {
      KIT.msg = `Fetching product ${i + 1} of ${links.length}…`; renderKits();
      try { const d = await kitCall({ action: "info", url: links[i] }); await rpc("tr_save_kit", { d }); ok++; }
      catch (e) { errs.push((links.length > 1 ? links[i].slice(0, 60) + ": " : "") + (e.message || e)); }
    }
    KIT.adding = false; box.value = "";
    KIT.msg = (ok ? `${ok} product(s) fetched.` : "") + (errs.length ? " " + errs.join(" · ") : "");
    await loadKits(true);
  }
  async function refreshKit(k) {
    KIT.busy[k.id] = "Refreshing…"; renderKits();
    try { const d = await kitCall({ action: "info", url: k.product_id }); await rpc("tr_save_kit", { d }); delete KIT.busy[k.id]; await loadKits(true); }
    catch (e) { KIT.busy[k.id] = "Could not refresh: " + (e.message || e); renderKits(); }
  }
  async function removeKit(k) {
    if (KIT.busy[k.id] !== "confirm") { KIT.busy[k.id] = "confirm"; renderKits(); setTimeout(() => { if (KIT.busy[k.id] === "confirm") { delete KIT.busy[k.id]; renderKits(); } }, 6000); return; }
    try { await rpc("tr_remove_kit", { kid: k.id }); delete KIT.busy[k.id]; await loadKits(true); } catch (e) { KIT.busy[k.id] = errText(e); renderKits(); }
  }
  function kitReviews(k) {
    window.postMessage({ src: "tr-app", cmd: "session" }, location.origin);
    window.open(`https://shop.tiktok.com/us/pdp/x/${k.product_id}#tr-reviews`, "_blank", "noopener");
    KIT.busy[k.id] = "Collecting reviews in the TikTok Shop tab that opened (needs the extension)…"; renderKits();
    const until = Date.now() + 4 * 60 * 1000, before = Number(k.reviews) || 0;
    const t = setInterval(async () => {
      if (Date.now() > until) { clearInterval(t); delete KIT.busy[k.id]; await loadKits(true); return; }
      try { const list = await rpc("tr_kits") || []; const n = list.find(x => x.id === k.id); if (n && (Number(n.reviews) > before || n.review_status === "done")) { KIT.list = list; if (n.review_status === "done") { clearInterval(t); delete KIT.busy[k.id]; } renderKits(); } } catch (_) {}
    }, 8000);
  }
  const safeName = (s) => (s || "").replace(/[\\/:*?"<>|#%]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "x";
  const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (rows) => rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  async function writeFile(dir, name, data) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }
  async function fileExists(dir, name) { try { await dir.getFileHandle(name); return true; } catch (_) { return false; } }
  function kitReadme(d) {
    return [`${d.title}`, `${d.url}`, "", "Folders:",
      "01_info                 product.json (all data), product.md (description, specs, prices, reviews summary), skus.csv",
      "02_gallery              the TikTok Shop gallery photos (supplier photos)",
      "03_colors               one photo per color / variant",
      "04_description_images   images from the product description (often the size chart)",
      "05_videos               the most viewed creator videos of the product + videos.csv (all of them, with links)",
      "06_reviews              customer reviews (reviews.md) and their photos; relevant creator-video comments (comments.md, comments.csv)",
      "07_models               put your model photos here", "08_references           put example / reference images here",
      "09_prompts              the image prompts go here", "10_output               finished product photos go here",
      "", "Creator videos and supplier photos are for reference only. Do not publish them without permission.", ""].join("\n");
  }
  function kitMarkdown(d, rv) {
    const L = [];
    L.push(`# ${d.title}`, "", `- TikTok Shop: ${d.url}`, `- Store: ${d.shop_name || "–"}${d.shop_followers ? ` (${d.shop_followers} followers, rating ${d.shop_rating ?? "–"})` : ""}`);
    L.push(`- Price: $${d.price ?? "–"}${d.price_max && d.price_max !== d.price ? `–$${d.price_max}` : ""}${d.price_original ? ` (compare at $${d.price_original})` : ""}`);
    L.push(`- Rating: ${d.rating ?? "–"} from ${d.review_count ?? "–"} reviews · Sold: ${d.sold ?? "–"}`);
    if (d.options && d.options.length) for (const o of d.options) L.push(`- ${o.name}: ${o.values.join(", ")}`);
    if (d.summary) L.push("", "## Summary", "", d.summary);
    if (d.description && d.description.length) L.push("", "## Description (supplier)", "", ...d.description.map(t => t.split("\n").map(x => "- " + x.trim()).join("\n")));
    if (d.specifications && d.specifications.length) L.push("", "## Specifications", "", ...d.specifications.map(s => `- ${s.name}: ${s.value}`));
    if (d.keywords) L.push("", "## Search keywords", "", d.keywords);
    if (rv && rv.length) { const by = [5, 4, 3, 2, 1].map(s => `${s}★ ${rv.filter(r => Number(r.rating) === s).length}`).join(" · "); L.push("", `## Reviews (${rv.length} saved: ${by})`, "", "See 06_reviews/reviews.md for the full text."); }
    return L.join("\n") + "\n";
  }
  function reviewsMarkdown(d, rv) {
    const L = [`# Reviews: ${d.title}`, "", `${rv.length} reviews saved from TikTok Shop. Lowest ratings first: they show what buyers worry about.`, ""];
    rv.slice().sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0)).forEach((r, i) => {
      L.push(`## ${i + 1}. ${"★".repeat(Number(r.rating) || 0)}${r.sku ? " · " + r.sku : ""}${r.review_time ? " · " + String(r.review_time).slice(0, 10) : ""}`);
      if (r.text) L.push("", r.text);
      if (r.images && r.images.length) L.push("", `Photos: ${r.images.map((_, j) => `photos/review-${String(i + 1).padStart(3, "0")}-${j + 1}.jpg`).join(", ")}`);
      L.push("");
    });
    return L.join("\n");
  }
  function commentsMarkdown(d, cm) {
    const L = [`# Creator video comments: ${d.title || d.product_id}`, "", `${cm.length} relevant comments from the most played creator videos (small talk removed), most liked first.`, ""];
    for (const [k, label] of CTAGS) {
      const xs = cm.filter(c => (c.tags || []).includes(k));
      if (!xs.length) continue;
      L.push(`## ${label} (${xs.length})`, "");
      for (const c of xs) L.push(`- ${String(c.text || "").replace(/\s+/g, " ").trim()}${c.likes ? ` (${c.likes} likes)` : ""}`);
      L.push("");
    }
    return L.join("\n");
  }
  async function saveKitToFolder(k) {
    const root = await rootReady(); if (!root) return;
    const d = k.data, set = (t) => { KIT.busy[k.id] = t; renderKits(); };
    const name = safeName(`${slug(d.title).slice(0, 40)}-${String(d.product_id).slice(-6)}`);
    const errs = [];
    try {
      const dir = await root.getDirectoryHandle(name, { create: true });
      const sub = {};
      for (const n of KIT_DIRS) sub[n] = await dir.getDirectoryHandle(n, { create: true });
      set("Saving data…");
      let rv = [];
      try { const r = await rpc("tr_reviews", { pid: d.product_id }); rv = (r && r.reviews) || []; } catch (_) {}
      await writeFile(dir, "README.txt", kitReadme(d));
      await writeFile(sub["01_info"], "product.json", JSON.stringify(d, null, 2));
      await writeFile(sub["01_info"], "product.md", kitMarkdown(d, rv));
      const optNames = (d.options || []).map(o => o.name);
      await writeFile(sub["01_info"], "skus.csv", csv([[...optNames, "price", "compare_at", "stock"], ...(d.skus || []).map(s => [...optNames.map(n => s.options[n]), s.price, s.price_original, s.stock])]));
      const pics = [
        ...(d.gallery || []).map((u, i) => [sub["02_gallery"], `${String(i + 1).padStart(2, "0")}.jpg`, u]),
        ...(d.colors || []).filter(c => c.image).map(c => [sub["03_colors"], `${safeName(c.name)}.jpg`, c.image]),
        ...(d.description_images || []).map((u, i) => [sub["04_description_images"], `${String(i + 1).padStart(2, "0")}.jpg`, u])];
      for (let i = 0; i < pics.length; i++) {
        const [dd, fn, u] = pics[i];
        set(`Downloading images ${i + 1}/${pics.length}…`);
        if (await fileExists(dd, fn)) continue;
        try { const b = await kitCall({ action: "file", url: u }); await writeFile(dd, fn, b); } catch (e) { errs.push(fn); }
      }
      const vids = d.videos || [];
      await writeFile(sub["05_videos"], "videos.csv", csv([["rank", "views", "likes", "seconds", "uploaded", "creator", "title", "link"],
        ...vids.map((v, i) => [i + 1, v.plays, v.likes, v.duration_ms ? Math.round(v.duration_ms / 1000) : "", (v.uploaded || "").slice(0, 10), v.author, v.title, `https://www.tiktok.com/@_/video/${v.item_id}`])]));
      const top = vids.slice(0, KIT.videos);
      for (let i = 0; i < top.length; i++) {
        const v = top[i], fn = `${String(i + 1).padStart(2, "0")}_${Math.round((v.plays || 0) / 1000)}k-views_${v.item_id}.mp4`;
        set(`Downloading videos ${i + 1}/${top.length}…`);
        if (await fileExists(sub["05_videos"], fn)) continue;
        try { const b = await kitCall({ action: "video", item_id: v.item_id, author: v.author }); await writeFile(sub["05_videos"], fn, b); } catch (e) { errs.push(fn); }
      }
      if (rv.length) {
        set("Saving reviews…");
        await writeFile(sub["06_reviews"], "reviews.md", reviewsMarkdown(d, rv));
        const photos = await sub["06_reviews"].getDirectoryHandle("photos", { create: true });
        const sorted = rv.slice().sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
        for (let i = 0; i < sorted.length; i++) for (let j = 0; j < (sorted[i].images || []).length; j++) {
          const im = sorted[i].images[j]; if (typeof im !== "string") continue;
          await writeFile(photos, `review-${String(i + 1).padStart(3, "0")}-${j + 1}.jpg`, b64ToBlob(im, "image/jpeg"));
        }
      } else await writeFile(sub["06_reviews"], "README.txt", "No reviews saved yet. In Termékradar press \"Reviews\" on this product (needs the browser extension), then save the folder again.\n");
      set("Saving comments…");
      try {
        const cm = await rpc("tr_kit_comments", { pid: d.product_id }) || [];
        if (cm.length) {
          await writeFile(sub["06_reviews"], "comments.md", commentsMarkdown(d, cm));
          await writeFile(sub["06_reviews"], "comments.csv", csv([["likes", "tags", "date", "comment", "video"], ...cm.map(c => [c.likes, (c.tags || []).join(" "), (c.created_at || "").slice(0, 10), c.text, `https://www.tiktok.com/@_/video/${c.video_id}`])]));
        }
      } catch (_) { errs.push("comments"); }
      for (const n of ["07_models", "08_references", "09_prompts", "10_output"]) if (!(await fileExists(sub[n], ".keep"))) await writeFile(sub[n], ".keep", "");
      await rpc("tr_kit_saved", { kid: k.id, folder: `${KIT.rootName}/${name}` });
      KIT.busy[k.id] = errs.length ? `Saved to ${KIT.rootName}/${name}, but ${errs.length} file(s) did not download (${errs.slice(0, 3).join(", ")}${errs.length > 3 ? "…" : ""}). Save again later: existing files are not downloaded twice.` : `Saved: ${KIT.rootName}/${name}`;
      await loadKits(true);
    } catch (e) { KIT.busy[k.id] = "Could not save: " + (e.message || e); renderKits(); }
  }
  async function toggleKitComments(k) {
    if (KIT.comments[k.id]) { delete KIT.comments[k.id]; renderKits(); return; }
    KIT.comments[k.id] = "loading"; renderKits();
    try { KIT.comments[k.id] = await rpc("tr_kit_comments", { pid: k.product_id }) || []; }
    catch (e) { KIT.comments[k.id] = []; KIT.busy[k.id] = errText(e); }
    renderKits();
  }
  function kitCommentsBox(k) {
    const cm = KIT.comments[k.id];
    if (!cm) return null;
    if (cm === "loading") return el("div", { class: "d-note" }, "Loading comments…");
    if (!cm.length) return el("div", { class: "d-note" }, k.comments_at ? "No relevant comments for this product." : "This product's comments have not been collected yet.");
    return commentGroups(cm);
  }
  function renderKits() {
    const box = $("kit-list"); if (!box) return;
    fill($("kit-root"), el("span", { class: "muted" }, "Save folder: "), el("b", {}, KIT.rootName || "not selected"),
      el("button", { type: "button", class: "btn sm", onclick: pickRoot }, KIT.rootName ? "Change folder" : "Choose folder"),
      el("label", { class: "kit-vidn" }, "Videos per product", el("select", { onchange: (e) => { KIT.videos = Number(e.target.value); } }, [0, 5, 10, 20].map(n => el("option", { value: String(n), selected: n === KIT.videos ? "" : null }, n ? String(n) : "none")))));
    $("kit-msg").textContent = KIT.msg || (canFolders() ? "" : "Saving into a folder needs Chrome or Edge on a computer.");
    $("kit-add").disabled = KIT.adding;
    if (KIT.loading && !KIT.list) { fill(box, skeleton(3)); return; }
    const list = KIT.list || [];
    if (!list.length) { fill(box, el("div", { class: "card empty" }, el("b", {}, "No product kits yet."), "Paste one or more TikTok Shop product links above and press Fetch.")); $("kit-pager").replaceChildren(); return; }
    const pages = Math.ceil(list.length / PAGE); if (KIT.page >= pages) KIT.page = 0;
    fill(box, list.slice(KIT.page * PAGE, KIT.page * PAGE + PAGE).map(k => {
      const d = k.data || {}, busy = KIT.busy[k.id];
      const chips = [`${(d.gallery || []).length} gallery photos`, `${(d.colors || []).length} colours`, `${(d.sizes || []).length} sizes`, `${(d.description_images || []).length} description images`,
        `${(d.videos || []).length} videos`, `${Number(k.reviews) || 0} reviews saved`, k.comments_at ? `${nf(Number(k.comments) || 0)} relevant comments` : "comments: not collected yet"];
      return el("div", { class: "kit-card" },
        el("div", { class: "mthumb" }, d.gallery && d.gallery[0] ? el("img", { src: sized(d.gallery[0], 240), alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : "No image"),
        el("div", { class: "mbody" }, el("b", {}, d.title || d.product_id),
          el("div", { class: "kit-meta" }, d.price != null ? el("span", {}, el("strong", {}, "$" + d.price), d.price_original ? el("s", {}, " $" + d.price_original) : null) : null,
            d.rating != null ? el("span", {}, `${d.rating}★ (${nf(d.review_count)} ratings)`) : null, d.sold != null ? el("span", {}, `${nf(d.sold)} sold`) : null,
            d.shop_name ? el("span", { class: "muted" }, d.shop_name) : null),
          el("div", { class: "mlinks" }, chips.map(c => el("span", { class: "chip" }, c))),
          k.saved_at ? el("div", { class: "d-note" }, `Saved: ${k.folder || ""} · ${new Date(k.saved_at).toLocaleString("en-US")}`) : null,
          busy && busy !== "confirm" ? el("div", { class: "d-note", role: "status" }, busy) : null,
          kitCommentsBox(k),
          el("div", { class: "kit-actions" },
            el("button", { type: "button", class: "btn sm primary", onclick: () => saveKitToFolder(k) }, k.saved_at ? "Save again" : "Save to computer"),
            el("button", { type: "button", class: "btn sm", onclick: () => kitReviews(k) }, "Reviews"),
            el("button", { type: "button", class: "btn sm", "aria-expanded": KIT.comments[k.id] ? "true" : "false", onclick: () => toggleKitComments(k) }, KIT.comments[k.id] ? "Hide comments" : "Comments"),
            el("button", { type: "button", class: "btn sm", onclick: () => refreshKit(k) }, "Refresh"),
            chromeLink(d.url || `https://shop.tiktok.com/us/pdp/x/${k.product_id}`, { class: "btn sm" }, "TikTok Shop ↗"),
            el("button", { type: "button", class: "btn sm danger", onclick: () => removeKit(k) }, busy === "confirm" ? "Really delete?" : "Delete"))));
    }));
    pager($("kit-pager"), list.length, KIT.page, (p) => { KIT.page = p; renderKits(); toTop(box); }, "kits");
  }
  $("kit-add").addEventListener("click", addKits);

  boot();
})();
