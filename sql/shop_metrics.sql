-- Cached sales metrics (2026-10-29). tr_load used to compute shop_product_scores live for every
-- product on every page load (window functions over all snapshots + grouping 48k videos), which hit
-- the 8 s statement timeout. Now the metrics live in this materialized view, refreshed at the end of
-- every job run (db.finish_run -> db.refresh_metrics), and tr_load / tr_search / tr_products_info
-- read the cache joined to the live shop_products row (stars, hides, prices stay instant).
-- Applied as Supabase migrations "shop_metrics_cache" and "search_info_use_metrics_cache".
create materialized view if not exists tiktok_watch.shop_metrics as
select v.product_id, v.sold_now, v.sold_checked_at, v.sold_per_day, v.sold_per_day_week, v.revenue_per_day,
       v.growth_pct, v.sold_per_day_prev, v.trend, v.sold_per_day_recent,
       fv.fresh_videos, fv.fresh_views, fv.newest_video
from tiktok_watch.shop_product_scores v
left join (select pv.product_id,
                  count(*) filter (where pv.upload_time > now() - make_interval(days => coalesce((select (value)::text::int from tiktok_watch.settings where key = 'hot_video_days'), 60))) as fresh_videos,
                  sum(pv.play_count) filter (where pv.upload_time > now() - make_interval(days => coalesce((select (value)::text::int from tiktok_watch.settings where key = 'hot_video_days'), 60))) as fresh_views,
                  max(pv.upload_time) as newest_video
           from tiktok_watch.shop_product_videos pv group by pv.product_id) fv on fv.product_id = v.product_id;
create unique index if not exists shop_metrics_pk on tiktok_watch.shop_metrics(product_id);

create or replace function tiktok_watch.refresh_shop_metrics() returns void
language plpgsql security definer set search_path = '' set statement_timeout = '120s' as $$
begin
  refresh materialized view concurrently tiktok_watch.shop_metrics;
end $$;
