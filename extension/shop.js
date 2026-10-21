// TikTok Shop product page: a small "Termékradar" panel that collects the reviews and saves them.
(() => {
  const m = location.pathname.match(/(\d{15,})/);
  if (!m) return;
  const PID = m[1];
  // (filter_type, filter_value, how many): 1 = star rating, 2 = with photos or videos.
  // All the 1-3 star ones up to a cap (that is where the problems are), the newest happy ones, the ones with photos.
  const PLAN = [[1, 1, 300, "1 csillagos"], [1, 2, 200, "2 csillagos"], [1, 3, 200, "3 csillagos"],
                [1, 4, 100, "4 csillagos"], [1, 5, 150, "5 csillagos"], [2, 0, 120, "képes"]];
  const SIZE = 50;

  let seq = 0;
  const waiting = new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.src !== "tr-ext-res") return;
    const cb = waiting.get(e.data.id); if (cb) { waiting.delete(e.data.id); cb(e.data.res); }
  });
  const ask = (body) => new Promise((resolve) => {
    const id = ++seq; waiting.set(id, resolve);
    window.postMessage({ src: "tr-ext-req", id, body }, location.origin);
    setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ code: -2 }); } }, 30000);
  });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function parse(r) {
    if (!r || !r.review_id) return null;
    const ms = Number(r.review_time) || 0;
    return {
      review_id: String(r.review_id), rating: r.review_rating, time: ms ? Math.floor(ms / 1000) : null,
      verified: !!r.is_verified_purchase, incentivized: !!r.is_incentivized_review,
      text: (r.review_text || "").trim().slice(0, 4000) || null, sku: (r.sku_specification || "").trim().slice(0, 300) || null,
      country: r.review_country || null, reviewer: r.reviewer_name || null,
      images: (r.review_images || []).filter(u => typeof u === "string").slice(0, 9),
    };
  }

  // ---------- panel ----------
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    .box{font:14px/1.4 system-ui,sans-serif;background:#101214;color:#e9ecef;border-radius:14px;padding:12px 14px;width:280px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
    .t{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:6px}
    .dot{width:10px;height:10px;border-radius:50%;background:#34d399}
    .msg{color:#b8c0c8;font-size:13px;min-height:18px}
    .bar{height:6px;background:#2a2f35;border-radius:4px;margin:8px 0;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#34d399;transition:width .3s}
    button{all:unset;cursor:pointer;background:#34d399;color:#06281c;font-weight:700;padding:8px 12px;border-radius:9px;text-align:center;display:block;margin-top:6px}
    button[disabled]{opacity:.5;cursor:default}.err{color:#ff8a7a}.x{margin-left:auto;cursor:pointer;color:#8a939b;font-weight:400}
  </style>
  <div class="box"><div class="t"><span class="dot"></span>Termékradar<span class="x" title="Bezárás">×</span></div>
  <div class="msg">Vásárlói vélemények mentése a Termékradarba.</div><div class="bar"><i></i></div>
  <button type="button">Vélemények mentése</button></div>`;
  document.documentElement.append(host);
  const msg = root.querySelector(".msg"), bar = root.querySelector(".bar i"), btn = root.querySelector("button");
  root.querySelector(".x").onclick = () => host.remove();
  const say = (t, err) => { msg.textContent = t; msg.className = "msg" + (err ? " err" : ""); };

  async function run() {
    btn.disabled = true;
    const seen = new Map();
    let summary = null, errors = 0;
    const plan = PLAN.map(p => p.slice());
    const totalCap = plan.reduce((a, p) => a + p[2], 0);
    let done = 0;
    for (const [ft, fv, cap, label] of plan) {
      let got = 0, page = 1;
      while (got < cap) {
        say(`Vélemények olvasása: ${label}… (${seen.size} eddig)`);
        let res = null;
        for (let a = 0; a < 3; a++) {
          res = await ask({ product_id: PID, page_start: page, page_size: SIZE, sort_rule: 2,
                            review_filter: { filter_type: ft, filter_value: fv }, component_name: "product_review" });
          if (res && res.code === 0) break;
          await sleep(1200 * (a + 1));
        }
        if (!res || res.code !== 0) { errors++; break; }
        const data = res.data || {};
        if (!summary && data.review_ratings) summary = data.review_ratings;
        const items = data.product_reviews || [];
        for (const r of items) { const p = parse(r); if (p && !seen.has(p.review_id)) seen.set(p.review_id, p); }
        got += items.length; done += items.length;
        bar.style.width = Math.min(95, Math.round(done / totalCap * 90)) + "%";
        if (!items.length || !data.has_more) break;
        page++;
        await sleep(350);
      }
    }
    if (!seen.size) {
      say(errors ? "A TikTok most nem adta ki a véleményeket. Frissítsd az oldalt, és próbáld újra." : "Ennek a terméknek még nincs véleménye.", !!errors);
      btn.disabled = false; return;
    }
    say(`${seen.size} vélemény megvan. Képek kicsinyítése és mentés…`);
    const reply = await chrome.runtime.sendMessage({ cmd: "save", pid: PID, summary, reviews: [...seen.values()] });
    bar.style.width = "100%";
    if (reply && reply.ok) {
      say(`Kész: ${reply.saved} vélemény mentve${reply.images ? `, ${reply.images} képpel` : ""}. Visszamehetsz a Termékradarba, ott már látszik.`);
      btn.textContent = "Újra mentés";
    } else {
      say(reply && reply.error ? reply.error : "Nem sikerült menteni.", true);
    }
    btn.disabled = false;
  }
  btn.onclick = run;
  if (/tr-reviews/.test(location.hash)) setTimeout(run, 2500);
})();
