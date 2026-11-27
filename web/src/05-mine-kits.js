
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
