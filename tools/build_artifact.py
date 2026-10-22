"""Build the in-chat (claude.ai artifact) version of the web app from web/.

Same page and code as the Netlify site, but data goes through the viewer's Supabase connector
(MCP execute_sql) instead of supabase-js, so no login is needed inside claude.ai. Usage:
    python tools/build_artifact.py OUT.html
"""
import pathlib
import re
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
OWNER_ID = "cc3eacba-3ef9-4d71-8a63-88b3849c21f0"   # the owner's auth user id, so the tr_* guard lets the calls through
SET_FUNCS = {"tr_gallery", "tr_thumbs"}               # set-returning functions

SHIM = r"""
<script>
// In-chat data layer: the tr_* functions through the Supabase connector (execute_sql).
(() => {
  const PROJECT = "sapxyvfiqyshwnwarctj", SERVER = "Supabase";
  const SET_FUNCS = new Set(%SETS%);
  const CLAIMS = %CLAIMS%;
  let mcpP = null;
  const getMcp = () => mcpP || (mcpP = (window.claude && window.claude.use ? window.claude.use("mcp") : Promise.resolve(null)));
  const lit = (v) => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number" && isFinite(v)) return String(v);
    if (Array.isArray(v) && v.every(x => typeof x === "string")) return "array[" + v.map(lit).join(",") + "]::text[]";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return "'" + s.replace(/'/g, "''") + "'";
  };
  function parse(payload) {
    let text = typeof payload === "string" ? payload : (payload && typeof payload.result === "string" ? payload.result : null);
    if (text == null) { if (Array.isArray(payload)) return payload; text = JSON.stringify(payload); }
    const m = text.match(/<untrusted-data-[^>]*>\s*(\[[\s\S]*\])\s*<\/untrusted-data/);
    return JSON.parse(m ? m[1] : text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  }
  const MSG = {
    needs_reauth: "A Supabase kapcsolat lejárt. Csatlakoztasd újra a claude.ai Beállítások, Connectors menüben.",
    server_not_connected: "Ehhez az oldalhoz a Supabase connector kell (claude.ai Beállítások, Connectors).",
    selection_required: "Ehhez az oldalhoz a Supabase connector kell (claude.ai Beállítások, Connectors).",
    not_in_manifest: "Az oldal nem kapott engedélyt a Supabase eléréséhez (az oldal Permissions menüje).",
    consent_required: "Az oldal nem kapott engedélyt a Supabase eléréséhez (az oldal Permissions menüje).",
    server_unavailable: "A Supabase most nem válaszol. Próbáld újra pár perc múlva.",
  };
  async function rpc(fn, args) {
    const mcp = await getMcp();
    if (!mcp) return { data: null, error: { message: "Ez a változat csak a claude.ai-ban megnyitva működik." } };
    const a = Object.entries(args || {}).map(([k, v]) => k + " => " + lit(v)).join(", ");
    const call = "public." + fn + "(" + a + ")";
    const expr = SET_FUNCS.has(fn) ? "(select coalesce(json_agg(t), '[]'::json) from " + call + " t)" : "to_json(" + call + ")";
    const query = "select set_config('request.jwt.claims', " + lit(CLAIMS) + ", true); select (" + expr + ")::text as r;";
    try {
      let res;
      try { res = await mcp.callTool(SERVER, "execute_sql", { project_id: PROJECT, query }, { cache: false }); }
      catch (e) { if (e && e.retryable) { await new Promise(r => setTimeout(r, (e.retryAfterMs || 1500))); res = await mcp.callTool(SERVER, "execute_sql", { project_id: PROJECT, query }, { cache: false }); } else throw e; }
      const rows = parse(res.payload ?? (res.content && res.content[0] && res.content[0].text));
      const r = rows && rows[0] ? rows[0].r : null;
      return { data: r == null ? null : JSON.parse(r), error: null };
    } catch (e) {
      return { data: null, error: { code: e && e.code, message: (e && MSG[e.code]) || (e && e.message) || "ismeretlen hiba" } };
    }
  }
  const session = { user: { email: "claude.ai (connector)" } };
  const auth = {
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session } }; },
    async signOut() { return { error: null }; },
  };
  for (const k of ["signUp", "signInWithPassword", "signInWithOAuth", "resetPasswordForEmail", "updateUser"])
    auth[k] = async () => ({ data: null, error: { message: "A belépés itt nem kell: a claude.ai Supabase connectorán keresztül fut." } });
  window.supabase = { createClient: () => ({ auth, rpc }) };
  window.TR_CONFIG = { supabaseUrl: "", supabaseKey: "" };
})();
</script>
"""


def main(out: str) -> None:
    html = (WEB / "index.html").read_text()
    css = (WEB / "app.css").read_text()
    js = (WEB / "app.js").read_text()
    body = html[html.index("<body>") + len("<body>"):html.index("</body>")]
    body = re.sub(r'\s*<script src="https://cdn\.jsdelivr\.net/npm/@supabase[^"]*"></script>', "", body)
    body = re.sub(r'\s*<script src="config\.js"></script>', "", body)
    body = re.sub(r'\s*<script src="app\.js"></script>', "", body)
    body = body.replace('href="termekradar-bovitmeny.zip"', 'href="https://termekradar-a69s.netlify.app/termekradar-bovitmeny.zip"')
    fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' \
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap">'
    shim = SHIM.replace("%SETS%", repr(sorted(SET_FUNCS)).replace("'", '"')) \
               .replace("%CLAIMS%", '\'{"sub":"%s","role":"authenticated"}\'' % OWNER_ID)
    page = f"<title>Termékradar</title>\n{fonts}\n<style>\n{css}\n#logout {{ display: none; }}\n</style>\n{body}\n{shim}\n<script>\n{js}\n</script>\n"
    pathlib.Path(out).write_text(page)
    print(out, len(page))


if __name__ == "__main__":
    main(sys.argv[1])
