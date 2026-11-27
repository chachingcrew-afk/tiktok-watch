-- Backup before the paged-website migration (2026-11-27): the version of refresh_shop_metrics that was live.
-- The new version only adds a call to tiktok_watch.build_shop_list() at the end.
CREATE OR REPLACE FUNCTION tiktok_watch.refresh_shop_metrics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '240s'
AS $function$
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
end $function$;
