-- Paged website (2026-11-27): the database filters, sorts and pages every list, so the browser only loads 50 rows at a time.
--   tiktok_watch.shop_list      one flat row per product with everything the product list and filters need (rebuilt after each metrics refresh)
--   public.tr_boot()            settings, last run per job, category names
--   public.tr_shop_page(p)      products: filters, segment counts, niche counts, KPIs, categories, 50 rows
--   public.tr_videos_page(p)    videos: segment counts, 50 rows
--   public.tr_fb_ads_page(p)    Facebook ads: 50 rows
--   public.tr_runs_page(p)      run log: 50 rows
--   public.tr_save_ui(k, v)     saved filters etc. (settings keys starting with ui_)
--   public.tr_refresh_rows(ids) rebuild some rows of shop_list (a product that was just added)

create table if not exists tiktok_watch.shop_list (
  product_id text primary key,
  listed boolean not null default false,
  ord bigint,
  niche text, focus text, title text, shop_name text, seller_id text, category_id text, category_name text,
  url text, image text, price numeric, price_original numeric, rating numeric, reviews integer,
  sold_now bigint, sold_checked_at timestamptz, sold_per_day numeric, sold_per_day_week numeric, revenue_per_day numeric,
  growth_pct numeric, sold_per_day_prev numeric, trend numeric, sold_per_day_recent numeric,
  other_shops integer, twin_shops jsonb, gallery_count integer, video_count integer, video_views bigint, video_likes bigint,
  fresh_videos bigint, fresh_views numeric, newest_video timestamptz, first_seen timestamptz, last_seen timestamptz,
  spark integer[], spark_recent numeric, spark_before numeric, spark_chg numeric, sold_7d numeric,
  brand text, wtype text, search text,
  built_at timestamptz not null default now());
alter table tiktok_watch.shop_list enable row level security;
create index if not exists shop_list_niche_idx on tiktok_watch.shop_list (niche);

-- women's clothing type from a title (first matching rule wins), null when none matches
create or replace function tiktok_watch.wtype_of(t text) returns text
language sql immutable set search_path to '' as $$
  select case
    when t is null or t = '' then null
    when t ~* '\y(tights|pantyhose|stockings?)\y' then 'tights'
    when t ~* '\y(shapewear|faja|fajas|waist trainers?|waist cincher|body shaper|shaper|butt lifter|girdle)\y' then 'shape'
    when t ~* '\y(scrubs?|medical uniform|nursing scrub)\y' then 'work'
    when t ~* '\y(bras?|bralettes?|brassieres?|nipple covers?|pasties)\y' then 'bra'
    when t ~* '\y(pajamas?|pyjamas?|pjs?|sleepwear|nightgown|nightdress|nightwear|robe|bathrobe|loungewear|lounge set)\y' then 'sleep'
    when t ~* '\y(panties|panty|underwear|briefs?|thongs?|lingerie|boyshorts?|hipster|knickers)\y' then 'under'
    when t ~* '\y(2[- ]?piece|two[- ]pieces?|3[- ]?piece|co-?ord|matching sets?|sets?)\y' then 'set'
    when t ~* '\y(jumpsuits?|rompers?|overalls?|onesie|playsuit)\y' then 'jump'
    when t ~* '\y(dress|dresses|sundress|gown)\y' and t ~* '\y(party|club|cocktail|evening|formal|sequins?|prom|wedding|bridesmaid|homecoming|gala|night out|birthday)\y' then 'party'
    when t ~* '\y(dress|dresses|sundress|gown)\y' then 'dress'
    when t ~* '\y(skirts?|skorts?)\y' then 'skirt'
    when t ~* '\yshorts\y' then 'shorts'
    when t ~* '\yleggings?\y' then 'leggings'
    when t ~* '\y(jackets?|coats?|blazers?|puffer|parka|(puffer|fleece|sherpa|quilted|down) vest|gilet|outerwear|shacket)\y' then 'coat'
    when t ~* '\y(sweaters?|cardigans?|jumper|hoodies?|sweatshirts?|pullover|knitwear)\y' then 'knit'
    when t ~* '\y(jeans?|denim)\y' then 'jeans'
    when t ~* '\y(pants|trousers|joggers|sweatpants|culottes|palazzo|wide[- ]leg)\y' then 'pants'
    when t ~* '\y(tanks?|cami|camis|camisole|sleeveless|halter|tube top|strapless top|corset top|bustier)\y' then 'sleeveless'
    when t ~* '\ylong[- ]?sleeves?' then 'long'
    when t ~* '\y(t-?shirts?|tees?|short[- ]?sleeves?)' then 'short'
    when t ~* '\y(tops?|blouses?|shirts?|bodysuits?|crop)\y' then 'top'
  end $$;

create or replace function tiktok_watch.build_shop_list(only_ids text[] default null) returns void
language plpgsql security definer set search_path to '' set statement_timeout to '200s' as $$
declare
  brands text[];
  amb text[] := array['dash','bear','snow','instant','ring','bella','pink','alo','express','garage','target','coach','guess'];
  re text;
begin
  select array(select jsonb_array_elements_text(value)) into brands from tiktok_watch.settings where key = 'known_brands' and jsonb_typeof(value) = 'array';
  if brands is null or cardinality(brands) = 0 then
    brands := array['VEVOR','Merach','Anker','Soundcore','eufy','Ninja','Shark','SharkNinja','Dyson','Bissell','Hoover','iRobot','Roborock','Tineco','Keurig','Cuisinart','KitchenAid','Hamilton Beach','Instant Pot','Instant','COSORI','Chefman','BLACK+DECKER','DEWALT','Milwaukee','Makita','Ryobi','Bosch','Philips','Braun','Oral-B','Waterpik','Conair','Revlon','Remington','Wahl','Andis','BaBylissPRO','Laifen','Panasonic','Samsung','Apple','JBL','Sony','Bose','Beats','Logitech','Garmin','Fitbit','Coleman','YETI','Stanley','Hydro Flask','Owala','Lodge','OXO','Rubbermaid','Sunbeam','Igloo','Theragun','Therabody','Hyperice','RENPHO','Bowflex','Gorilla Grip','Amazon Basics','LEGO','Hasbro','Mattel','Nerf','Fisher-Price','Crayola','Furbo','PetSafe','Cricut','BlendJet','Medicube','Govee','TP-Link','Ring','Blink','Wyze','Ecovacs','Dreame','Xiaomi','Ugreen','Baseus','Belkin','OtterBox','Spigen','Casetify','Shokz','Soundpeats','Sterilite','Mueller','Gourmia','Bella','Dash','Bear','AquaSonic','Snow','Crest','Sol de Janeiro','CeraVe','Olaplex','T3','GHD'];
  end if;
  select '^(' || string_agg(regexp_replace(b, '([.*+?^${}()|\[\]\\])', '\\\1', 'g'), '|' order by length(b) desc) || ')(?![a-z0-9])'
    into re from unnest(brands) b where lower(b) <> all(amb) and b <> '';

  create temp table _bn on commit drop as
    select b, regexp_replace(lower(b), '[^a-z0-9]', '', 'g') nb from unnest(brands) b where regexp_replace(lower(b), '[^a-z0-9]', '', 'g') <> '';

  create temp table _sl on commit drop as
  with lst as (select product_id, ord from tiktok_watch.listed_ids()),
  src as (
    select p.*, l.ord, m.sold_now m_sold_now, m.sold_checked_at, m.sold_per_day, m.sold_per_day_week, m.growth_pct, m.sold_per_day_prev, m.trend,
           m.sold_per_day_recent, m.fresh_videos, m.fresh_views, m.newest_video, sp.spark,
           regexp_replace(lower(coalesce(p.shop_name, '')), '[^a-z0-9]', '', 'g') shopn,
           regexp_replace(coalesce(p.title, ''), '^(\s|【[^】]*】|\[[^\]]*\]|\([^)]*\))+', '') title_clean
    from tiktok_watch.shop_products p
    left join lst l using (product_id)
    left join tiktok_watch.shop_metrics m using (product_id)
    left join tiktok_watch.shop_spark sp using (product_id)
    where only_ids is null or p.product_id = any(only_ids))
  select s.product_id, (s.ord is not null) listed, s.ord, s.niche, s.focus, s.title, s.shop_name, s.seller_id, s.category_id, s.category_name,
         s.url, s.image, s.price, s.price_original, s.rating, s.reviews,
         coalesce(s.m_sold_now, s.last_sold) sold_now, s.sold_checked_at, s.sold_per_day, s.sold_per_day_week, round(s.price * s.sold_per_day) revenue_per_day,
         s.growth_pct, s.sold_per_day_prev, s.trend, s.sold_per_day_recent,
         s.other_shops, to_jsonb(s.twin_shops) twin_shops, s.gallery_count, s.video_count, s.video_views, s.video_likes,
         s.fresh_videos, s.fresh_views, s.newest_video, s.first_seen, s.last_seen,
         s.spark, k.recent spark_recent, k.before spark_before,
         case when k.cnt >= 3 then case when k.before > 0 then (k.recent - k.before) / k.before * 100 when k.recent > 0 then 999 end end spark_chg,
         case when k.cnt >= 3 then k.s7 end sold_7d,
         coalesce(
           (select bn.b from _bn bn where s.shopn <> '' and (bn.nb = s.shopn or bn.nb || 'official' = s.shopn or bn.nb || 'officialstore' = s.shopn or bn.nb || 'store' = s.shopn
              or bn.nb || 'us' = s.shopn or bn.nb || 'usa' = s.shopn or bn.nb || 'direct' = s.shopn or bn.nb || 'shop' = s.shopn) limit 1),
           case when re is not null then substring(s.title_clean from '(?i)' || re) end) brand,
         coalesce(tiktok_watch.wtype_of(regexp_replace(coalesce(s.title, ''), '【[^】]*】', ' ', 'g')), tiktok_watch.wtype_of(s.category_name), 'other') wtype,
         lower(coalesce(s.title, '') || ' ' || coalesce(s.shop_name, '') || ' ' || coalesce(s.category_name, '')) search
  from src s
  left join lateral (
    select (select avg(v) from unnest(s.spark[11:14]) v) recent,
           (select avg(v) from unnest(s.spark[4:10]) v) before,
           (select sum(v) from unnest(s.spark[8:14]) v) s7,
           (select count(v) from unnest(s.spark) v) cnt) k on true;

  if only_ids is null then
    delete from tiktok_watch.shop_list;
  else
    delete from tiktok_watch.shop_list where product_id = any(only_ids);
  end if;
  insert into tiktok_watch.shop_list (product_id, listed, ord, niche, focus, title, shop_name, seller_id, category_id, category_name, url, image, price, price_original,
      rating, reviews, sold_now, sold_checked_at, sold_per_day, sold_per_day_week, revenue_per_day, growth_pct, sold_per_day_prev, trend, sold_per_day_recent,
      other_shops, twin_shops, gallery_count, video_count, video_views, video_likes, fresh_videos, fresh_views, newest_video, first_seen, last_seen,
      spark, spark_recent, spark_before, spark_chg, sold_7d, brand, wtype, search, built_at)
  select product_id, listed, ord, niche, focus, title, shop_name, seller_id, category_id, category_name, url, image, price, price_original,
      rating, reviews, sold_now, sold_checked_at, sold_per_day, sold_per_day_week, revenue_per_day, growth_pct, sold_per_day_prev, trend, sold_per_day_recent,
      other_shops, twin_shops, gallery_count, video_count, video_views, video_likes, fresh_videos, fresh_views, newest_video, first_seen, last_seen,
      spark, spark_recent, spark_before, spark_chg, sold_7d, brand, wtype, search, now()
  from _sl;
end $$;

-- same as before, plus the flat list for the website at the end
create or replace function tiktok_watch.refresh_shop_metrics() returns void
language plpgsql security definer set search_path to '' set statement_timeout to '240s' as $$
declare s jsonb; a text[]; b text[];
begin
  refresh materialized view concurrently tiktok_watch.shop_metrics;
  begin
    perform tiktok_watch.build_shop_spark();
  exception when others then
    raise warning 'shop_spark failed: %', sqlerrm;
  end;
  s := tiktok_watch.shop_rows(null);
  select coalesce(array_agg(product_id order by product_id) filter (where starred), '{}'), coalesce(array_agg(product_id order by product_id) filter (where hidden), '{}')
    into a, b from tiktok_watch.shop_products where starred or hidden;
  insert into tiktok_watch.load_cache (id, shop, ids, st, hd, built_at, lite)
  values (1, s, array(select e->>'product_id' from jsonb_array_elements(s) e), a, b, now(), tiktok_watch.shop_rows_lite(null))
  on conflict (id) do update set shop = excluded.shop, ids = excluded.ids, st = excluded.st, hd = excluded.hd, built_at = excluded.built_at, lite = excluded.lite;
  begin
    perform tiktok_watch.build_shop_list(null);
  exception when others then
    raise warning 'shop_list failed: %', sqlerrm;
  end;
end $$;

create or replace function public.tr_refresh_rows(p_ids text[]) returns void
language plpgsql security definer set search_path to '' as $$
begin
  perform public.tr_guard();
  perform tiktok_watch.build_shop_list(p_ids);
end $$;

create or replace function public.tr_boot() returns json
language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.tr_guard();
  return json_build_object(
    'settings', (select coalesce(json_object_agg(key, value), '{}'::json) from tiktok_watch.settings),
    'last_runs', (select coalesce(json_agg(r), '[]'::json) from (
       select distinct on (job) id, job, started_at, finished_at, ok, error from tiktok_watch.runs order by job, started_at desc) r),
    'categories', (select coalesce(json_object_agg(category_id, category_name), '{}'::json) from (
       select distinct on (category_id) category_id, category_name from tiktok_watch.shop_list where category_id is not null and category_name is not null) c),
    'built_at', (select max(built_at) from tiktok_watch.shop_list));
end $$;

create or replace function public.tr_save_ui(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path to '' as $$
begin
  perform public.tr_guard();
  if p_key !~ '^ui_[a-z_]{1,40}$' then raise exception 'bad key'; end if;
  insert into tiktok_watch.settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- p: {niche, seg, q, cat, sort, dir, page, f: {...filters}}
create or replace function public.tr_shop_page(p jsonb) returns json
language plpgsql stable security definer set search_path to '' as $$
declare
  v_seg text := coalesce(nullif(p->>'seg', ''), 'all');
  v_sort text := coalesce(nullif(p->>'sort', ''), 'revenue_per_day');
  v_dir text := case when p->>'dir' = 'asc' then 'asc' else 'desc' end;
  v_page int := greatest(coalesce((p->>'page')::int, 0), 0);
  v_q text := lower(trim(coalesce(p->>'q', '')));
  v_words text[];
  st jsonb;
  res json;
begin
  perform public.tr_guard();
  if v_seg not in ('all','hot','win','rising','accel','multi','starred','new','brand','hidden') then v_seg := 'all'; end if;
  if v_sort not in ('revenue_per_day','sold_per_day','spark_chg','sold_7d','growth_pct','trend','sold_per_day_recent','sold_per_day_week','sold_now',
                    'video_views','video_count','fresh_videos','other_shops','price','rating','reviews','first_seen','title') then v_sort := 'revenue_per_day'; end if;
  v_words := case when length(v_q) >= 2 then regexp_split_to_array(v_q, '\s+') end;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into st from tiktok_watch.settings
   where key in ('shop_min_price','shop_max_price','shop_min_revenue_day','hot_video_days','niches');

  execute format($q$
    with bands as (
      select e->>'key' k, (e->>'min_price')::numeric lo, (e->>'max_price')::numeric hi
      from jsonb_array_elements(case when jsonb_typeof($2->'niches') = 'array' then $2->'niches' else '[]'::jsonb end) e),
    base as (
      select l.*, sp.starred, sp.hidden, sl.sold_count store_sold, sl.sold_per_day store_per_day, sl.tracked_per_day store_tracked, sl.added_total store_added, sl.url store_url,
        ($3 is not null or (l.price is not null
          and l.price >= coalesce(($1->'f'->>'price_min')::numeric, b.lo, ($2->>'shop_min_price')::numeric, 30)
          and l.price <= coalesce(($1->'f'->>'price_max')::numeric, b.hi, ($2->>'shop_max_price')::numeric, 70))) in_band,
        (l.sold_per_day > 0 and (l.trend >= 1 or l.sold_per_day_recent >= l.sold_per_day or l.growth_pct >= 2)) growing,
        case coalesce($1->'f'->>'brand', 'hide') when 'show' then true when 'only' then l.brand is not null else (l.brand is null or $3 is not null) end brand_ok
      from tiktok_watch.shop_list l
      join tiktok_watch.shop_products sp using (product_id)
      left join tiktok_watch.stores sl on sl.seller_id = l.seller_id
      left join bands b on b.k = l.niche
      where case when $3 is null then (l.listed or sp.starred)
                 else (select bool_and(l.search like '%%' || w || '%%') from unnest($3) w) end
        and ($1->>'cat' is null or $1->>'cat' = '' or (case when $1->>'cat' like 't:%%' then l.wtype = substr($1->>'cat', 3) else l.category_id = $1->>'cat' end))
        and (jsonb_typeof($1->'f'->'cats') is distinct from 'array' or jsonb_array_length($1->'f'->'cats') = 0 or l.category_id in (select jsonb_array_elements_text($1->'f'->'cats')))
        and (($1->'f'->>'sold_min') is null or l.sold_per_day >= ($1->'f'->>'sold_min')::numeric)
        and (($1->'f'->>'sold_max') is null or l.sold_per_day <= ($1->'f'->>'sold_max')::numeric)
        and (($1->'f'->>'week_min') is null or l.sold_per_day_week >= ($1->'f'->>'week_min')::numeric)
        and (($1->'f'->>'week_max') is null or l.sold_per_day_week <= ($1->'f'->>'week_max')::numeric)
        and (($1->'f'->>'rev_min') is null or l.revenue_per_day >= ($1->'f'->>'rev_min')::numeric)
        and (($1->'f'->>'rev_max') is null or l.revenue_per_day <= ($1->'f'->>'rev_max')::numeric)
        and (($1->'f'->>'total_min') is null or l.sold_now >= ($1->'f'->>'total_min')::numeric)
        and (($1->'f'->>'total_max') is null or l.sold_now <= ($1->'f'->>'total_max')::numeric)
        and (($1->'f'->>'growth_min') is null or l.growth_pct >= ($1->'f'->>'growth_min')::numeric)
        and (($1->'f'->>'trend_min') is null or l.spark_chg >= ($1->'f'->>'trend_min')::numeric)
        and (coalesce(($1->'f'->>'accel')::boolean, false) = false or (l.trend > 1.2))
        and (coalesce(($1->'f'->>'rising')::boolean, false) = false or (l.growth_pct >= 5))
        and (($1->'f'->>'rating_min') is null or l.rating >= ($1->'f'->>'rating_min')::numeric)
        and (($1->'f'->>'reviews_min') is null or l.reviews >= ($1->'f'->>'reviews_min')::numeric)
        and (($1->'f'->>'shops') is null or ($1->'f'->>'shops' = 'one' and coalesce(l.other_shops, 0) = 0) or ($1->'f'->>'shops' = 'multi' and l.other_shops > 0))
        and (($1->'f'->>'vids_min') is null or l.video_count >= ($1->'f'->>'vids_min')::numeric)
        and (($1->'f'->>'vids_max') is null or coalesce(l.video_count, 0) <= ($1->'f'->>'vids_max')::numeric)
        and (($1->'f'->>'views_min') is null or l.video_views >= ($1->'f'->>'views_min')::numeric)
        and (($1->'f'->>'fresh_min') is null or l.fresh_videos >= ($1->'f'->>'fresh_min')::numeric)
        and (($1->'f'->>'found_days') is null or l.first_seen > now() - (($1->'f'->>'found_days')::numeric * interval '1 day'))
        and (($1->'f'->>'seen_days') is null or l.last_seen > now() - (($1->'f'->>'seen_days')::numeric * interval '1 day'))),
    f as (
      select b.*,
        (not hidden and brand_ok and (in_band or starred)) s_all,
        hidden s_hidden,
        (not hidden and starred) s_starred,
        (not hidden and brand is not null and in_band) s_brand
      from base b),
    g as (
      select f.*,
        (s_all and coalesce(fresh_videos, 0) > 0 and growing) s_hot,
        (s_all and revenue_per_day >= coalesce(($2->>'shop_min_revenue_day')::numeric, 1000)) s_win,
        (s_all and growth_pct >= 5) s_rising,
        (s_all and trend > 1.2 and sold_per_day >= 10) s_accel,
        (s_all and other_shops > 0) s_multi,
        (s_all and first_seen > now() - interval '30 hours') s_new
      from f where ($1->>'niche' is null or $1->>'niche' = '' or niche = $1->>'niche'))
    select json_build_object(
      'total', (select count(*) from g where s_%1$s),
      'page', $4, 'size', 50,
      'segs', (select json_build_object('all', count(*) filter (where s_all), 'hot', count(*) filter (where s_hot), 'win', count(*) filter (where s_win),
          'rising', count(*) filter (where s_rising), 'accel', count(*) filter (where s_accel), 'multi', count(*) filter (where s_multi),
          'starred', count(*) filter (where s_starred), 'new', count(*) filter (where s_new), 'brand', count(*) filter (where s_brand),
          'hidden', count(*) filter (where s_hidden)) from g),
      'niches', (select coalesce(json_object_agg(coalesce(niche, ''), json_build_object('n', n, 'rev', rev)), '{}'::json) from (
          select niche, count(*) n, sum(coalesce(revenue_per_day, 0)) rev from f where s_all group by niche) x),
      'kpis', (select json_build_object('live', count(*) filter (where s_all), 'win', count(*) filter (where s_win), 'hot', count(*) filter (where s_hot),
          'rev', sum(revenue_per_day) filter (where s_all),
          'best_rev', max(revenue_per_day) filter (where s_all),
          'best_title', (select title from g g2 where s_all and revenue_per_day is not null order by revenue_per_day desc limit 1),
          'best_id', (select product_id from g g2 where s_all and revenue_per_day is not null order by revenue_per_day desc limit 1)) from g),
      'cats', (select coalesce(json_agg(c order by c.name), '[]'::json) from (
          select category_id id, max(category_name) name, count(*) n from g where not hidden and category_id is not null group by category_id) c),
      'wtypes', (select coalesce(json_agg(w order by w.rev desc), '[]'::json) from (
          select wtype k, count(*) n, sum(coalesce(revenue_per_day, 0)) rev from g where s_all group by wtype) w),
      'rows', (select coalesce(json_agg(r), '[]'::json) from (
          select product_id, niche, focus, title, shop_name, seller_id, category_id, category_name, url, image, price, price_original, rating, reviews,
                 sold_now, sold_checked_at, sold_per_day, sold_per_day_week, revenue_per_day, growth_pct, sold_per_day_prev, trend, sold_per_day_recent,
                 other_shops, twin_shops, gallery_count, video_count, video_views, video_likes, fresh_videos, fresh_views, newest_video,
                 first_seen, last_seen, spark, spark_recent, spark_before, spark_chg, sold_7d, brand, wtype, starred, hidden,
                 store_sold, store_per_day, store_tracked, store_added, store_url
          from g where s_%1$s
          order by %2$I %3$s nulls last, sold_now desc nulls last, product_id
          limit 50 offset $4 * 50) r))
  $q$, v_seg, v_sort, v_dir) into res using p, st, v_words, v_page;
  return res;
end $$;

-- p: {seg, q, sort, page}
create or replace function public.tr_videos_page(p jsonb) returns json
language plpgsql stable security definer set search_path to '' as $$
declare
  v_seg text := coalesce(nullif(p->>'seg', ''), 'tracking');
  v_sort text := coalesce(nullif(p->>'sort', ''), 'recent_views_per_hour');
  v_page int := greatest(coalesce((p->>'page')::int, 0), 0);
  v_q text := lower(trim(coalesce(p->>'q', '')));
  res json;
begin
  perform public.tr_guard();
  if v_seg not in ('tracking','accel','starred','out','hidden') then v_seg := 'tracking'; end if;
  if v_sort not in ('recent_views_per_hour','acceleration','product_sold_per_day','views','newest') then v_sort := 'recent_views_per_hour'; end if;
  execute format($q$
    with v as (
      select s.*, (not hidden and status = 'tracking') s_tracking, (not hidden and status = 'tracking' and acceleration > 1) s_accel,
             (not hidden and starred) s_starred, (not hidden and status <> 'tracking') s_out, hidden s_hidden,
             created_at_tt newest
      from tiktok_watch.video_scores s
      where $1 = '' or lower(coalesce(product_title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(author, '')) like '%%' || $1 || '%%')
    select json_build_object(
      'total', (select count(*) from v where s_%1$s), 'page', $2, 'size', 50,
      'segs', (select json_build_object('tracking', count(*) filter (where s_tracking), 'accel', count(*) filter (where s_accel),
               'starred', count(*) filter (where s_starred), 'out', count(*) filter (where s_out), 'hidden', count(*) filter (where s_hidden)) from v),
      'rows', (select coalesce(json_agg(r), '[]'::json) from (
          select video_id, url, author, description, product_title, status, created_at_tt, age_hours, views, likes, comments, shares,
                 avg_views_per_hour, recent_views_per_hour, acceleration, starred, hidden, product_id, product_url, product_image,
                 product_category, product_price, product_sold, product_sold_per_day
          from v where s_%1$s order by %2$I desc nulls last, video_id limit 50 offset $2 * 50) r))
  $q$, v_seg, v_sort) into res using v_q, v_page;
  return res;
end $$;

-- p: {niche, page_id, q, min_days, active, shop, sort, page}
create or replace function public.tr_fb_ads_page(p jsonb) returns json
language plpgsql stable security definer set search_path to '' as $$
declare
  v_sort text := coalesce(nullif(p->>'sort', ''), 'score');
  v_page int := greatest(coalesce((p->>'page')::int, 0), 0);
  res json;
begin
  perform public.tr_guard();
  if v_sort not in ('score','days','variants','new','likes') then v_sort := 'score'; end if;
  execute format($q$
    with a as (
      select x.*, (wp.page_id is not null) watched,
             greatest(0, round(extract(epoch from (case when x.end_date is not null and not coalesce(x.is_active, true) then x.end_date else now() end) - x.start_date) / 86400))::int days
      from tiktok_watch.fb_ads x left join tiktok_watch.fb_pages wp on wp.page_id = x.page_id
      where case when nullif($1->>'page_id', '') is not null then x.page_id = $1->>'page_id'
                 else (nullif($1->>'niche', '') is null or x.niche = $1->>'niche') and x.last_seen > now() - interval '30 days' end),
    b as (
      select a.*, coalesce(days, 0) * (1 + log(2::numeric, greatest(1, coalesce(collation_count, 1))::numeric)) score,
             coalesce(collation_count, 0) variants, start_date new, coalesce(page_likes, 0) likes
      from a
      where (nullif($1->>'page_id', '') is not null or (
              (coalesce(($1->>'active')::boolean, true) = false or is_active is distinct from false)
          and coalesce(days, 0) >= coalesce(($1->>'min_days')::int, 0)
          and (coalesce(($1->>'shop')::boolean, true) = false or (link_url is not null and domain is not null
               and (domain || '.') !~* '(^|\.)(facebook|instagram|fb|m\.me|messenger|whatsapp|linktr|linktree|apple|google|youtube|tiktok|amazon)\.'))))
        and (coalesce($1->>'q', '') = '' or lower(concat_ws(' ', title, body, page_name, domain, array_to_string(queries, ' '))) like '%%' || lower($1->>'q') || '%%'))
    select json_build_object('total', (select count(*) from b), 'page', $2, 'size', 50,
      'rows', (select coalesce(json_agg(r), '[]'::json) from (
        select ad_archive_id id, page_id, page_name, page_likes, page_url, start_date, end_date, is_active, collation_count, link_url, domain, title,
               left(body, 600) body, cta, display_format, image_url, video_url, video_preview, image_key, video_key, poster_key, niche, days, watched
        from b order by %1$I desc nulls last, ad_archive_id limit 50 offset $2 * 50) r))
  $q$, v_sort) into res using p, v_page;
  return res;
end $$;

-- p: {page, job}
create or replace function public.tr_runs_page(p jsonb) returns json
language plpgsql stable security definer set search_path to '' as $$
declare v_page int := greatest(coalesce((p->>'page')::int, 0), 0); v_job text := nullif(p->>'job', '');
begin
  perform public.tr_guard();
  return json_build_object(
    'total', (select count(*) from tiktok_watch.runs where v_job is null or job = v_job), 'page', v_page, 'size', 50,
    'jobs', (select coalesce(json_agg(distinct job), '[]'::json) from tiktok_watch.runs),
    'rows', (select coalesce(json_agg(r), '[]'::json) from (
       select id, job, started_at, finished_at, ok, stats, error from tiktok_watch.runs
       where v_job is null or job = v_job order by started_at desc limit 50 offset v_page * 50) r));
end $$;

revoke all on function public.tr_shop_page(jsonb), public.tr_videos_page(jsonb), public.tr_fb_ads_page(jsonb), public.tr_runs_page(jsonb),
  public.tr_boot(), public.tr_save_ui(text, jsonb), public.tr_refresh_rows(text[]) from public, anon;
grant execute on function public.tr_shop_page(jsonb), public.tr_videos_page(jsonb), public.tr_fb_ads_page(jsonb), public.tr_runs_page(jsonb),
  public.tr_boot(), public.tr_save_ui(text, jsonb), public.tr_refresh_rows(text[]) to authenticated;
revoke all on function tiktok_watch.build_shop_list(text[]), tiktok_watch.wtype_of(text) from public, anon, authenticated;
