// Runs on the Termékradar site: hands the signed-in session to the extension, so it can save
// reviews as you (no separate login), and tells the site that the extension is installed.
(() => {
  const KEY = "sb-sapxyvfiqyshwnwarctj-auth-token";
  const VERSION = chrome.runtime.getManifest().version;
  function sendSession() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
    if (s && s.access_token) chrome.runtime.sendMessage({ cmd: "session", session: { access_token: s.access_token, expires_at: s.expires_at, email: s.user && s.user.email } });
  }
  sendSession();
  setInterval(sendSession, 60 * 1000);
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.src !== "tr-app") return;
    if (e.data.cmd === "ping") window.postMessage({ src: "tr-ext", cmd: "pong", version: VERSION }, location.origin);
    if (e.data.cmd === "session") sendSession();
  });
  window.postMessage({ src: "tr-ext", cmd: "pong", version: VERSION }, location.origin);
})();
