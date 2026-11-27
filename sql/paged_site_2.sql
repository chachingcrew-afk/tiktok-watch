-- Follow-up to paged_site.sql (applied 2026-11-27):
-- 1) the CTEs that are read several times are materialized, so Postgres computes them once
-- 2) tr_videos_page no longer reads the video_scores view, whose product_sales join scanned every product snapshot (4-7 s);
--    it computes the same video numbers itself and takes the product's daily sales from shop_list (~50 ms).

do $$
declare d text;
begin
  d := pg_get_functiondef('public.tr_fb_ads_page(jsonb)'::regprocedure);
  d := replace(d, 'with a as (', 'with a as materialized (');
  d := replace(d, '    b as (', '    b as materialized (');
  execute d;
  d := pg_get_functiondef('public.tr_shop_page(jsonb)'::regprocedure);
  d := replace(d, '    base as (', '    base as materialized (');
  d := replace(d, '    f as (', '    f as materialized (');
  d := replace(d, '    g as (', '    g as materialized (');
  execute d;
end $$;

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
    with ranked as materialized (
      select s.video_id, s.taken_at, s.views, s.likes, s.comments, s.shares,
             row_number() over (partition by s.video_id order by s.taken_at desc) rn
      from tiktok_watch.snapshots s),
    sc as materialized (
      select v.video_id, v.url, v.author, v.description, v.product_title, v.status, v.created_at_tt,
             round((extract(epoch from (cur.taken_at - v.created_at_tt)) / 3600.0), 1) age_hours,
             cur.views, cur.likes, cur.comments, cur.shares,
             round(cur.views::numeric / greatest(extract(epoch from (cur.taken_at - v.created_at_tt)) / 3600.0, 1)) avg_views_per_hour,
             case when pv.video_id is not null then round((cur.views - pv.views)::numeric / greatest(extract(epoch from (cur.taken_at - pv.taken_at)) / 3600.0, 0.5)) end recent_views_per_hour,
             case when pv.video_id is not null and p2.video_id is not null then round(
               ((cur.views - pv.views)::numeric / greatest(extract(epoch from (cur.taken_at - pv.taken_at)) / 3600.0, 0.5))
               / nullif((pv.views - p2.views)::numeric / greatest(extract(epoch from (pv.taken_at - p2.taken_at)) / 3600.0, 0.5), 0), 2) end acceleration,
             v.starred, v.hidden, v.product_id, v.product_url, v.product_image, v.product_category, v.product_price, v.product_sold,
             sl.sold_per_day product_sold_per_day, v.created_at_tt newest
      from tiktok_watch.videos v
      join ranked cur on cur.video_id = v.video_id and cur.rn = 1
      left join ranked pv on pv.video_id = v.video_id and pv.rn = 2
      left join ranked p2 on p2.video_id = v.video_id and p2.rn = 3
      left join tiktok_watch.shop_list sl on sl.product_id = v.product_id
      where $1 = '' or lower(coalesce(v.product_title, '') || ' ' || coalesce(v.description, '') || ' ' || coalesce(v.author, '')) like '%%' || $1 || '%%'),
    v as materialized (
      select sc.*, (not hidden and status = 'tracking') s_tracking, (not hidden and status = 'tracking' and acceleration > 1) s_accel,
             (not hidden and starred) s_starred, (not hidden and status <> 'tracking') s_out, hidden s_hidden
      from sc)
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
