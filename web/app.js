(() => {
  "use strict";
  const CFG = window.TR_CONFIG;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, detectSessionInUrl: true } });

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("hu-HU");
  const nf = (n) => n == null || isNaN(n) ? "–" : fmt.format(Math.round(n));
  const short = (n) => {
    if (n == null || isNaN(n)) return "–";
    n = Number(n);
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(".", ",") + " Mrd";
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",") + "M";
    if (a >= 1e4) return Math.round(n / 1e3) + "e";
    return fmt.format(Math.round(n));
  };
  const dec = (n, d = 1) => n == null || isNaN(n) ? "–" : Number(n).toFixed(d).replace(".", ",");
  const money = (n) => n == null || isNaN(n) ? "–" : "$" + (Math.abs(n) >= 1e6 ? short(n) : nf(n));
  const usd = (n) => n == null || isNaN(n) ? "–" : "$" + Number(n).toFixed(2);
  const pct = (n) => n == null || isNaN(n) ? "–" : (Number(n) >= 10 ? Math.round(n) : dec(n)) + "%";
  const ago = (iso) => {
    if (!iso) return "–";
    const h = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + " perce";
    if (h < 48) return Math.round(h) + " órája";
    if (h < 24 * 60) return Math.round(h / 24) + " napja";
    return Math.round(h / 24 / 30) + " hónapja";
  };
  const when = (ms) => new Date(ms).toLocaleString("hu-HU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const ageText = (h) => h == null ? "–" : h < 48 ? Math.round(h) + " ó" : Math.round(h / 24) + " nap";
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
  // TikTok Shop links open in Chrome on phones, so the TikTok app does not catch them.
  // iPhone/iPad: Chrome's own link scheme. Android: an intent aimed at Chrome, falling back to the
  // normal browser when Chrome is missing. Computers: a normal new tab (a web page cannot pick the browser).
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
  };
  let bannerTimer;
  function banner(text, isErr, action) {
    const b = $("banner"); clearTimeout(bannerTimer);
    if (!text) { b.hidden = true; return; }
    b.className = "banner" + (isErr ? " err" : "");
    b.replaceChildren(...[el("span", {}, text), action ? el("button", { type: "button", class: "btn", onclick: () => { b.hidden = true; action.fn(); } }, action.label) : null].filter(Boolean));
    b.hidden = false;
    if (!isErr || action) bannerTimer = setTimeout(() => { b.hidden = true; }, 9000);
  }
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }
  const errText = (e) => (e && e.code === "42501") ? "Ehhez a fiókhoz nincs hozzáférés." : "Hiba történt: " + ((e && e.message) || "ismeretlen hiba");

  // CDN image in a given size (TikTok's image CDN resizes on the fly)
  const sized = (url, size) => url ? url.replace(/~tplv-([a-z0-9]+)-[a-z-]+(?::\d+:\d+)?\.(webp|jpeg|jpg|png|image)/, `~tplv-$1-crop-webp:${size}:${size}.webp`) : null;

  // ---------- auth ----------
  const back = () => location.origin + location.pathname;
  let mode = "signin";
  function show(id) { for (const s of ["login", "recover", "noaccess"]) $(s).hidden = s !== id; $("app").hidden = id !== "app"; }
  function note(text, isErr) { $("login-note").textContent = text || ""; $("login-note").className = "login-note" + (isErr ? " err" : ""); }
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
    $("auth-btn").textContent = m === "signup" ? "Regisztráció" : "Belépés";
    $("forgot").hidden = m === "signup";
    note("");
  }
  $("tab-signin").addEventListener("click", () => setMode("signin"));
  $("tab-signup").addEventListener("click", () => setMode("signup"));
  const authMsg = (e) => {
    const m = (e && e.message) || "";
    if (/Invalid login credentials/i.test(m)) return "Hibás e-mail cím vagy jelszó.";
    if (/Email not confirmed/i.test(m)) return "Az e-mail címed még nincs megerősítve. Kattints a regisztráció után kapott levélben lévő linkre.";
    if (/already registered/i.test(m)) return "Ezzel a címmel már van fiók. Lépj be, vagy kérj új jelszót.";
    if (/provider is not enabled/i.test(m)) return "A Google-belépés még nincs bekapcsolva a Supabase-ben.";
    return m || "Ismeretlen hiba.";
  };
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("auth-email").value.trim(), pass = $("auth-pass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { note("Adj meg egy érvényes e-mail címet.", true); return; }
    if (pass.length < 8) { note("A jelszó legalább 8 karakter legyen.", true); return; }
    $("auth-btn").disabled = true;
    try {
      if (mode === "signup") {
        if (pass !== $("auth-pass2").value) { note("A két jelszó nem egyezik.", true); return; }
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: back() } });
        if (error) throw error;
        if (data.session) startApp(data.session);
        else note("Elküldtük a megerősítő e-mailt. Kattints a benne lévő linkre, utána be tudsz lépni.");
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
    if (!email) { note("Írd be fent az e-mail címed, aztán kattints újra.", true); $("auth-email").focus(); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back() });
    note(error ? authMsg(error) : "Ha van fiók ezzel a címmel, küldtünk egy linket az új jelszóhoz.", !!error);
  });
  $("recover-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = $("new-pass").value;
    if (pass.length < 8) { $("recover-note").textContent = "Legalább 8 karakter legyen."; return; }
    const { data, error } = await sb.auth.updateUser({ password: pass });
    if (error) { $("recover-note").textContent = authMsg(error); return; }
    history.replaceState(null, "", back());
    const s = await sb.auth.getSession();
    startApp(s.data.session || { user: data.user });
  });
  $("logout").addEventListener("click", async () => { await sb.auth.signOut(); location.replace(back()); });
  $("noaccess-out").addEventListener("click", async () => { await sb.auth.signOut(); location.replace(back()); });

  // ---------- state ----------
  let state = { shop: [], videos: [], history: {}, runs: [], settings: {} };
  const P = { focus: null, seg: store.get("seg") || "all", sort: store.get("sort") || "revenue_per_day", q: "", cat: "", pmin: null, pmax: null, page: 0, sel: null };
  const V = { seg: "tracking", sort: "recent_views_per_hour", q: "" };
  const PAGE = 50;
  const cache = { thumbs: {}, gallery: {}, galurls: {}, videos: {}, hist: {}, reviews: {} };

  async function startApp(session) {
    show("app");
    $("user-email").textContent = session.user.email;
    selectView(store.get("view") || "products");
    await load();
  }

  async function load() {
    $("refresh").disabled = true; $("refresh").textContent = "Frissítés…";
    try {
      state = await rpc("tr_load");
      state.shop = state.shop || []; state.videos = state.videos || []; state.storeById = null; state.history = state.history || {};
      state.runs = state.runs || []; state.settings = state.settings || {};
      brandCache = new WeakMap();
      banner(null);
      renderAll();
    } catch (e) {
      if (e && e.code === "42501") { $("noaccess-text").textContent = `A(z) ${$("user-email").textContent} fióknak még nincs hozzáférése az adatokhoz. Szólj, és felveszem a jogosultak közé.`; show("noaccess"); return; }
      banner(errText(e), true, { label: "Újra", fn: load });
    } finally {
      $("refresh").disabled = false; $("refresh").textContent = "Frissítés";
    }
  }
  $("refresh").addEventListener("click", load);

  function renderAll() {
    renderStatus(); renderKpis(); renderSeg(); renderCats(); renderTypes(); renderTable();
    renderVideos(); renderRuns(); if (!dirty) renderSettings();
  }

  // ---------- navigation ----------
  function selectView(v) {
    if (!["products", "women", "mine", "videos", "runs", "settings"].includes(v)) v = "products";
    const focus = v === "women" ? "women" : null;
    if (focus !== P.focus) { P.focus = focus; P.page = 0; P.cat = ""; P.found = null; P.q = ""; $("q").value = ""; if (state.shop.length) { renderKpis(); renderSeg(); renderCats(); renderTypes(); renderTable(); } }
    $("products-title").textContent = focus ? "Női ruha" : "Termékek";
    $("products-sub").textContent = focus ? `Női ruházat a TikTok Shopról, $${fsetting("fashion_min_price")}–${fsetting("fashion_max_price")} között, ismert márkák nélkül. Naponta bővül.` : "TikTok Shop termékek a beállított ársávban, napi eladás és bevétel szerint.";
    for (const b of document.querySelectorAll(".nav-item")) {
      if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    for (const s of ["products", "mine", "videos", "runs", "settings"]) $("view-" + s).hidden = s !== (v === "women" ? "products" : v);
    store.set("view", v);
    if (v === "mine") loadMine();
  }
  for (const b of document.querySelectorAll(".nav-item")) b.addEventListener("click", () => selectView(b.dataset.view));

  function renderStatus() {
    const jobs = [["shop", "Termékkeresés"], ["shop_track", "Eladásmérés"], ["videos", "Termékvideók"], ["collect", "Videógyűjtés"], ["track", "Videómérés"]];
    $("side-status").replaceChildren(...jobs.map(([job, label]) => {
      const r = state.runs.find(x => x.job === job);
      let dot = "dot", txt = "még nem futott";
      if (r) {
        if (!r.finished_at) { dot = "dot run"; txt = "fut"; }
        else if (r.ok) { dot = "dot ok"; txt = ago(r.finished_at); }
        else { dot = "dot err"; txt = "hiba, " + ago(r.finished_at); }
      }
      return el("div", { title: r && r.error ? r.error : null }, el("span", { class: dot }), el("b", {}, label), txt);
    }));
  }

  // ---------- products: rules ----------
  const SEGMENTS = [["all", "Ársávban"], ["hot", "Aktuális nyerő"], ["win", "Nyerő"], ["rising", "Felfutó"], ["accel", "Gyorsul"], ["multi", "Több boltnál"], ["starred", "Csillagos"], ["new", "Új"], ["brand", "Márkás"], ["hidden", "Elrejtett"]];
  const TIPS = {
    hot: () => `Most futó termékek: nő az eladásuk, és van legfeljebb ${setting("hot_video_days")} napos videójuk`,
    win: () => `Legalább $${nf(setting("shop_min_revenue_day"))} bevétel naponta`,
    rising: () => "Naponta legalább 5%-kal nő az eddigi eladásaihoz képest",
    accel: () => "Ma legalább 1,2-szer annyit adnak el, mint előző nap",
    multi: () => "Ugyanezt a terméket más eladó is árulja: közös gyárból jöhet, valószínűleg beszerezhető",
    brand: () => "Ismert márkák saját termékei, ezek nem dropshippelhetők. A többi listából kimaradnak.",
    new: () => "Az elmúlt 30 órában felfedezett termékek",
  };
  const DEFAULTS = { fashion_min_price: 20, fashion_max_price: 70, fashion_fetches_per_category: 10, hot_video_days: 60, shop_min_price: 30, shop_max_price: 70, shop_min_revenue_day: 1000, shop_fetches_per_category: 3, shop_track_min_sold: 100, retire_below_per_day: 3 };
  const setting = (k) => { const v = state.settings[k]; return v != null ? Number(v) : DEFAULTS[k]; };
  const DEFAULT_BRANDS = ["VEVOR","Merach","Anker","Soundcore","eufy","Ninja","Shark","SharkNinja","Dyson","Bissell","Hoover","iRobot","Roborock","Tineco","Keurig","Cuisinart","KitchenAid","Hamilton Beach","Instant Pot","Instant","COSORI","Chefman","BLACK+DECKER","DEWALT","Milwaukee","Makita","Ryobi","Bosch","Philips","Braun","Oral-B","Waterpik","Conair","Revlon","Remington","Wahl","Andis","BaBylissPRO","Laifen","Panasonic","Samsung","Apple","JBL","Sony","Bose","Beats","Logitech","Garmin","Fitbit","Coleman","YETI","Stanley","Hydro Flask","Owala","Lodge","OXO","Rubbermaid","Sunbeam","Igloo","Theragun","Therabody","Hyperice","RENPHO","Bowflex","Gorilla Grip","Amazon Basics","LEGO","Hasbro","Mattel","Nerf","Fisher-Price","Crayola","Furbo","PetSafe","Cricut","BlendJet","Medicube","Govee","TP-Link","Ring","Blink","Wyze","Ecovacs","Dreame","Xiaomi","Ugreen","Baseus","Belkin","OtterBox","Spigen","Casetify","Shokz","Soundpeats","Sterilite","Mueller","Gourmia","Bella","Dash","Bear","AquaSonic","Snow","Crest","Sol de Janeiro","CeraVe","Olaplex","T3","GHD"];
  const BRAND_AMBIGUOUS = new Set(["Dash", "Bear", "Snow", "Instant", "Ring", "Bella", "PINK", "Alo", "Express", "Garage", "Target", "Coach", "Guess"]);
  let brandCache = new WeakMap();
  const brandList = () => Array.isArray(state.settings.known_brands) && state.settings.known_brands.length ? state.settings.known_brands : DEFAULT_BRANDS;
  const normShop = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function brandOf(p) {
    if (brandCache.has(p)) return brandCache.get(p);
    let hit = null;
    const title = String(p.title || "").replace(/^(\s|【[^】]*】|\[[^\]]*\]|\([^)]*\))+/, ""), shop = normShop(p.shop_name);
    for (const b of brandList()) {
      const nb = normShop(b);
      if (!nb) continue;
      const shopHit = !!shop && [nb, nb + "official", nb + "officialstore", nb + "store", nb + "us", nb + "usa", nb + "direct", nb + "shop"].includes(shop);
      const titleHit = !BRAND_AMBIGUOUS.has(b) && new RegExp("^" + reEsc(b) + "(?![a-z0-9])", "i").test(title);
      if (shopHit || titleHit) { hit = b; break; }
    }
    brandCache.set(p, hit);
    return hit;
  }
  const fsetting = (k) => setting(k);
  const isWomen = (p) => p.focus === "women";
  const bandOf = (women) => women ? [setting("fashion_min_price"), setting("fashion_max_price")] : [setting("shop_min_price"), setting("shop_max_price")];
  const priceMin = (p) => P.pmin != null ? P.pmin : bandOf(p ? isWomen(p) : !!P.focus)[0];
  const priceMax = (p) => P.pmax != null ? P.pmax : bandOf(p ? isWomen(p) : !!P.focus)[1];
  const inBand = (p) => p.price != null && Number(p.price) >= priceMin(p) && Number(p.price) <= priceMax(p);
  const inView = (p) => !P.focus || p.focus === P.focus;
  const isWin = (p) => Number(p.revenue_per_day) >= setting("shop_min_revenue_day");
  const isGrowing = (p) => Number(p.sold_per_day) > 0 && (Number(p.trend) >= 1 || Number(p.sold_per_day_recent) >= Number(p.sold_per_day) || Number(p.growth_pct) >= 2);
  const isHot = (p) => Number(p.fresh_videos) > 0 && isGrowing(p);
  const isNew = (p) => p.first_seen && Date.now() - new Date(p.first_seen).getTime() < 30 * 36e5;
  function segFilter(seg) {
    return (p) => {
      if (!inView(p)) return false;
      if (seg === "hidden") return p.hidden;
      if (p.hidden) return false;
      if (seg === "starred") return p.starred;
      if (seg === "brand") return !!brandOf(p) && inBand(p);
      if (brandOf(p)) return false;
      if (!inBand(p) && !p.starred) return false;
      if (seg === "win") return isWin(p);
      if (seg === "hot") return isHot(p);
      if (seg === "rising") return Number(p.growth_pct) >= 5;
      if (seg === "accel") return Number(p.trend) > 1.2 && Number(p.sold_per_day) >= 10;
      if (seg === "multi") return Number(p.other_shops) > 0;
      if (seg === "new") return isNew(p);
      return true;
    };
  }
  function rows() {
    if (P.found) return P.found.slice();
    const q = P.q.trim().toLowerCase();
    let list = state.shop.filter(segFilter(P.seg));
    if (P.cat) list = list.filter(p => P.cat.startsWith("t:") ? wtype(p)[0] === P.cat.slice(2) : p.category_id === P.cat);
    if (q) list = list.filter(p => [p.title, p.shop_name, p.category_name].some(s => (s || "").toLowerCase().includes(q)));
    const key = (p) => P.sort === "first_seen" ? new Date(p.first_seen).getTime() : Number(p[P.sort] ?? NaN);
    return list.sort((a, b) => {
      const x = key(a), y = key(b);
      return ((isNaN(y) ? -Infinity : y) - (isNaN(x) ? -Infinity : x)) || (Number(b.sold_now) || 0) - (Number(a.sold_now) || 0);
    });
  }

  // ---------- products: render ----------
  function renderKpis() {
    const live = state.shop.filter(p => inView(p) && !p.hidden && inBand(p) && !brandOf(p));
    const measured = live.filter(p => p.sold_per_day != null);
    const best = live.reduce((m, p) => Number(p.revenue_per_day) > (m ? Number(m.revenue_per_day) : -1) ? p : m, null);
    const totalRev = measured.reduce((s, p) => s + (Number(p.revenue_per_day) || 0), 0);
    const cards = [
      ["", P.focus ? "Női ruha a sávban" : "Termék a sávban", nf(live.length), `$${priceMin()}–${priceMax()}, márkák nélkül`],
      ["money", "Nyerő termék", nf(live.filter(isWin).length), `legalább $${nf(setting("shop_min_revenue_day"))}/nap`],
      ["money", "Legjobb napi bevétel", best && best.revenue_per_day != null ? money(best.revenue_per_day) : "–", best ? String(best.title || "").slice(0, 38) : "még nincs mérés"],
      ["heat", "Aktuális nyerő", nf(live.filter(isHot).length), `nő az eladás + max. ${setting("hot_video_days")} napos videó`],
    ];
    $("kpis").replaceChildren(...cards.map(([c, l, v, s]) => el("div", { class: "kpi " + c }, el("span", {}, l), el("b", {}, v), el("small", {}, s))));
  }
  function renderSeg() {
    $("seg").replaceChildren(...SEGMENTS.map(([k, label]) => el("button", {
      type: "button", class: "tab", role: "tab", "aria-selected": String(P.seg === k), title: TIPS[k] ? TIPS[k]() : null,
      onclick: () => { P.seg = k; P.page = 0; store.set("seg", k); renderSeg(); renderTable(); },
    }, label, el("em", {}, nf(state.shop.filter(segFilter(k)).length)))));
  }
  // ---------- women's clothing types (from the product title, first matching rule wins) ----------
  const DRESS = /\b(dress|dresses|sundress|gown)\b/i;
  const WTYPES = [
    ["tights", "Harisnya", /\b(tights|pantyhose|stockings?)\b/i],
    ["shape", "Alakformáló", /\b(shapewear|faja|fajas|waist trainers?|waist cincher|body shaper|shaper|butt lifter|girdle)\b/i],
    ["work", "Munkaruha", /\b(scrubs?|medical uniform|nursing scrub)\b/i],
    ["bra", "Melltartó", /\b(bras?|bralettes?|brassieres?|nipple covers?|pasties)\b/i],
    ["sleep", "Pizsama, otthoni", /\b(pajamas?|pyjamas?|pjs?|sleepwear|nightgown|nightdress|nightwear|robe|bathrobe|loungewear|lounge set)\b/i],
    ["under", "Fehérnemű", /\b(panties|panty|underwear|briefs?|thongs?|lingerie|boyshorts?|hipster|knickers)\b/i],
    ["set", "Szett, kétrészes", /\b(2[- ]?piece|two[- ]pieces?|3[- ]?piece|co-?ord|matching sets?|sets?)\b/i],
    ["jump", "Overál, jumpsuit", /\b(jumpsuits?|rompers?|overalls?|onesie|playsuit)\b/i],
    ["party", "Party, alkalmi ruha", (t) => DRESS.test(t) && /\b(party|club|cocktail|evening|formal|sequins?|prom|wedding|bridesmaid|homecoming|gala|night out|birthday)\b/i.test(t)],
    ["dress", "Hétköznapi ruha", DRESS],
    ["skirt", "Szoknya", /\b(skirts?|skorts?)\b/i],
    ["shorts", "Rövidnadrág", /\bshorts\b/i],
    ["leggings", "Leggings", /\bleggings?\b/i],
    ["coat", "Kabát, dzseki", /\b(jackets?|coats?|blazers?|puffer|parka|(?:puffer|fleece|sherpa|quilted|down) vest|gilet|outerwear|shacket)\b/i],
    ["knit", "Pulóver, kardigán", /\b(sweaters?|cardigans?|jumper|hoodies?|sweatshirts?|pullover|knitwear)\b/i],
    ["jeans", "Farmer nadrág", /\b(jeans?|denim)\b/i],
    ["pants", "Nadrág", /\b(pants|trousers|joggers|sweatpants|culottes|palazzo|wide[- ]leg)\b/i],
    ["sleeveless", "Ujjatlan felső", /\b(tanks?|cami|camis|camisole|sleeveless|halter|tube top|strapless top|corset top|bustier)\b/i],
    ["long", "Hosszú ujjú felső", /\blong[- ]?sleeves?/i],
    ["short", "Rövid ujjú felső, póló", /\b(t-?shirts?|tees?|short[- ]?sleeves?)/i],
    ["top", "Egyéb felső", /\b(tops?|blouses?|shirts?|bodysuits?|crop)\b/i],
  ];
  const wtypeCache = new Map();
  function wtype(p) {
    if (wtypeCache.has(p.product_id)) return wtypeCache.get(p.product_id);
    // the title decides; TikTok's own category only when the title says nothing
    let hit = ["other", "Egyéb"];
    for (const t of [(p.title || "").replace(/【[^】]*】/g, " "), p.category_name || ""]) {
      const m = WTYPES.find(([, , re]) => typeof re === "function" ? re(t) : re.test(t));
      if (m) { hit = [m[0], m[1]]; break; }
    }
    wtypeCache.set(p.product_id, hit);
    return hit;
  }
  function renderTypes() {
    const box = $("wtypes");
    if (!P.focus) { box.hidden = true; return; }
    const agg = new Map();
    for (const p of state.shop.filter(segFilter("all"))) {
      const [k, label] = wtype(p);
      const a = agg.get(k) || { label, n: 0, rev: 0 };
      a.n++; a.rev += Number(p.revenue_per_day) || 0;
      agg.set(k, a);
    }
    const list = [...agg.entries()].sort((x, y) => y[1].rev - x[1].rev);
    box.hidden = false;
    box.replaceChildren(el("span", { class: "wt-h" }, "Típusok napi bevétel szerint:"),
      ...list.map(([k, a]) => el("button", { type: "button", class: "wt" + (P.cat === "t:" + k ? " on" : ""), "aria-pressed": String(P.cat === "t:" + k),
        onclick: () => { P.cat = P.cat === "t:" + k ? "" : "t:" + k; P.page = 0; renderCats(); renderTypes(); renderTable(); } },
        a.label, el("b", {}, money(a.rev)), el("em", {}, nf(a.n) + " db"))));
  }
  function renderCats() {
    const counts = new Map();
    for (const p of state.shop) if (inView(p) && !p.hidden && p.category_id) counts.set(p.category_id, { name: p.category_name || p.category_id, n: (counts.get(p.category_id)?.n || 0) + 1 });
    const opts = [...counts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "hu"));
    if (P.focus) {
      const tc = new Map();
      for (const p of state.shop) if (inView(p) && !p.hidden) { const [k] = wtype(p); tc.set(k, (tc.get(k) || 0) + 1); }
      $("cat").replaceChildren(el("option", { value: "" }, "Minden típus"),
        ...[...WTYPES.map(([k, l]) => [k, l]), ["other", "Egyéb"]].filter(([k]) => tc.get(k)).map(([k, l]) => el("option", { value: "t:" + k }, `${l} (${tc.get(k)})`)));
    } else
    $("cat").replaceChildren(el("option", { value: "" }, "Minden kategória"), ...opts.map(([id, c]) => el("option", { value: id }, `${c.name} (${c.n})`)));
    $("cat").value = P.cat;
    $("pmin").placeholder = "Ár min " + priceMin(); $("pmax").placeholder = "max " + priceMax();
    $("sort").value = P.sort;
  }
  function img(p, size) {
    const box = el("div", { class: "pimg" });
    const fallback = () => {
      if (cache.thumbs[p.product_id]) box.replaceChildren(el("img", { src: "data:image/webp;base64," + cache.thumbs[p.product_id], alt: "" }));
      else { box.replaceChildren("▢"); queueThumb(p.product_id, box); }
    };
    if (p.image) {
      const i = el("img", { src: sized(p.image, size || 160), alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
      i.addEventListener("error", fallback, { once: true });
      box.append(i);
    } else fallback();
    return box;
  }
  let thumbQueue = new Map(), thumbTimer = null;
  function queueThumb(id, box) {
    thumbQueue.set(id, (thumbQueue.get(id) || []).concat(box));
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(async () => {
      const q = thumbQueue; thumbQueue = new Map();
      try {
        const rowsT = await rpc("tr_thumbs", { p_ids: [...q.keys()] });
        for (const r of rowsT || []) {
          cache.thumbs[r.product_id] = r.thumb;
          for (const b of q.get(r.product_id) || []) b.replaceChildren(el("img", { src: "data:image/webp;base64," + r.thumb, alt: "" }));
        }
      } catch (_) {}
    }, 150);
  }
  const growthChip = (p) => {
    if (p.trend == null) return null;
    const t = Number(p.trend);
    if (t > 1.2) return el("span", { class: "chip heat" }, "gyorsul ×" + dec(t));
    if (t < 0.8) return el("span", { class: "chip" }, "lassul ×" + dec(t));
    return null;
  };
  function starBtn(p, onToggle) {
    return el("button", { type: "button", class: "star", "aria-pressed": String(!!p.starred), "aria-label": p.starred ? "Csillag levétele" : "Csillagozás",
      onclick: (e) => { e.stopPropagation(); onToggle(p); } }, p.starred ? "★" : "☆");
  }
  function renderTable() {
    for (const th of document.querySelectorAll("#ptable th.sortable")) th.toggleAttribute("aria-sort", th.dataset.sort === P.sort);
    const list = rows();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    P.page = Math.min(P.page, pages - 1);
    const slice = list.slice(P.page * PAGE, P.page * PAGE + PAGE);
    if (!slice.length) {
      const msg = state.shop.length ? ["Nincs találat", "Próbálj más szűrőt, kategóriát vagy keresőszót."] : ["Még nincs termék", "A reggeli termékkeresés után itt lesznek a TikTok Shop termékek."];
      $("prows").replaceChildren(el("tr", {}, el("td", { colspan: 9, class: "empty" }, el("b", {}, msg[0]), msg[1])));
    } else {
      $("prows").replaceChildren(...slice.map((p, i) => productRow(p, P.page * PAGE + i + 1)));
    }
    $("pager").replaceChildren(
      el("span", {}, list.length ? `${nf(P.page * PAGE + 1)}–${nf(Math.min(list.length, (P.page + 1) * PAGE))} / ${nf(list.length)} termék` : ""),
      el("div", { class: "pg" },
        el("button", { type: "button", class: "btn", disabled: P.page === 0 || null, onclick: () => { P.page--; renderTable(); window.scrollTo({ top: 0 }); } }, "‹ Előző"),
        el("button", { type: "button", class: "btn", disabled: P.page >= pages - 1 || null, onclick: () => { P.page++; renderTable(); window.scrollTo({ top: 0 }); } }, "Következő ›")));
  }
  function productRow(p, rank) {
    const meta = [];
    if (brandOf(p)) meta.push(el("span", { class: "chip" }, "Márkás"));
    if (Number(p.other_shops) > 0) meta.push(el("span", { class: "chip money", title: (p.twin_shops || []).join(", ") }, `${Number(p.other_shops) + 1} boltnál`));
    if (isHot(p)) meta.push(el("span", { class: "chip heat" }, "Aktuális"));
    if (isWin(p)) meta.push(el("span", { class: "chip money" }, "Nyerő"));
    if (isNew(p)) meta.push(el("span", { class: "chip blue" }, "Új"));
    meta.push(el("span", {}, [isWomen(p) ? wtype(p)[1] : p.category_name, p.shop_name].filter(Boolean).join(" · ")));
    const orig = p.price_original && Number(p.price_original) > Number(p.price) ? Number(p.price_original) : null;
    return el("tr", { class: P.sel === p.product_id ? "sel" : null, onclick: () => openProduct(p.product_id) },
      el("td", { class: "c-star" }, starBtn(p, toggleProductStar)),
      el("td", { class: "c-prod" }, el("div", { class: "prod" }, img(p, 160),
        el("div", { style: "min-width:0" }, el("div", { class: "ptitle" }, p.title || "Névtelen termék"), el("div", { class: "pmeta" }, ...meta)))),
      el("td", { class: "r" }, el("div", { class: "big" }, usd(p.price)), orig ? el("div", { class: "small" }, el("s", {}, usd(orig))) : null),
      el("td", { class: "r" }, p.sold_per_day != null ? el("div", { class: "big" }, "+" + nf(p.sold_per_day)) : el("span", { class: "na" }, "mérés folyik"),
        p.sold_per_day_recent != null ? el("div", { class: "small" }, "most " + short(p.sold_per_day_recent) + "/nap") : null),
      el("td", { class: "r" }, p.revenue_per_day != null ? el("div", { class: "big money" }, money(p.revenue_per_day)) : el("span", { class: "na" }, "–"),
        p.revenue_per_day != null ? el("div", { class: "small" }, "≈ " + money(Number(p.revenue_per_day) * 30) + "/hó") : null),
      el("td", { class: "r" }, p.growth_pct != null ? el("div", { class: "big" + (Number(p.growth_pct) >= 5 ? " pos" : "") }, "+" + pct(p.growth_pct)) : el("span", { class: "na" }, "–"), growthChip(p)),
      el("td", { class: "r" }, el("div", { class: "big" }, short(p.sold_now)), el("div", { class: "small" }, "db")),
      el("td", { class: "r" }, p.video_count || p.fresh_videos ? [el("div", { class: "big" }, short(p.video_views)),
        Number(p.fresh_videos) > 0 ? el("div", { class: "small", style: "color:var(--heat);font-weight:600" }, `${nf(p.fresh_videos)} friss videó`) : el("div", { class: "small" }, `${nf(p.video_count)} videó, ${p.newest_video ? "legújabb " + ago(p.newest_video) : ""}`)] : el("span", { class: "na" }, "–")),
      el("td", { class: "r" }, p.rating ? [el("div", { class: "big" }, "★ " + dec(p.rating)), el("div", { class: "small" }, short(p.reviews) + " vél.")] : el("span", { class: "na" }, "–")));
  }

  // toolbar events
  // Typing 3+ characters searches every stored product on the server, whatever the price band or tab.
  let searchTimer = null, searchSeq = 0;
  $("q").addEventListener("input", () => {
    P.q = $("q").value; P.page = 0;
    clearTimeout(searchTimer);
    const q = P.q.trim();
    if (q.length < 3) { P.found = null; renderSearchNote(); renderTable(); return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const res = await rpc("tr_search", { p_q: q }) || [];
        if (seq !== searchSeq) return;
        const byId = new Map(state.shop.map(p => [p.product_id, p]));
        P.found = res.map(r => { const have = byId.get(r.product_id); if (have) return have; state.shop.push(r); return r; });
        brandCache = new WeakMap();
      } catch (e) { banner(errText(e), true); P.found = null; }
      renderSearchNote(); renderTable();
    }, 300);
  });
  function renderSearchNote() {
    const n = $("products-sub");
    if (P.found) n.textContent = `Keresés az összes termékben („${P.q.trim()}”): ${nf(P.found.length)} találat, ársávtól és szűrőktől függetlenül.`;
    else selectView(store.get("view") || "products", true);
  }
  $("cat").addEventListener("change", () => { P.cat = $("cat").value; P.page = 0; renderTypes(); renderTable(); });
  $("sort").addEventListener("change", () => { P.sort = $("sort").value; store.set("sort", P.sort); renderTable(); });
  for (const id of ["pmin", "pmax"]) $(id).addEventListener("change", () => {
    const v = $(id).value.trim();
    P[id] = v === "" ? null : Number(v);
    P.page = 0; renderKpis(); renderSeg(); renderTable();
  });
  for (const th of document.querySelectorAll("#ptable th.sortable")) th.addEventListener("click", () => { P.sort = th.dataset.sort; $("sort").value = P.sort; store.set("sort", P.sort); renderTable(); });

  async function toggleProductStar(p) {
    const next = !p.starred; p.starred = next; renderSeg(); renderTable(); if (P.sel === p.product_id) renderDrawer();
    try { await rpc("tr_set_product", { p_product_id: p.product_id, p_starred: next }); }
    catch (e) { p.starred = !next; banner("Nem sikerült menteni a csillagot. " + errText(e), true); renderSeg(); renderTable(); }
  }
  async function setProductHidden(p, hide) {
    const prev = { hidden: p.hidden, starred: p.starred };
    p.hidden = hide; if (hide) p.starred = false;
    if (hide) closeDrawer();
    renderKpis(); renderSeg(); renderTable();
    try {
      await rpc("tr_set_product", { p_product_id: p.product_id, p_hidden: hide });
      banner((hide ? "Elrejtve: " : "Visszaállítva: ") + String(p.title || "").slice(0, 60), false, hide ? { label: "Visszavonás", fn: () => setProductHidden(p, false) } : null);
    } catch (e) { Object.assign(p, prev); banner("Nem sikerült menteni. " + errText(e), true); renderSeg(); renderTable(); }
  }

  // ---------- product drawer ----------
  let galIdx = 0;
  function openProduct(id) { P.sel = id; galIdx = 0; $("drawer").hidden = false; $("scrim").hidden = false; document.body.style.overflow = "hidden"; renderDrawer(); renderTable(); $("drawer").scrollTop = 0; }
  function closeDrawer() { if (typeof MY !== "undefined") MY.edit = null; P.sel = null; $("drawer").hidden = true; $("scrim").hidden = true; document.body.style.overflow = ""; renderTable(); }
  $("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (LB.open) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === "ArrowLeft") stepLightbox(-1);
      return;
    }
    if ($("drawer").hidden) return;
    if (e.key === "Escape") closeDrawer();
    if (e.key === "ArrowRight") stepGallery(1);
    if (e.key === "ArrowLeft") stepGallery(-1);
  });
  const current = () => state.shop.find(x => x.product_id === P.sel);

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
    const brand = brandOf(p);
    d.replaceChildren(
      el("div", { class: "d-top" }, el("span", { class: "crumbs" }, [p.category_name, p.shop_name].filter(Boolean).join(" · ")),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Bezárás", onclick: closeDrawer }, "×")),
      el("div", { class: "d-hero" }, galleryEl(p),
        el("div", { class: "d-info" },
          el("h2", {}, p.title || "Névtelen termék"),
          el("div", { class: "d-price" }, usd(p.price), orig ? el("s", {}, usd(orig)) : null),
          el("div", { class: "pmeta" }, p.rating ? el("span", {}, `★ ${dec(p.rating)} · ${nf(p.reviews)} vélemény`) : null,
            brand ? el("span", { class: "chip" }, "Márkás: " + brand) : null,
            Number(p.other_shops) > 0 ? el("span", { class: "chip money" }, `${Number(p.other_shops) + 1} boltnál`) : null),
          el("div", { class: "d-actions" },
            el("button", { type: "button", class: "btn" + (p.starred ? " on" : ""), onclick: () => toggleProductStar(p) }, p.starred ? "★ Csillagozva" : "☆ Csillagozás"),
            p.hidden ? el("button", { type: "button", class: "btn", onclick: () => setProductHidden(p, false) }, "Visszaállítás")
                     : el("button", { type: "button", class: "btn danger", onclick: () => setProductHidden(p, true) }, "Elrejtés"),
            p.url ? chromeLink(p.url, { class: "btn" }, "TikTok Shop ↗") : null,
            el("button", { type: "button", class: "btn", title: "Felveszi a Saját termékek közé, ott adhatod hozzá a beszállítói linket, képeket és árakat", onclick: () => addToMine(p) }, "+ Saját termékeim közé"),
            p.image ? el("a", { class: "btn", href: "https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(p.image), target: "_blank", rel: "noopener", title: "Képkeresés: kik árulják még, például AliExpressen" }, "Hol árulják még? ↗") : null),
          storeNote(p),
          brand ? el("div", { class: "d-note" }, `Ismert márka (${brand}): saját tervezésű és gyártású termék, nem dropshippelhető.`) : null,
          Number(p.other_shops) > 0 ? el("div", { class: "d-note" }, `Más eladók is árulják: ${(p.twin_shops || []).join(", ")}. Valószínűleg közös gyárból jön.`) : null)),
      el("div", { class: "d-sec" },
        el("h3", {}, "Eladás", el("span", {}, p.sold_checked_at ? "mérve " + ago(p.sold_checked_at) : "")),
        el("div", { class: "stats" },
          stat(p.revenue_per_day != null ? money(p.revenue_per_day) : "–", "napi bevétel", isWin(p) ? "money" : ""),
          stat(p.sold_per_day != null ? "+" + nf(p.sold_per_day) : "–", "eladás naponta"),
          stat(p.sold_per_day_recent != null ? "+" + nf(p.sold_per_day_recent) : "–", "mostani tempó (6 óra)", p.sold_per_day_recent != null && Number(p.sold_per_day_recent) > Number(p.sold_per_day) * 1.2 ? "heat" : ""),
          stat(p.revenue_per_day != null ? money(Number(p.revenue_per_day) * 30) : "–", "becsült havi bevétel"),
          stat(short(p.sold_now), "eladva összesen"),
          stat(p.growth_pct != null ? "+" + pct(p.growth_pct) : "–", "növekedés naponta", Number(p.growth_pct) >= 5 ? "heat" : ""),
          stat(p.trend != null ? "×" + dec(p.trend) : "–", "tempó az előző naphoz", Number(p.trend) > 1.2 ? "heat" : ""),
          stat(p.sold_per_day_week != null ? "+" + nf(p.sold_per_day_week) : "–", "napi átlag a héten")),
        salesChart(cache.hist[id]),
        el("div", { class: "d-note" }, "A bevétel a mostani ár és a napi eladott darab szorzata, a TikTok Shop eladásszámából. A növekedés: a napi eladás az addig eladott darabok hány százaléka.")),
      videosSection(p),
      reviewsSection(p));
  }
  function storeNote(p) {
    const st = p.seller_id && (state.storeById || (state.storeById = Object.fromEntries((state.stores || []).map(x => [x.seller_id, x]))))[p.seller_id];
    if (!st) return null;
    const parts = [`${short(st.sold_count)} eladás összesen`];
    if (st.sold_per_day != null) parts.push(`napi kb. ${nf(st.sold_per_day)} db`);
    if (st.tracked_per_day != null) parts.push(`ebből a követett termékei: ${nf(st.tracked_per_day)}/nap`);
    if (st.added_total) parts.push(`${nf(st.added_total)} terméke került be a boltból`);
    return el("div", { class: "d-note" }, "Bolt: ", st.url ? el("a", { href: st.url, target: "_blank", rel: "noopener" }, (st.shop_name || "megnyitás") + " ↗") : (st.shop_name || ""), " · " + parts.join(" · "));
  }
  // ---------- image viewer (click a picture to see it big) ----------
  const big = (url) => url ? url.replace(/~tplv-([a-z0-9]+)-[a-z-]+(?::\d+:\d+)?\.(webp|jpeg|jpg|png|image)/, "~tplv-$1-resize-webp:1200:1200.webp") : null;
  const LB = { open: false, list: [], i: 0, node: null };
  function openLightbox(list, i) {
    LB.list = list.filter(Boolean); LB.i = Math.min(Math.max(0, i || 0), LB.list.length - 1); LB.open = true;
    if (!LB.list.length) return;
    if (!LB.node) {
      LB.node = el("div", { class: "lb", role: "dialog", "aria-modal": "true", "aria-label": "Kép nagyban", onclick: (e) => { if (e.target === LB.node || e.target.classList.contains("lb-stage")) closeLightbox(); } });
      document.body.append(LB.node);
    }
    renderLightbox();
  }
  function renderLightbox() {
    const item = LB.list[LB.i];
    const img = el("img", { src: item.src, alt: "Kép nagyban" });
    if (item.fallback) img.addEventListener("error", () => { if (img.src !== item.fallback) img.src = item.fallback; }, { once: true });
    const many = LB.list.length > 1;
    LB.node.replaceChildren(
      el("div", { class: "lb-stage" }, img),
      el("button", { type: "button", class: "lb-close", "aria-label": "Bezárás", onclick: closeLightbox }, "×"),
      many ? el("button", { type: "button", class: "lb-nav prev", "aria-label": "Előző kép", onclick: () => stepLightbox(-1) }, "‹") : null,
      many ? el("button", { type: "button", class: "lb-nav next", "aria-label": "Következő kép", onclick: () => stepLightbox(1) }, "›") : null,
      many ? el("span", { class: "lb-count" }, `${LB.i + 1} / ${LB.list.length}`) : null);
    LB.node.hidden = false;
    LB.node.querySelector(".lb-close").focus();
  }
  function stepLightbox(d) { if (LB.list.length < 2) return; LB.i = (LB.i + d + LB.list.length) % LB.list.length; renderLightbox(); }
  function closeLightbox() { LB.open = false; if (LB.node) LB.node.hidden = true; }
  // full-size sources for the product gallery: the original link when we have it, else the stored copy
  function gallerySources(p, shown) {
    const urls = cache.galurls[p.product_id];
    return shown.map((small, i) => {
      const orig = Array.isArray(urls) && urls[i] ? urls[i] : (i === 0 && p.image ? p.image : null);
      return { src: orig ? big(orig) : small, fallback: small };
    });
  }
  function galleryEl(p) {
    const imgs = cache.gallery[p.product_id];
    const list = Array.isArray(imgs) && imgs.length ? imgs.map(b => "data:image/webp;base64," + b) : (p.image ? [sized(p.image, 600)] : []);
    if (galIdx >= list.length) galIdx = 0;
    const main = el("div", { class: "gal-main" });
    if (list.length) main.append(el("img", { src: list[galIdx], alt: p.title || "", referrerpolicy: "no-referrer", class: "zoomable", title: "Kattints a nagyításhoz",
      onclick: () => openLightbox(gallerySources(p, list), galIdx) }));
    else main.append("Nincs kép");
    if (list.length > 1) main.append(
      el("button", { type: "button", class: "gal-nav prev", "aria-label": "Előző kép", onclick: () => stepGallery(-1) }, "‹"),
      el("button", { type: "button", class: "gal-nav next", "aria-label": "Következő kép", onclick: () => stepGallery(1) }, "›"),
      el("span", { class: "gal-count" }, `${galIdx + 1} / ${list.length}`));
    const strip = list.length > 1 ? el("div", { class: "gal-strip" }, ...list.map((src, i) => el("button", { type: "button", "aria-current": String(i === galIdx), "aria-label": `${i + 1}. kép`, onclick: () => { galIdx = i; renderDrawer(); } }, el("img", { src, alt: "" })))) : null;
    return el("div", { class: "gal" }, main, strip);
  }
  function stepGallery(d) {
    const p = current(); if (!p) return;
    const imgs = cache.gallery[p.product_id];
    const n = Array.isArray(imgs) && imgs.length ? imgs.length : 1;
    if (n < 2) return;
    galIdx = (galIdx + d + n) % n; renderDrawer();
  }
  // Covers we did not store: TikTok's oEmbed endpoint (CORS-enabled) returns a fresh cover URL per video.
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
    if (v.cover) box.prepend(el("img", { src: "data:image/jpeg;base64," + v.cover, alt: "" }));
    else coverFor(v, box);
    return box;
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
  // coming back from the TikTok tab: show the freshly saved reviews
  window.addEventListener("focus", () => {
    const id = P.sel;
    if (id && cache.reviews[id] !== undefined && cache.reviews[id] !== null) { delete cache.reviews[id]; renderDrawer(); }
  });
  const REVIEW_TOPICS = [
    ["size", "Méret, szabás", /\b(size|sizes|sizing|small|smaller|big|bigger|large|tight|loose|fit|fits|fitting|runs?|length|long|short|waist|petite|tall|roll(s|ing)? (down|up)|slid|falls? down|talla|grande|chic[oa])\b|\bx+l\b/i],
    ["quality", "Anyag, minőség", /\b(quality|material|fabric|thin|thick|cheap|rip|ripped|tear|tore|torn|hole|holes|snag|pill|pilling|seam|stitch|broke|broken|damaged|stain|smell|itch|itchy|see.?through|sheer|transparent|squeak|squeaky|warm|cold|soft|lint|fuzz|run in|static)\b/i],
    ["look", "Szín, kinézet", /\b(colou?r|shade|dark|darker|light|lighter|tone|looks? (different|nothing)|picture|pictures|photo|advertis|not as (shown|pictured|described))\b/i],
    ["shipping", "Szállítás, csomag", /\b(ship|shipping|shipped|deliver|delivery|arriv|package|late|missing|wrong (item|size|color)|never (came|received|got)|refund|return|returned)\b/i],
    ["praise", "Dicséret", /\b(love|loved|great|perfect|comfortable|comfy|recommend|amazing|obsessed|cute|best|worth|happy)\b/i],
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
    const tick = async () => {
      if (Date.now() > until || P.sel !== id) { clearInterval(rvPoll); return; }
      try {
        const res = await rpc("tr_reviews", { pid: id });
        const prev = cache.reviews[id];
        cache.reviews[id] = res;
        const changed = !prev || (prev.reviews || []).length !== (res.reviews || []).length || (prev.request || {}).status !== (res.request || {}).status;
        if (changed) renderDrawer();
        if (res.request && res.request.status === "done" && res.request.finished_at && Date.now() - new Date(res.request.finished_at).getTime() < 5 * 60 * 1000) clearInterval(rvPoll);
      } catch (_) {}
    };
    rvPoll = setInterval(tick, 5000);
  }
  function installHelp() {
    return el("div", { class: "d-note rv-help" },
      el("b", {}, "Ehhez a Termékradar Chrome-bővítmény kell (egyszer kell telepíteni):"),
      el("ol", {},
        el("li", {}, el("a", { href: "termekradar-bovitmeny.zip", download: "" }, "Töltsd le a bővítményt"), ", és csomagold ki egy mappába."),
        el("li", {}, "Chrome-ban nyisd meg ezt a címet: ", el("code", {}, "chrome://extensions")),
        el("li", {}, "Jobb fent kapcsold be a „Fejlesztői mód” kapcsolót."),
        el("li", {}, "Kattints a „Kicsomagolt bővítmény betöltése” gombra, és válaszd ki a kicsomagolt mappát."),
        el("li", {}, "Frissítsd ezt az oldalt.")));
  }
  function reviewsSection(p) {
    const id = p.product_id;
    if (rvFor !== id) { rvFor = id; Object.assign(RV, { star: 0, topic: "", imgs: false, limit: 30 }); }
    ensure("reviews", id, () => rpc("tr_reviews", { pid: id }));
    const data = cache.reviews[id];
    const list = data && Array.isArray(data.reviews) ? data.reviews : [];
    const req = data && data.request;
    const sum = req && req.summary;
    const head = el("h3", {}, "Vásárlói vélemények", el("span", {},
      req && req.finished_at ? `${nf(list.length)} mentve · ${ago(req.finished_at)}` : req && req.status === "running" ? "mentés folyamatban…" : ""));
    const getBtn = el("button", { type: "button", class: "btn" + (list.length ? "" : " primary"), onclick: () => requestReviews(p) },
      list.length ? "Vélemények frissítése" : "Vélemények lekérése");
    const actions = el("div", { class: "d-actions" }, getBtn);
    if (!extVersion) return el("div", { class: "d-sec" }, head, list.length ? null : el("div", { class: "d-note" }, "A TikTok Shop vásárlói véleményei képekkel, csoportosítva: méret, minőség, szín, szállítás."), installHelp(), list.length ? reviewsBody(p, list, sum) : null);
    if (!data) return el("div", { class: "d-sec" }, head, el("div", { class: "d-note" }, "Betöltés…"));
    if (!list.length) return el("div", { class: "d-sec" }, head, actions,
      el("div", { class: "d-note" }, "Megnyílik a termék TikTok Shop oldala egy új fülön, és a bővítmény elmenti a véleményeket: az összes 1-3 csillagosat, a friss 4-5 csillagosakat és a képeseket. Kb. fél perc, utána itt megjelennek."));
    return el("div", { class: "d-sec" }, head, actions, reviewsBody(p, list, sum));
  }
  function reviewsBody(p, list, sum) {
    const stars = (n) => "★".repeat(n || 0) + "☆".repeat(Math.max(0, 5 - (n || 0)));
    // rating distribution from TikTok's own totals
    let dist = null;
    if (sum && sum.rating_result) {
      const tot = Object.values(sum.rating_result).reduce((a, b) => a + Number(b), 0) || 1;
      dist = el("div", { class: "rv-dist" },
        el("div", { class: "rv-score" }, el("b", {}, dec(sum.overall_score)), el("span", {}, `${nf(sum.review_count)} vélemény`)),
        el("div", { class: "rv-bars" }, ...[5, 4, 3, 2, 1].map(s => {
          const n = Number(sum.rating_result[s] || 0);
          return el("button", { type: "button", class: "rv-bar" + (RV.star === s ? " on" : ""), onclick: () => { RV.star = RV.star === s ? 0 : s; RV.limit = 30; renderDrawer(); } },
            el("span", {}, s + "★"), el("i", {}, el("u", { style: `width:${(n / tot * 100).toFixed(1)}%` })), el("em", {}, nf(n) + " · " + Math.round(n / tot * 100) + "%"));
        })));
    }
    // topics among the saved reviews; for the low ones (1-3 star) these are the complaints
    const low = list.filter(r => r.rating <= 3);
    const topicCount = (k) => (k === "praise" ? list : low).filter(r => reviewTopics(r).includes(k)).length;
    const chips = el("div", { class: "rv-chips" },
      ...REVIEW_TOPICS.map(([k, label]) => el("button", { type: "button", class: "rv-chip" + (RV.topic === k ? " on" : ""), "aria-pressed": String(RV.topic === k),
        onclick: () => { RV.topic = RV.topic === k ? "" : k; RV.limit = 30; renderDrawer(); } }, label, el("b", {}, nf(topicCount(k))))),
      el("button", { type: "button", class: "rv-chip" + (RV.imgs ? " on" : ""), "aria-pressed": String(RV.imgs), onclick: () => { RV.imgs = !RV.imgs; RV.limit = 30; renderDrawer(); } },
        "Képes", el("b", {}, nf(list.filter(r => r.images && r.images.length).length))));
    const chipNote = el("div", { class: "d-note" }, "A témák számai az 1-3 csillagos véleményekből jönnek (ott vannak a panaszok), a dicséret az összesből.");
    // which variants the unhappy buyers bought
    const bad = list.filter(r => r.rating <= 2 && r.sku);
    let variants = null;
    if (bad.length >= 5) {
      const cnt = new Map(), all = new Map();
      for (const r of bad) cnt.set(r.sku, (cnt.get(r.sku) || 0) + 1);
      for (const r of list) if (r.sku) all.set(r.sku, (all.get(r.sku) || 0) + 1);
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      variants = el("div", { class: "rv-vars" }, el("div", { class: "rv-vars-h" }, "Melyik változatot vették, akik 1-2 csillagot adtak"),
        ...top.map(([sku, n]) => el("div", { class: "rv-var" }, el("span", {}, sku), el("b", {}, `${n} panasz`), el("em", {}, `${Math.round(n / all.get(sku) * 100)}% a mentett véleményeiből`))));
    }
    // the list
    let shown = list.slice();
    if (RV.star) shown = shown.filter(r => r.rating === RV.star);
    if (RV.topic) shown = shown.filter(r => reviewTopics(r).includes(RV.topic) && (RV.topic === "praise" || RV.star || r.rating <= 3));
    if (RV.imgs) shown = shown.filter(r => r.images && r.images.length);
    const filterNote = (RV.star || RV.topic || RV.imgs) ? el("div", { class: "d-note" }, `${nf(shown.length)} vélemény a szűrőkkel. `,
      el("button", { type: "button", class: "link", onclick: () => { Object.assign(RV, { star: 0, topic: "", imgs: false, limit: 30 }); renderDrawer(); } }, "Szűrők törlése")) : null;
    const items = shown.slice(0, RV.limit).map(r => el("div", { class: "rv" },
      el("div", { class: "rv-top" }, el("span", { class: "rv-stars s" + r.rating, "aria-label": r.rating + " csillag" }, stars(r.rating)),
        r.review_time ? el("span", {}, new Date(r.review_time).toLocaleDateString("hu-HU")) : null,
        r.verified ? el("span", { class: "chip" }, "Igazolt vásárlás") : null,
        r.sku ? el("span", { class: "chip blue" }, r.sku) : null),
      r.text ? el("p", {}, r.text) : el("p", { class: "d-note" }, "(csak csillag, szöveg nélkül)"),
      r.images && r.images.length ? el("div", { class: "rv-imgs" }, ...r.images.map((b, bi) => el("a", { href: "data:image/jpeg;base64," + b, title: "Kattints a nagyításhoz", onclick: (e) => { e.preventDefault(); openLightbox(r.images.map(x => ({ src: "data:image/jpeg;base64," + x })), bi); } },
        el("img", { src: "data:image/jpeg;base64," + b, alt: "Vásárlói fotó", loading: "lazy" })))) : null));
    const more = shown.length > RV.limit ? el("button", { type: "button", class: "btn wide", onclick: () => { RV.limit += 50; renderDrawer(); } }, `Még ${nf(Math.min(50, shown.length - RV.limit))} vélemény`) : null;
    return el("div", { class: "rv-wrap" }, dist, chips, chipNote, variants, filterNote, ...items, more);
  }


  function videosSection(p) {
    const head = el("h3", {}, "Videók ehhez a termékhez", el("span", {}, (p.video_count ? `${nf(p.video_count)} videó · ${short(p.video_views)} nézés` : "") + (Number(p.fresh_videos) ? ` · ${nf(p.fresh_videos)} friss` : "")));
    if (!p.video_count && !p.fresh_videos) return el("div", { class: "d-sec" }, head, el("div", { class: "d-note" }, p.video_count === 0 ? "A TikTok Shop nem mutat videót ehhez a termékhez." : "A videókat a napi futás tölti le a 100+ eladásos és a csillagozott termékekhez."));
    const vids = cache.videos[p.product_id];
    if (!Array.isArray(vids)) return el("div", { class: "d-sec" }, head, el("div", { class: "d-note" }, vids === false ? "Nem sikerült betölteni a videókat." : "Videók betöltése…"));
    return el("div", { class: "d-sec" }, head,
      el("div", { class: "vgrid" }, ...vids.slice().sort((a, b) => (isFresh(b) - isFresh(a)) || (Number(b.play_count) - Number(a.play_count))).map(v => {
        const days = v.prev_checked_at ? Math.max((new Date(v.checked_at) - new Date(v.prev_checked_at)) / 864e5, 0.25) : null;
        const grow = days && v.prev_play_count != null ? (Number(v.play_count) - Number(v.prev_play_count)) / days : null;
        return el("a", { class: "vcard", href: "https://www.tiktok.com/@/video/" + v.item_id, target: "_blank", rel: "noopener", title: v.title || "" },
          vcover(v, el("span", { class: "views" }, "▶ " + short(v.play_count)),
            grow > 0 ? el("span", { class: "grow" }, "+" + short(grow) + "/nap") : isFresh(v) ? el("span", { class: "grow", style: "background:var(--heat)" }, "friss") : null),
          el("div", { class: "vname" }, v.author_name || "?"),
          el("div", { class: "vsub" }, `♥ ${short(v.like_count)}` + (v.upload_time ? " · " + ago(v.upload_time) : "")));
      })),
      el("div", { class: "d-note" }, "Elöl a friss videók (a napi videógyűjtésből), utána a TikTok Shop termékoldalán látható videók nézettség szerint. A termékoldal listája csak régebbi videókat mutat."));
  }

  // ---------- charts ----------
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (n, a) => { const x = document.createElementNS(NS, n); for (const [k, v] of Object.entries(a)) x.setAttribute(k, v); return x; };
  function lineChart(points, color, label, emptyText) {
    const w = 600, h = 170, L = 50, R = 10, T = 10, B = 24;
    const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", role: "img" });
    if (!Array.isArray(points) || points.length < 2) {
      const t = svgEl("text", { x: w / 2, y: h / 2, "text-anchor": "middle", fill: "var(--muted)", "font-size": 13 });
      t.textContent = points === undefined || points === null ? "Betöltés…" : emptyText; svg.append(t); return svg;
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
    points.forEach(q => svg.append(svgEl("circle", { cx: sx(q[0]), cy: sy(Number(q[1])), r: 2.6, fill: color })));
    svg.setAttribute("aria-label", `${label}: ${nf(ys[0])} → ${nf(ys[ys.length - 1])}`);
    return svg;
  }
  const salesChart = (pts) => lineChart(pts, "var(--money)", "Eladott darab", "A görbe a második mérés után rajzolódik ki.");

  // ---------- videos (radar) ----------
  const VSEG = [["tracking", "Követett"], ["accel", "Gyorsul"], ["starred", "Csillagos"], ["out", "Kiesett"], ["hidden", "Elrejtett"]];
  const isOut = (v) => v.status !== "tracking";
  function vFilter(seg) {
    return (v) => {
      if (seg === "hidden") return v.hidden;
      if (v.hidden) return false;
      if (seg === "tracking") return !isOut(v);
      if (seg === "accel") return !isOut(v) && Number(v.acceleration) > 1;
      if (seg === "starred") return v.starred;
      if (seg === "out") return isOut(v);
      return true;
    };
  }
  function renderVideos() {
    $("vseg").replaceChildren(...VSEG.map(([k, l]) => el("button", { type: "button", class: "tab", role: "tab", "aria-selected": String(V.seg === k),
      onclick: () => { V.seg = k; renderVideos(); } }, l, el("em", {}, nf(state.videos.filter(vFilter(k)).length)))));
    const q = V.q.trim().toLowerCase();
    let list = state.videos.filter(vFilter(V.seg));
    if (q) list = list.filter(v => [v.product_title, v.description, v.author].some(s => (s || "").toLowerCase().includes(q)));
    const key = (v) => V.sort === "newest" ? new Date(v.created_at_tt).getTime() : Number(v[V.sort]);
    list.sort((a, b) => { const x = key(a), y = key(b); return (isNaN(y) ? -Infinity : y) - (isNaN(x) ? -Infinity : x); });
    if (!list.length) { $("vrows").replaceChildren(el("tr", {}, el("td", { colspan: 8, class: "empty" }, el("b", {}, "Nincs videó ebben a nézetben"), "A reggeli gyűjtés után jelennek meg az új videók."))); return; }
    $("vrows").replaceChildren(...list.map(v => {
      const a = Number(v.acceleration);
      const badge = v.status === "expired" ? el("span", { class: "chip" }, "lejárt") : v.status === "dropped" ? el("span", { class: "chip" }, "kiesett")
        : v.acceleration == null ? el("span", { class: "chip blue" }, "új") : a > 1.2 ? el("span", { class: "chip heat" }, "gyorsul ×" + dec(a)) : a < .8 ? el("span", { class: "chip" }, "lassul") : el("span", { class: "chip" }, "egyenletes");
      const price = v.product_price != null ? usd(v.product_price) : "–";
      return el("tr", { onclick: () => window.open(v.url, "_blank", "noopener") },
        el("td", { class: "c-star" }, starBtn(v, toggleVideoStar)),
        el("td", { class: "c-prod" }, el("div", { class: "prod" }, img({ product_id: v.product_id, image: v.product_image }, 160),
          el("div", { style: "min-width:0" }, el("div", { class: "ptitle" }, v.product_title || (v.description || "").replace(/#\w+/g, "").trim() || "Videó"),
            el("div", { class: "pmeta" }, badge, el("span", {}, "@" + (v.author || "?")),
              el("button", { type: "button", class: "link-btn", style: "color:var(--muted)", onclick: (e) => { e.stopPropagation(); setVideoHidden(v, !v.hidden); } }, v.hidden ? "visszaállítás" : "elrejtés"))))),
        el("td", { class: "r" }, el("div", { class: "big" }, short(v.recent_views_per_hour ?? v.avg_views_per_hour) + "/ó")),
        el("td", { class: "r" }, v.acceleration != null ? "×" + dec(v.acceleration) : "–"),
        el("td", { class: "r" }, short(v.views)),
        el("td", { class: "r" }, price),
        el("td", { class: "r" }, v.product_sold != null ? [el("div", { class: "big" }, short(v.product_sold)), v.product_sold_per_day != null ? el("div", { class: "small pos" }, "+" + short(v.product_sold_per_day) + "/nap") : null] : "–"),
        el("td", { class: "r small" }, ageText(v.age_hours)));
    }));
  }
  $("vq").addEventListener("input", () => { V.q = $("vq").value; renderVideos(); });
  $("vsort").addEventListener("change", () => { V.sort = $("vsort").value; renderVideos(); });
  async function toggleVideoStar(v) {
    const next = !v.starred; v.starred = next; renderVideos();
    try { const st = await rpc("tr_set_video", { p_video_id: v.video_id, p_starred: next }); if (st) v.status = st; }
    catch (e) { v.starred = !next; banner("Nem sikerült menteni. " + errText(e), true); }
    renderVideos();
  }
  async function setVideoHidden(v, hide) {
    const prev = { hidden: v.hidden, starred: v.starred }; v.hidden = hide; if (hide) v.starred = false; renderVideos();
    try { await rpc("tr_set_video", { p_video_id: v.video_id, p_hidden: hide }); }
    catch (e) { Object.assign(v, prev); banner("Nem sikerült menteni. " + errText(e), true); renderVideos(); }
  }

  // ---------- runs ----------
  const JOB = { shop: "Termékkeresés", shop_track: "Eladásmérés", videos: "Termékvideók", collect: "Videógyűjtés", track: "Videómérés" };
  let openRun = null;
  function renderRuns() {
    if (!state.runs.length) { $("runs").replaceChildren(el("div", { class: "empty" }, "Még nincs futás.")); return; }
    const body = [];
    for (const r of state.runs) {
      const s = r.stats || {};
      const mins = r.finished_at ? Math.max(1, Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 60000)) + " perc" : "fut";
      const st = !r.finished_at ? el("span", { class: "chip gold" }, "fut") : r.ok ? el("span", { class: "chip money" }, "rendben") : el("span", { class: "chip", style: "color:var(--bad)" }, "hiba");
      let result = "";
      if (r.job === "shop") result = `${nf(s.seen)} átnézve, ${nf(s.in_range)} a sávban` + (s.women_seen ? `, női ruha: ${nf(s.women_in_range)} / ${nf(s.women_seen)} (${nf(s.women_brand_skipped || 0)} márkás kihagyva)` : "") + `, ${nf(s.product_pages)} termékoldal`;
      else if (r.job === "shop_track") result = `${nf(s.product_pages)} / ${nf(s.selected)} termék mérve`;
      else if (r.job === "videos") result = `${nf(s.video_products)} termék, ${nf(s.videos)} videó`;
      else if (r.job === "collect") result = `${nf(s.seen)} videó átnézve, ${nf(s.ok)} új`;
      else result = `${nf(s.tracking)} követett, ${nf(s.dropped || 0)} kiesett`;
      const errs = (s.feed_errors || 0) + (s.failed || 0) + (s.category_errors || 0) + (s.product_page_errors || 0) + (s.video_errors || 0);
      const feeds = r.job === "shop" ? s.categories : s.feeds;
      const canOpen = (feeds && Object.keys(feeds).length) || r.error;
      const open = openRun === r.id;
      body.push(el("tr", { class: canOpen ? "click" : null, onclick: canOpen ? () => { openRun = open ? null : r.id; renderRuns(); } : null },
        el("td", {}, (canOpen ? (open ? "▾ " : "▸ ") : "") + (JOB[r.job] || r.job)),
        el("td", {}, when(r.started_at)), el("td", {}, mins), el("td", {}, st), el("td", {}, result),
        el("td", { class: "r" }, s.proxy_mb != null ? dec(s.proxy_mb) + " MB" : "–"), el("td", { class: "r" }, nf(errs))));
      if (open) {
        const inner = [];
        if (r.error) inner.push(el("div", { style: "color:var(--bad);margin-bottom:8px" }, r.error));
        if (feeds) inner.push(el("div", { class: "feedgrid" }, ...Object.entries(feeds).sort((a, b) => (b[1].in_range ?? b[1].new ?? 0) - (a[1].in_range ?? a[1].new ?? 0)).map(([name, f]) =>
          el("div", { class: f.error ? "err" : "", title: f.error || null }, el("span", {}, r.job === "shop" ? catLabel(name) : name),
            el("span", {}, f.error && !f.loads ? "hiba" : r.job === "shop" ? `${f.in_range || 0} / ${f.products || 0}` : `${f.new || 0} új / ${f.seen || 0}`)))));
        body.push(el("tr", { class: "detail" }, el("td", { colspan: 7 }, ...inner)));
      }
    }
    $("runs").replaceChildren(el("table", { class: "rtable" },
      el("thead", {}, el("tr", {}, ...["Feladat", "Indult", "Időtartam", "Állapot", "Eredmény", "Proxy", "Hibák"].map((h, i) => el("th", { class: i >= 5 ? "r" : null }, h)))),
      el("tbody", {}, ...body)));
  }
  const catLabel = (c) => { const p = state.shop.find(x => c.endsWith("/" + x.category_id) && x.category_name); return p ? p.category_name : c.split("/")[0].replace(/-/g, " ").replace(/^./, m => m.toUpperCase()); };

  // ---------- settings ----------
  let dirty = false, tags = [], cats = [], fcats = [], brands = [];
  const NUM = [
    ["shop_min_price", "Minimum ár ($)", 0, 10000, ""], ["shop_max_price", "Maximum ár ($)", 1, 10000, ""],
    ["shop_min_revenue_day", "„Nyerő” ennyi napi bevételtől ($)", 0, 1e7, ""],
    ["shop_fetches_per_category", "Betöltés kategóriánként", 1, 10, "Egy betöltés kb. 20 terméket mutat, mindig kicsit mást."],
    ["fashion_min_price", "Női ruha minimum ár ($)", 0, 10000, ""], ["fashion_max_price", "Női ruha maximum ár ($)", 1, 10000, ""],
    ["fashion_fetches_per_category", "Betöltés kategóriánként (női ruha)", 1, 30, "Több betöltés több terméket hoz, de tovább tart a futás."],
    ["hot_video_days", "„Aktuális nyerő”: videó legfeljebb ennyi napos", 7, 365, "Ennél frissebb videó kell ahhoz, hogy egy termék aktuális nyerő legyen."],
    ["retire_below_per_day", "Kivezetés napi ennyi eladás alatt", 0, 1000, "Két mérés után kikerül a követésből (adataival együtt), ha napi ennél kevesebbet ad el. A csillagozottak maradnak. Ha újra fogyni kezd, magától visszakerül. 0 = kikapcsolva."],
    ["shop_track_min_sold", "Videók és galéria ennyi eladástól", 0, 1e9, "Ennél kevesebb eladásnál nem tölti le a termék videóit és képeit."],
    ["videos_per_hashtag", "Videó hashtagenként", 10, 1000, "A TikTok kb. 150–190 videó után megáll."], ["trending_count", "Trending videók száma", 0, 1000, ""],
    ["max_age_days", "Legfeljebb ennyi napos videó", 1, 30, ""], ["min_views", "Legalább ennyi nézés", 0, 1e9, ""],
    ["min_avg_views_per_hour", "Legalább ennyi nézés óránként", 0, 1e8, ""], ["min_product_price", "Minimum termékár a videóknál ($)", 0, 10000, "0 esetén kikapcsolva."],
    ["drop_below_views_per_hour", "Kiesik, ha óránként ennél kevesebb nézést kap", 0, 1e8, ""], ["min_snapshots_before_drop", "Legalább ennyi mérés után", 2, 20, ""],
  ];
  const BOOL = [["include_trending", "Trending feed is", "A hashtageken kívül a trending feedet is átnézi. Eddig nem adott videót."],
    ["require_shop_product", "Csak TikTok Shop termékes videók", "Csak az kerül be, amihez TikTok Shop termék van kapcsolva."],
    ["require_product_signal", "Csak termékre utaló videók", "A szövegben termékre utaló szavak alapján is szűr."]];
  const numField = (k) => { const d = NUM.find(x => x[0] === k); const v = state.settings[k] ?? DEFAULTS[k] ?? "";
    return el("div", { class: "field" }, el("label", { for: "s-" + k }, d[1]), el("input", { type: "number", id: "s-" + k, min: d[2], max: d[3], value: v }), d[4] ? el("small", {}, d[4]) : null); };
  const boolField = (k) => { const d = BOOL.find(x => x[0] === k);
    return el("label", { class: "toggle" }, el("input", { type: "checkbox", id: "s-" + k, checked: !!state.settings[k] || null }), el("span", { class: "field" }, el("span", { class: "lbl" }, d[1])), el("small", {}, d[2])); };
  function tagEditor(id, list, label, help, placeholder, parse, display) {
    const box = el("div", { class: "tags", id: id + "-tags" });
    const draw = () => box.replaceChildren(...list.map((t, i) => el("span", { class: "tag" }, display(t),
      el("button", { type: "button", "aria-label": "Törlés", onclick: () => { list.splice(i, 1); draw(); markDirty(); } }, "×"))));
    draw();
    const input = el("input", { type: "text", id: id + "-input", placeholder, autocomplete: "off" });
    const add = () => { let added = false; for (const part of input.value.split(/[,\n]+/).map(x => x.trim()).filter(Boolean)) { const v = parse(part); if (v && !list.includes(v)) { list.push(v); added = true; } } input.value = ""; draw(); if (added) markDirty(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    return el("div", { class: "field" }, el("span", { class: "lbl" }, label), box, el("div", { class: "tagadd" }, input, el("button", { type: "button", class: "btn", onclick: add }, "Hozzáadás")), el("small", {}, help));
  }
  function markDirty() { dirty = true; const b = document.querySelector(".savebar"); if (b) { b.classList.add("dirty"); b.querySelector("span").textContent = "Nem mentett változásaid vannak."; } }
  function renderSettings() {
    const s = state.settings;
    tags = Array.isArray(s.hashtags) ? s.hashtags.slice() : [];
    cats = Array.isArray(s.shop_categories) ? s.shop_categories.slice() : [];
    fcats = Array.isArray(s.fashion_categories) ? s.fashion_categories.slice() : [];
    brands = Array.isArray(s.known_brands) && s.known_brands.length ? s.known_brands.slice() : DEFAULT_BRANDS.slice();
    const lastShop = state.runs.find(r => r.job === "shop" && r.stats && r.stats.categories);
    const catStats = lastShop ? lastShop.stats.categories : {};
    $("settings-form").replaceChildren(
      el("div", { class: "card wide" }, el("h2", {}, "Termékkeresés"),
        el("p", {}, "Minden reggel végignézi ezeket a TikTok Shop kategóriákat, és elmenti az ársávba eső termékeket. 6 óránként újraméri az eladásukat."),
        el("div", { class: "row" }, numField("shop_min_price"), numField("shop_max_price"), numField("shop_min_revenue_day")),
        el("div", { class: "row" }, numField("shop_fetches_per_category"), numField("shop_track_min_sold"), numField("hot_video_days")),
        el("div", { class: "row" }, numField("retire_below_per_day")),
        tagEditor("cats", cats, "Kategóriák", "Zöld szám: hány ársávba eső terméket hozott az utolsó futásnál. Új kategóriát a TikTok Shop kategóriaoldal linkjével adhatsz hozzá.",
          "pl. shop.tiktok.com/us/c/fitness/835336", (x) => { const m = x.match(/(?:\/c\/)?([a-z0-9-]+)\/(\d{4,})/i); return m ? m[1].toLowerCase() + "/" + m[2] : null; },
          (c) => [catLabel(c), catStats[c] ? el("em", {}, catStats[c].in_range || 0) : null]),
        tagEditor("brands", brands, "Ismert márkák", "Ezeknek a termékei „Márkás” jelölést kapnak és kimaradnak a listákból (ha a terméknév ezzel kezdődik, vagy a bolt neve ez).",
          "pl. VEVOR", (x) => x.slice(0, 40), (b) => b)),
      el("div", { class: "card wide" }, el("h2", {}, "Női ruha"),
        el("p", {}, "Ezeket a női ruházati kategóriákat külön, alaposabban nézi át minden reggel. Ismert márkák termékeit nem menti el."),
        el("div", { class: "row" }, numField("fashion_min_price"), numField("fashion_max_price"), numField("fashion_fetches_per_category")),
        tagEditor("fcats", fcats, "Női ruha kategóriák", "Zöld szám: hány ársávba eső terméket hozott az utolsó futásnál.",
          "pl. shop.tiktok.com/us/c/women-s-dresses/842504", (x) => { const m = x.match(/(?:\/c\/)?([a-z0-9-]+)\/(\d{4,})/i); return m ? m[1].toLowerCase() + "/" + m[2] : null; },
          (c) => [catLabel(c), catStats[c] ? el("em", {}, catStats[c].in_range || 0) : null])),
      el("div", { class: "card" }, el("h2", {}, "Videógyűjtés: hol keressen"), el("p", {}, "Ezeknek a hashtageknek a friss videóit nézi át minden reggel."),
        tagEditor("tags", tags, "Hashtagek", "Enterrel is hozzáadhatod, # nélkül.", "pl. tiktokshopfinds", (x) => x.toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "") || null, (t) => "#" + t),
        numField("videos_per_hashtag"), boolField("include_trending"), numField("trending_count")),
      el("div", { class: "card" }, el("h2", {}, "Videógyűjtés: mi kerüljön be"),
        boolField("require_shop_product"), boolField("require_product_signal"), numField("max_age_days"), numField("min_views"), numField("min_avg_views_per_hour"), numField("min_product_price"),
        el("h2", {}, "Mikor essen ki"), numField("drop_below_views_per_hour"), numField("min_snapshots_before_drop")),
      el("div", { class: "savebar" }, el("button", { type: "submit", class: "btn primary", id: "save" }, "Beállítások mentése"), el("span", {}, "A következő futásnál lép életbe.")));
    dirty = false;
  }
  $("settings-form").addEventListener("input", (e) => { if (!/-input$/.test(e.target.id)) markDirty(); });
  $("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = document.querySelector(".savebar span");
    const vals = {};
    for (const [k, label, lo, hi] of NUM) {
      const n = Number($("s-" + k).value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < lo || n > hi) { note.textContent = `Ellenőrizd: „${label}”. ${nf(lo)} és ${nf(hi)} közötti egész szám kell.`; $("s-" + k).focus(); return; }
      vals[k] = n;
    }
    for (const [k] of BOOL) vals[k] = $("s-" + k).checked;
    if (vals.shop_min_price >= vals.shop_max_price || vals.fashion_min_price >= vals.fashion_max_price) { note.textContent = "A minimum ár legyen kisebb a maximum árnál."; return; }
    if (!cats.length) { note.textContent = "Legalább egy kategória kell."; return; }
    if (!tags.length) { note.textContent = "Legalább egy hashtag kell."; return; }
    Object.assign(vals, { hashtags: tags.slice(), shop_categories: cats.slice(), fashion_categories: fcats.slice(), known_brands: brands.slice() });
    $("save").disabled = true; $("save").textContent = "Mentés…";
    try {
      await rpc("tr_save_settings", { p_values: vals });
      state.settings = Object.assign({}, state.settings, vals);
      dirty = false; document.querySelector(".savebar").classList.remove("dirty");
      note.textContent = "Mentve. A következő futásnál már ezekkel megy.";
      brandCache = new WeakMap(); renderKpis(); renderSeg(); renderCats(); renderTypes(); renderTable();
    } catch (err) { note.textContent = errText(err); }
    finally { $("save").disabled = false; $("save").textContent = "Beállítások mentése"; }
  });



  // ---------- "Videó link -> termék" ----------
  const VL = { busy: false, res: null, err: "" };
  async function lookupVideo(url) {
    if (!url) return;
    if (!(sb.functions && sb.functions.invoke)) { VL.err = "Ez a keresés csak a weboldalon (Netlify) működik, a csevegésben lévő változatban nem."; VL.res = null; renderVlink(); return; }
    if (!/tiktok\.com/i.test(url)) { VL.err = "Ide TikTok videó vagy TikTok Shop termék linkjét másold be."; VL.res = null; renderVlink(); return; }
    VL.busy = true; VL.err = ""; VL.res = null; renderVlink();
    try {
      const { data, error } = await sb.functions.invoke("tr-video-products", { body: { url }, region: "us-east-1" });  // TikTok shows the shop links only to US visitors
      if (error) {
        let msg = error.message || "ismeretlen hiba";
        try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {}
        throw new Error(msg);
      }
      VL.res = data;
    } catch (e) { VL.err = "Nem sikerült: " + (e.message || e); }
    finally { VL.busy = false; renderVlink(); }
  }
  async function watchProduct(p, on) {
    try {
      if (on) {
        const rows = await rpc("tr_watch_products", { products: [{ product_id: p.product_id, title: p.title, url: p.url, image: p.image, category: p.category,
          seller_id: p.seller_id, shop_name: p.shop_name, price: p.price }] }) || [];
        const r = rows.find(x => x.product_id === p.product_id) || {};
        Object.assign(p, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)), { starred: true, tracked: true, known: true });
        let row = state.shop.find(x => x.product_id === p.product_id);
        if (!row) {
          row = { product_id: p.product_id, title: p.title, url: p.url, image: p.image, price: p.price, shop_name: p.shop_name, seller_id: p.seller_id,
            focus: p.focus || null, sold_now: p.sold_now, sold_per_day: p.sold_per_day, revenue_per_day: p.revenue_per_day,
            first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), starred: true, hidden: false };
          state.shop.unshift(row);
        }
        row.starred = true; row.hidden = false;
        banner("Hozzáadva a megfigyelt termékekhez és csillagozva. 6 óránként mérjük, a napi eladás a második mérés után látszik.");
      } else {
        await rpc("tr_set_product", { p_product_id: p.product_id, p_starred: false });
        p.starred = false;
        const row = state.shop.find(x => x.product_id === p.product_id); if (row) row.starred = false;
      }
      renderSeg(); renderTable(); renderVlink();
    } catch (e) { banner("Nem sikerült menteni. " + errText(e), true); }
  }
  function renderVlink() {
    const box = $("vlink-res"), btn = $("vlink-btn");
    btn.disabled = VL.busy; btn.textContent = VL.busy ? "Keresés…" : "Keresés";
    if (VL.busy) { box.hidden = false; box.replaceChildren(el("div", { class: "d-note" }, "Adatok lekérése a TikTokról, pár másodperc…")); return; }
    if (VL.err) { box.hidden = false; box.replaceChildren(el("div", { class: "vl-err" }, VL.err), el("button", { type: "button", class: "link", onclick: () => { VL.err = ""; box.hidden = true; } }, "Bezárás")); return; }
    if (!VL.res) { box.hidden = true; return; }
    const v = VL.res.video, prods = VL.res.products || [];
    const close = el("button", { type: "button", class: "icon-btn", "aria-label": "Bezárás", onclick: () => { VL.res = null; renderVlink(); } }, "×");
    box.hidden = false;
    box.replaceChildren(
      v ? el("div", { class: "vl-head" },
        el("div", {}, el("b", {}, v.author ? "@" + v.author : "Videó"),
          el("span", {}, [v.views != null ? short(v.views) + " nézés" : null, v.likes != null ? short(v.likes) + " like" : null,
            v.created ? ago(new Date(v.created * 1000).toISOString()) : null].filter(Boolean).join(" · ")),
          v.desc ? el("p", {}, v.desc.slice(0, 220)) : null),
        el("div", { class: "vl-actions" }, v.url ? el("a", { class: "btn", href: v.url, target: "_blank", rel: "noopener" }, "Videó ↗") : null, close))
        : el("div", { class: "vl-head" }, el("div", {}, el("b", {}, "TikTok Shop termék")), el("div", { class: "vl-actions" }, close)),
      prods.length ? el("div", { class: "vl-list" }, ...prods.map(p => {
        const known = state.shop.find(x => x.product_id === p.product_id);
        const watched = !!(p.starred && p.tracked !== false);
        return el("div", { class: "vl-item" },
          el("div", { class: "vl-img" }, p.image ? el("img", { src: sized(p.image, 160) || p.image, alt: "", referrerpolicy: "no-referrer", class: "zoomable",
            onclick: () => openLightbox([{ src: big(p.image) || p.image, fallback: p.image }], 0) }) : "▢"),
          el("div", { class: "vl-info" },
            el("b", {}, p.title || "Névtelen termék"),
            el("div", { class: "vl-meta" },
              p.price != null ? el("span", {}, usd(p.price)) : null,
              p.sold_now != null ? el("span", {}, short(p.sold_now) + " eladva") : null,
              p.sold_per_day != null ? el("span", { class: "money" }, "+" + nf(p.sold_per_day) + "/nap · " + money(p.revenue_per_day) + "/nap")
                : el("span", { class: "muted" }, p.known ? "napi eladás: a 2. mérés után" : "még nem követjük")),
            el("div", { class: "vl-meta" }, "Bolt: ",
              p.store_url ? el("a", { href: p.store_url, target: "_blank", rel: "noopener" }, (p.shop_name || "megnyitás") + " ↗") : el("b", {}, p.shop_name || "ismeretlen"),
              p.store_sold ? el("span", {}, " · " + short(p.store_sold) + " eladás összesen") : null,
              p.store_per_day ? el("span", {}, " · napi kb. " + nf(p.store_per_day)) : null)),
          el("div", { class: "vl-btns" },
            p.url ? chromeLink(p.url, { class: "btn" }, "TikTok Shop ↗") : null,
            known ? el("button", { type: "button", class: "btn", onclick: () => openProduct(p.product_id) }, "Adatlap") : null,
            watched ? el("button", { type: "button", class: "btn on", title: "Kattints, ha már nem szeretnéd csillagozva látni", onclick: () => watchProduct(p, false) }, "★ Megfigyelve")
                    : el("button", { type: "button", class: "btn primary", onclick: () => watchProduct(p, true) }, "+ Megfigyeléshez"),
            el("button", { type: "button", class: "btn", onclick: () => addToMine(p) }, "+ Saját termékeim közé")));
      })) : el("div", { class: "d-note" }, "Ehhez a videóhoz nincs TikTok Shop termék belinkelve (nincs rajta kosár ikon)."),
      prods.length ? el("div", { class: "d-note" }, "A „+ Megfigyeléshez” felveszi a terméket a 6 óránkénti mérésbe és csillagozza. A csillagos termékeket a Csillagos szűrőben találod.") : null);
  }
  $("vlink-form").addEventListener("submit", (e) => { e.preventDefault(); lookupVideo($("vlink").value.trim()); });

  // ---------- my products ("Saját termékek") ----------
  const MY = { list: null, loading: false, edit: null, imgs: null, busy: 0, pasteKind: "photo", note: "" };
  const CUR = { USD: "$", CNY: "¥", EUR: "€" };
  const curFmt = (n, c) => n == null || n === "" || isNaN(n) ? "–" : (CUR[c] || "") + Number(n).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
  async function loadMine(force) {
    if (MY.loading || (MY.list && !force)) { renderMine(); return; }
    MY.loading = true; renderMine();
    try { MY.list = await rpc("tr_my_products") || []; }
    catch (e) { MY.list = MY.list || []; banner("Nem sikerült betölteni a saját termékeidet. " + errText(e), true); }
    finally { MY.loading = false; renderMine(); }
  }
  const linkChips = (m) => [["tiktok_url", "TikTok"], ["ali_url", "AliExpress"], ["url_1688", "1688"], ["other_url", "Egyéb"]]
    .filter(([k]) => m[k]).map(([k, l]) => k === "tiktok_url"
      ? chromeLink(m[k], { class: "chip blue", onclick: (e) => e.stopPropagation() }, l + " ↗")
      : el("a", { class: "chip blue", href: m[k], target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, l + " ↗"));
  function costLine(m) {
    const u = m.unit_price != null && m.unit_price !== "" ? Number(m.unit_price) : null, sh = m.shipping_price != null && m.shipping_price !== "" ? Number(m.shipping_price) : null;
    if (u == null && sh == null) return null;
    return (u || 0) + (sh || 0);
  }
  function renderMine() {
    const box = $("mine-grid"); if (!box) return;
    if (MY.loading && !MY.list) { box.replaceChildren(el("div", { class: "empty" }, "Betöltés…")); return; }
    const q = ($("mine-q").value || "").trim().toLowerCase();
    const list = (MY.list || []).filter(m => !q || [m.name, m.notes, m.tiktok_url, m.ali_url, m.url_1688].some(x => (x || "").toLowerCase().includes(q)));
    if (!list.length) {
      box.replaceChildren(el("div", { class: "mine-empty" },
        el("b", {}, (MY.list || []).length ? "Nincs találat." : "Még nincs saját terméked."),
        el("span", {}, "Az „+ Új termék” gombbal adhatsz hozzá egyet, vagy a Termékradarban egy termék adatlapján a „+ Saját termékeim közé” gombbal.")));
      return;
    }
    box.replaceChildren(...list.map(m => {
      const cost = costLine(m);
      const margin = m.sale_price && cost != null && m.currency === "USD" ? Number(m.sale_price) - cost : null;
      return el("button", { type: "button", class: "mine-card", onclick: () => openMine(m) },
        el("div", { class: "mine-thumb" }, m.thumb ? el("img", { src: "data:image/jpeg;base64," + m.thumb, alt: "" }) : "Nincs kép"),
        el("div", { class: "mine-body" },
          el("b", {}, m.name || "Névtelen termék"),
          el("div", { class: "mine-cost" },
            cost != null ? el("span", {}, "Bekerülés: ", el("strong", {}, curFmt(cost, m.currency)), "/db") : el("span", { class: "muted" }, "Nincs még ár"),
            margin != null ? el("span", { class: margin > 0 ? "pos" : "neg" }, `Haszon: ${curFmt(margin, "USD")}/db`) : null),
          el("div", { class: "mine-links" }, ...linkChips(m),
            m.photos ? el("span", { class: "chip" }, `${m.photos} kép`) : null,
            m.size_charts ? el("span", { class: "chip" }, "Mérettábla") : null)));
    }));
  }
  $("mine-q").addEventListener("input", renderMine);
  $("mine-new").addEventListener("click", () => openMine(null));

  function openMine(m) {
    MY.edit = m ? Object.assign({}, m) : { id: null, name: "", currency: "USD" };
    MY.imgs = m ? null : [];
    MY.note = "";
    P.sel = null;
    $("drawer").hidden = false; $("scrim").hidden = false; document.body.style.overflow = "hidden";
    renderMineEditor(); $("drawer").scrollTop = 0;
    if (m) rpc("tr_my_product_images", { pid: m.id }).then(r => { if (MY.edit && MY.edit.id === m.id) { MY.imgs = r || []; renderMineEditor(); } })
      .catch(e => { MY.imgs = []; MY.note = "A képeket nem sikerült betölteni. " + errText(e); renderMineEditor(); });
  }
  function closeMine() { MY.edit = null; $("drawer").hidden = true; $("scrim").hidden = true; document.body.style.overflow = ""; }
  async function addToMine(p) {
    try {
      const id = await rpc("tr_save_my_product", { p: { name: p.title || "", tiktok_url: (p.url || "").split("?")[0] || null, source_product_id: p.product_id, currency: "USD", sale_price: p.price } });
      closeDrawer(); selectView("mine");
      MY.list = await rpc("tr_my_products") || []; renderMine();
      const m = MY.list.find(x => x.id === id); if (m) openMine(m);
      banner("Felvéve a saját termékeid közé. A termékképek átvétele folyamatban…");
      importImages(id, p.product_id);
    } catch (e) { banner("Nem sikerült felvenni. " + errText(e), true); }
  }
  // the product's pictures from TikTok Shop: full size through the server, else the small copies we keep
  async function importImages(mineId, productId) {
    let added = 0;
    try {
      if (sb.functions && sb.functions.invoke) {
        const { data, error } = await sb.functions.invoke("tr-import-images", { body: { my_product_id: mineId, product_id: productId }, region: "us-east-1" });
        if (!error && data) added = Number(data.added) || 0;
      }
    } catch (_) { /* fall back below */ }
    let small = false;
    if (!added) {
      try { added = Number(await rpc("tr_copy_gallery_to_mine", { mine: mineId, src: productId })) || 0; small = added > 0; } catch (_) {}
    }
    banner(added ? `${added} termékkép átvéve${small ? " (kisebb felbontásban)" : ""}.` : "A termékképeket nem sikerült átvenni, add hozzá őket kézzel.", !added);
    loadMine(true);
    if (MY.edit && MY.edit.id === mineId) {
      try { MY.imgs = await rpc("tr_my_product_images", { pid: mineId }) || []; renderMineEditor(); } catch (_) {}
    }
  }
  // downloads: one picture, or all of them in a ZIP
  const slug = (t) => (t || "termek").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "termek";
  const extOf = (mime) => mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
  const b64ToBlob = (b64, mime) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime || "image/jpeg" }); };
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function imageName(m, img, i) { return `${slug(m.name)}-${img.kind === "size_chart" ? "merettabla" : "kep"}-${String(i + 1).padStart(2, "0")}.${extOf(img.mime)}`; }
  async function downloadAll(kind) {
    const m = MY.edit; if (!m) return;
    const imgs = (MY.imgs || []).filter(x => !kind || x.kind === kind);
    if (!imgs.length) return;
    if (!window.JSZip) { imgs.forEach((img, i) => setTimeout(() => saveBlob(b64ToBlob(img.data, img.mime), imageName(m, img, i)), i * 400)); return; }
    const zip = new JSZip();
    const counters = {};
    for (const img of imgs) { counters[img.kind] = (counters[img.kind] || 0) + 1; zip.file(imageName(m, img, counters[img.kind] - 1), img.data, { base64: true }); }
    saveBlob(await zip.generateAsync({ type: "blob" }), `${slug(m.name)}-kepek.zip`);
  }
  // read the form into MY.edit
  function readMineForm() {
    const v = (id) => { const n = document.getElementById(id); return n ? n.value.trim() : ""; };
    Object.assign(MY.edit, { name: v("m-name"), tiktok_url: v("m-tiktok"), ali_url: v("m-ali"), url_1688: v("m-1688"), other_url: v("m-other"),
      currency: v("m-cur") || "USD", unit_price: v("m-unit").replace(",", "."), shipping_price: v("m-ship").replace(",", "."), sale_price: v("m-sale").replace(",", "."), notes: v("m-notes") });
  }
  async function saveMine(quiet) {
    readMineForm();
    for (const k of ["unit_price", "shipping_price", "sale_price"]) if (MY.edit[k] !== "" && isNaN(Number(MY.edit[k]))) { MY.note = "Az árakhoz számot írj, pl. 4.50"; renderMineEditor(); return null; }
    MY.busy++; if (!quiet) { MY.note = "Mentés…"; renderMineEditor(); }
    try {
      const id = await rpc("tr_save_my_product", { p: MY.edit });
      MY.edit.id = id;
      MY.note = quiet ? MY.note : "Mentve.";
      loadMine(true);
      return id;
    } catch (e) { MY.note = "Nem sikerült menteni. " + errText(e); return null; }
    finally { MY.busy--; renderMineEditor(); }
  }
  // pictures: resized in the browser (JPEG), then stored
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
    if (!MY.edit.id) { if (!MY.edit.name) { const n = document.getElementById("m-name"); MY.edit.name = n && n.value.trim() ? n.value.trim() : "Új termék"; } if (!(await saveMine(true))) return; }
    const pid = MY.edit.id;
    MY.busy++; MY.note = `Képek feltöltése (${files.length})…`; renderMineEditor();
    let ok = 0;
    for (const f of files) {
      try {
        const data = await toJpeg(f, kind === "size_chart" ? 1800 : 1400, 0.82), thumb = await toJpeg(f, 240, 0.7);
        const id = await rpc("tr_add_my_image", { pid, kind, data, thumb });
        if (MY.edit && MY.edit.id === pid) { (MY.imgs = MY.imgs || []).push({ id, kind, idx: 999, data, thumb }); ok++; renderMineEditor(); }
      } catch (e) { MY.note = "Egy képet nem sikerült feltölteni. " + errText(e); }
    }
    MY.busy--; if (ok) MY.note = `${ok} kép hozzáadva.`; renderMineEditor(); loadMine(true);
  }
  async function removeMineImage(img) {
    try { await rpc("tr_remove_my_image", { iid: img.id }); MY.imgs = MY.imgs.filter(x => x !== img); renderMineEditor(); loadMine(true); }
    catch (e) { MY.note = "Nem sikerült törölni. " + errText(e); renderMineEditor(); }
  }
  async function removeMine() {
    if (!MY.edit || !MY.edit.id) { closeMine(); return; }
    if (!MY.confirmDel) { MY.confirmDel = true; MY.note = "Biztosan törlöd? Kattints még egyszer a Törlés gombra."; renderMineEditor(); setTimeout(() => { MY.confirmDel = false; }, 6000); return; }
    MY.confirmDel = false;
    try { await rpc("tr_remove_my_product", { pid: MY.edit.id }); closeMine(); loadMine(true); banner("Törölve."); }
    catch (e) { MY.note = "Nem sikerült törölni. " + errText(e); renderMineEditor(); }
  }
  function imageZone(kind, title, help) {
    const imgs = (MY.imgs || []).filter(x => x.kind === kind);
    const input = el("input", { type: "file", accept: "image/*", multiple: kind === "photo" ? true : null, hidden: true, onchange: (e) => { addMineImages(e.target.files, kind); e.target.value = ""; } });
    const zone = el("div", { class: "mz", tabindex: "0", onmouseenter: () => { MY.pasteKind = kind; }, onfocus: () => { MY.pasteKind = kind; },
      ondragover: (e) => { e.preventDefault(); zone.classList.add("over"); }, ondragleave: () => zone.classList.remove("over"),
      ondrop: (e) => { e.preventDefault(); zone.classList.remove("over"); addMineImages(e.dataTransfer.files, kind); } },
      ...imgs.map((img, i) => el("div", { class: "mz-img" },
        el("img", { src: `data:${img.mime || "image/jpeg"};base64,` + (img.thumb || img.data), alt: "", title: "Kattints a nagyításhoz",
          onclick: () => openLightbox(imgs.map(x => ({ src: `data:${x.mime || "image/jpeg"};base64,` + x.data })), i) }),
        el("button", { type: "button", class: "mz-dl", "aria-label": "Kép letöltése", title: "Letöltés", onclick: () => saveBlob(b64ToBlob(img.data, img.mime), imageName(MY.edit, img, i)) }, "⤓"),
        el("button", { type: "button", class: "mz-del", "aria-label": "Kép törlése", title: "Törlés", onclick: () => removeMineImage(img) }, "×"))),
      el("button", { type: "button", class: "mz-add", onclick: () => input.click() }, el("span", {}, "+"), kind === "photo" ? "Képek" : "Kép"));
    return el("div", { class: "d-sec" }, el("h3", {}, title, el("span", { class: "mz-head" }, imgs.length ? `${imgs.length} db` : "",
        imgs.length ? el("button", { type: "button", class: "link", onclick: () => downloadAll(kind) }, imgs.length > 1 ? "Összes letöltése (ZIP)" : "Letöltés") : null)), zone, input,
      el("div", { class: "d-note" }, help));
  }
  function renderMineEditor() {
    const m = MY.edit, d = $("drawer");
    if (!m) return;
    const field = (id, label, value, attrs) => el("div", { class: "field" }, el("label", { for: id }, label), el("input", Object.assign({ id, value: value ?? "", autocomplete: "off" }, attrs || {})));
    const linkField = (id, label, value, ph) => el("div", { class: "field" }, el("label", { for: id }, label),
      el("div", { class: "mlink" }, el("input", { id, type: "url", value: value || "", placeholder: ph, autocomplete: "off" }),
        value ? el("a", { class: "btn", href: value, target: "_blank", rel: "noopener" }, "Megnyitás ↗") : null));
    const cur = m.currency || "USD";
    d.replaceChildren(
      el("div", { class: "d-top" }, el("span", { class: "crumbs" }, "Saját termék" + (m.created_at ? " · felvéve " + new Date(m.created_at).toLocaleDateString("hu-HU") : "")),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Bezárás", onclick: closeMine }, "×")),
      el("form", { class: "mine-form", novalidate: true, onsubmit: (e) => { e.preventDefault(); saveMine(false); } },
        el("div", { class: "d-sec" },
          field("m-name", "Termék neve", m.name, { placeholder: "pl. Fleece-lined winter tights" }),
          linkField("m-tiktok", "TikTok Shop link", m.tiktok_url, "https://shop.tiktok.com/us/pdp/…"),
          linkField("m-ali", "AliExpress link", m.ali_url, "https://www.aliexpress.com/item/…"),
          linkField("m-1688", "1688.com link", m.url_1688, "https://detail.1688.com/offer/…"),
          linkField("m-other", "Egyéb beszállító (CJ, stb.)", m.other_url, "https://…")),
        el("div", { class: "d-sec" }, el("h3", {}, "Árak", el("span", {}, "darabonként")),
          el("div", { class: "mine-prices" },
            el("div", { class: "field" }, el("label", { for: "m-cur" }, "Pénznem"),
              el("select", { id: "m-cur" }, ...["USD", "CNY", "EUR"].map(c => el("option", { value: c, selected: c === cur ? "" : null }, c + " (" + CUR[c] + ")")))),
            field("m-unit", "Egységár (unit price)", m.unit_price, { inputmode: "decimal", placeholder: "0.00" }),
            field("m-ship", "Szállítás / db", m.shipping_price, { inputmode: "decimal", placeholder: "0.00" }),
            field("m-sale", "Eladási ár (USD)", m.sale_price, { inputmode: "decimal", placeholder: "0.00" })),
          mineSum(m)),
        el("div", { class: "d-sec" }, el("div", { class: "field" }, el("label", { for: "m-notes" }, "Jegyzet"),
          el("textarea", { id: "m-notes", rows: "3", placeholder: "pl. MOQ, szállítási idő, színek, beszállító neve" }, m.notes || ""))),
        el("div", { class: "mine-save" },
          el("button", { type: "submit", class: "btn primary", disabled: MY.busy ? "" : null }, MY.edit.id ? "Mentés" : "Létrehozás"),
          el("span", { class: "d-note", role: "status" }, MY.note || ""),
          m.id ? el("button", { type: "button", class: "btn danger", onclick: removeMine }, "Törlés") : null)),
      ...(MY.imgs == null ? [el("div", { class: "d-sec" }, el("div", { class: "d-note" }, "Képek betöltése…"))] : [
        imageZone("photo", "Termékképek", "Húzd ide a képeket, kattints a „+ Képek” gombra, vagy másold be (Ctrl+V). A képeket a böngésző kicsinyíti, mielőtt elmenti."),
        imageZone("size_chart", "Mérettábla", "A beszállító mérettáblázata képként. Ide is húzhatod, vagy bemásolhatod, ha az egér a mező fölött van.")]));
    // keep the numbers in the summary live while typing
    for (const id of ["m-cur", "m-unit", "m-ship", "m-sale"])
      document.getElementById(id).addEventListener("input", () => { readMineForm(); const old = d.querySelector(".mine-sumwrap"); if (old) old.replaceWith(mineSum(MY.edit)); });
  }
  function mineSum(m) {
    const cur = m.currency || "USD", cost = costLine(m);
    const sale = m.sale_price !== "" && m.sale_price != null && !isNaN(m.sale_price) ? Number(m.sale_price) : null;
    const margin = sale != null && cost != null && cur === "USD" ? sale - cost : null;
    return el("div", { class: "mine-sumwrap" },
      el("div", { class: "mine-sum" },
        el("div", {}, el("span", {}, "Bekerülési költség / db"), el("b", {}, cost != null && !isNaN(cost) ? curFmt(cost, cur) : "–")),
        el("div", {}, el("span", {}, "Haszon / db"), el("b", { class: margin == null ? "" : margin > 0 ? "pos" : "neg" }, margin != null && !isNaN(margin) ? curFmt(margin, "USD") : "–")),
        el("div", {}, el("span", {}, "Árrés"), el("b", {}, margin != null && sale ? Math.round(margin / sale * 100) + "%" : "–"))),
      cur !== "USD" && sale != null ? el("div", { class: "d-note" }, "A haszon számításához a beszerzési árat is USD-ben add meg (vagy írd át a pénznemet).") : null);
  }
  document.addEventListener("paste", (e) => {
    if (!MY.edit || $("drawer").hidden) return;
    const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault(); addMineImages(files, MY.pasteKind);
  });

  boot();
})();
