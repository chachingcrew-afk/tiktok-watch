// Runs in the TikTok Shop page itself: the review API only answers requests made by the page
// (with its own cookies), so the extension asks the page to make them.
(() => {
  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data || e.data.src !== "tr-ext-req") return;
    const { id, body } = e.data;
    let res;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch("/api/shop/pdp_desktop/get_product_reviews", {
        method: "POST", signal: ctl.signal, credentials: "include",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      clearTimeout(t);
      res = await r.json();
    } catch (err) {
      res = { code: -1, message: String(err) };
    }
    window.postMessage({ src: "tr-ext-res", id, res }, location.origin);
  });
})();
