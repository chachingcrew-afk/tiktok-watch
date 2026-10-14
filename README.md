# TikTok Watch

Naponta összegyűjti a 7 napnál fiatalabb, gyorsan növő nézettségű termékes TikTok videókat, és 6 óránként újramérik őket.

- `collect.py`: naponta 1x (07:47 nyári idő szerint). Végigmegy a trending feeden és a hashtageken, és elmenti azokat a videókat, amelyek:
  - 7 napnál fiatalabbak,
  - legalább 20 000 nézésük van,
  - átlagosan legalább 500 nézés/órával nőttek,
  - van rajtuk TikTok Shop termék, vagy a leírás/hashtagek termékre utalnak.
- `track.py`: 6 óránként újraméri az összes követett videót. Kiesik, ami 7 napnál idősebb lett, vagy aminek az utolsó 6 órás növekedése 300 nézés/óra alá esett (legalább 3 mérés után).

Az adatok a Supabase `ev-test-marketplace` projekt `tiktok_watch` sémájában vannak, külön a többi táblától.

## Beállítás (egyszer)

1. **GitHub repó:** hozz létre egy **privát** repót (pl. `tiktok-watch`), és töltsd fel ennek a mappának a tartalmát (a `.github` mappával együtt).
2. **Proxy:** regisztrálj egy residential proxyra (pl. Webshare, Residential csomag). A proxy URL így néz ki: `http://felhasznalo:jelszo@host:port`.
3. **MS_TOKEN:** nyisd meg a tiktok.com-ot Chrome-ban, F12 → Application → Cookies → `https://www.tiktok.com` → másold ki az `msToken` értékét. Ha a script blokkolva lesz, ezt érdemes először frissíteni.
4. **DATABASE_URL:** Supabase → `ev-test-marketplace` projekt → **Connect** gomb → **Session pooler** connection string. A `[YOUR-PASSWORD]` helyére a projekt adatbázis jelszava kerül.
5. **GitHub Secrets:** a repóban Settings → Secrets and variables → Actions → New repository secret. Ez a három kell: `DATABASE_URL`, `PROXY_URL`, `MS_TOKEN`.
6. **Első futtatás:** Actions fül → "Collect new videos (daily)" → Run workflow. A logban a végén látod, hány videót nézett át és mennyit mentett el.

## Beállítások

A beállításokat a **Termékradar** dashboard Beállítások fülén módosítod (hashtagek, minimum nézés, nézés/óra küszöbök, életkor, kiesési szabály). A scriptek minden futás elején az adatbázisból (`tiktok_watch.settings`) olvassák be őket, így a kódhoz nem kell nyúlni. A mentés a következő futásnál lép életbe.

Az időzítés (napi gyűjtés 07:47-kor, mérés 6 óránként) a `.github/workflows` fájlokban van.

## Eredmények

A `tiktok_watch.video_scores` nézet videónként kiszámolja:

- `recent_views_per_hour`: nézés/óra az utolsó két mérés között,
- `acceleration`: hányszor gyorsabb az utolsó 6 óra az előzőnél (1 fölött gyorsul),
- `growth_pct_last_check`: hány %-ot nőtt az utolsó mérés óta,
- `shares_per_1k`, `saves_per_1k`: megosztás és mentés 1000 nézésre (vásárlási szándék jele).

Top lista a Supabase SQL editorban:

```sql
select url, product_title, age_hours, views, recent_views_per_hour, acceleration, shares_per_1k
from tiktok_watch.video_scores
where status = 'tracking'
order by recent_views_per_hour desc nulls last
limit 50;
```

## Ha nem működik

- **"No videos returned" / EmptyResponseException:** a TikTok blokkol. Ellenőrizd a proxyt, és frissítsd az `MS_TOKEN`-t.
- **Hirtelen minden elromlik:** a TikTok változtatott valamit. Frissítsd a `TikTokApi` verziót a `requirements.txt`-ben a legújabbra.
