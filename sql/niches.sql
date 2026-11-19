-- Niche grouping for the web app + 14-day daily sales sparkline (applied as migration niches_web)

create table if not exists tiktok_watch.shop_spark (product_id text primary key, spark int[] not null, built_at timestamptz not null default now());
alter table tiktok_watch.shop_spark enable row level security;

-- Daily units sold for the last 14 full days (oldest first, null where unknown), from the cumulative
-- sold snapshots of one source (the product's latest), gaps spread evenly over the days in between.
create or replace function tiktok_watch.build_shop_spark()
returns void language plpgsql security definer set search_path to '' set statement_timeout to '120s' as $$
begin
  create temp table _spark on commit drop as
  with src as (
    select distinct on (product_id) product_id, coalesce(source, 'page') src from tiktok_watch.product_snapshots
    where taken_at > now() - interval '17 days' and sold is not null order by product_id, taken_at desc),
  lastday as (
    select distinct on (s.product_id, s.taken_at::date) s.product_id, s.taken_at::date d, s.sold
    from tiktok_watch.product_snapshots s join src using (product_id)
    where s.taken_at > now() - interval '17 days' and s.sold is not null and coalesce(s.source, 'page') = src.src
    order by s.product_id, s.taken_at::date, s.taken_at desc),
  steps as (
    select product_id, d, sold, lag(d) over w pd, lag(sold) over w ps from lastday window w as (partition by product_id order by d)),
  days as (
    select st.product_id, g::date d, greatest(st.sold - st.ps, 0)::numeric / (st.d - st.pd) v
    from steps st cross join lateral generate_series(st.pd + 1, st.d, interval '1 day') g where st.pd is not null),
  grid as (select generate_series(current_date - 14, current_date - 1, interval '1 day')::date d)
  select p.product_id, array_agg(round(dy.v)::int order by grid.d) spark
  from (select distinct product_id from days) p cross join grid
  left join days dy on dy.product_id = p.product_id and dy.d = grid.d
  group by p.product_id;
  delete from tiktok_watch.shop_spark;
  insert into tiktok_watch.shop_spark (product_id, spark) select product_id, spark from _spark
   where exists (select 1 from unnest(spark) x where x is not null);
end $$;

-- which products the app lists: starred, plus the best 3000 (by revenue per day) of each niche seen in the last 3 weeks
create or replace function tiktok_watch.listed_ids()
returns table (product_id text, ord bigint) language sql stable security definer set search_path to '' as $$
  select product_id, row_number() over (order by starred desc, rev desc nulls last, last_sold desc nulls last) ord from (
    select p.product_id, p.starred, round(p.price * m.sold_per_day) rev, p.last_sold,
           row_number() over (partition by p.niche order by round(p.price * m.sold_per_day) desc nulls last, p.last_sold desc nulls last) rn
    from tiktok_watch.shop_products p left join tiktok_watch.shop_metrics m using (product_id)
    where p.starred or (p.niche is not null and p.retired_at is null and p.last_seen > now() - interval '21 days')) t
  where starred or rn <= 3000
$$;

create or replace function tiktok_watch.shop_rows_lite(only_ids text[] default null)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'k', jsonb_build_array('product_id','seller_id','title','category_id','category_name','shop_name','price','price_original','rating','reviews',
                           'sold_now','sold_per_day','sold_per_day_week','revenue_per_day','growth_pct','trend','sold_per_day_recent',
                           'focus','other_shops','video_count','video_views','fresh_videos','newest_video','first_seen','starred','hidden','niche','spark'),
    'r', coalesce(jsonb_agg(jsonb_build_array(product_id, seller_id, title, category_id, category_name, shop_name, price, price_original, rating, reviews,
                           sold_now, sold_per_day, sold_per_day_week, revenue_per_day, growth_pct, trend, sold_per_day_recent,
                           focus, other_shops, video_count, video_views, fresh_videos, newest_video, first_seen, starred, hidden, niche, spark) order by ord), '[]'::jsonb))
  from (
    select l.ord, p.product_id, p.seller_id, p.title, p.category_id, p.category_name, p.shop_name, p.price, p.price_original, p.rating, p.reviews,
           coalesce(m.sold_now, p.last_sold) as sold_now, m.sold_per_day, m.sold_per_day_week, round(p.price * m.sold_per_day) as revenue_per_day,
           m.growth_pct, m.trend, m.sold_per_day_recent, p.focus, p.other_shops, p.video_count, p.video_views,
           m.fresh_videos, m.newest_video, p.first_seen, p.starred, p.hidden, p.niche, sp.spark
    from (select product_id, ord from tiktok_watch.listed_ids() where only_ids is null
          union all select x, 0 from unnest(only_ids) x) l
    join tiktok_watch.shop_products p using (product_id)
    left join tiktok_watch.shop_metrics m using (product_id)
    left join tiktok_watch.shop_spark sp using (product_id)) t
$$;

-- old full rows (still used by the deployed site's tr_load): same product set
create or replace function tiktok_watch.shop_rows(only_ids text[] default null)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from (
    select l.ord, p.product_id, p.seller_id, p.title, p.url, p.image, p.category_id, p.category_name, p.shop_name, p.price, p.price_original, p.rating, p.reviews,
           coalesce(m.sold_now, p.last_sold) as sold_now, m.sold_checked_at, m.sold_per_day, m.sold_per_day_week,
           round(p.price * m.sold_per_day) as revenue_per_day,
           m.growth_pct, m.sold_per_day_prev, m.trend, m.sold_per_day_recent,
           p.focus, p.gallery_count, p.other_shops, p.twin_shops, p.video_count, p.video_views, p.video_likes,
           m.fresh_videos, m.fresh_views, m.newest_video,
           p.first_seen, p.last_seen, p.starred, p.hidden, p.niche
    from (select product_id, ord from tiktok_watch.listed_ids() where only_ids is null
          union all select x, 0 from unnest(only_ids) x) l
    join tiktok_watch.shop_products p using (product_id)
    left join tiktok_watch.shop_metrics m using (product_id)) t
$$;

create or replace function tiktok_watch.refresh_shop_metrics()
returns void language plpgsql security definer set search_path to '' set statement_timeout to '240s' as $$
declare s jsonb; a text[]; b text[];
begin
  refresh materialized view concurrently tiktok_watch.shop_metrics;
  begin
    perform tiktok_watch.build_shop_spark();
  exception when others then
    raise warning 'shop_spark failed: %', sqlerrm;  -- the sparkline is optional; keep the old one
  end;
  s := tiktok_watch.shop_rows(null);
  select coalesce(array_agg(product_id order by product_id) filter (where starred), '{}'), coalesce(array_agg(product_id order by product_id) filter (where hidden), '{}')
    into a, b from tiktok_watch.shop_products where starred or hidden;
  insert into tiktok_watch.load_cache (id, shop, ids, st, hd, built_at, lite)
  values (1, s, array(select e->>'product_id' from jsonb_array_elements(s) e), a, b, now(), tiktok_watch.shop_rows_lite(null))
  on conflict (id) do update set shop = excluded.shop, ids = excluded.ids, st = excluded.st, hd = excluded.hd, built_at = excluded.built_at, lite = excluded.lite;
end $$;

-- niches list for the web app (labels, order)
create or replace function public.tr_niches()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.tr_guard();
  return (select coalesce(jsonb_agg(jsonb_build_object('key', e->>'key', 'label', e->>'label')), '[]'::jsonb)
          from tiktok_watch.settings s, jsonb_array_elements(s.value) e where s.key = 'niches');
end $$;
