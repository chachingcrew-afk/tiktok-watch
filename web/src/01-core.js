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
