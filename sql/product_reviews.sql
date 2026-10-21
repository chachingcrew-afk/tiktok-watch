-- TikTok Shop product reviews, fetched on request from the web app ("Vélemények lekérése").
create table if not exists tiktok_watch.review_requests (
  product_id text primary key,
  status text not null default 'queued',          -- queued | running | done | error
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  summary jsonb,                                   -- {overall_score, review_count, rating_result:{1..5}}
  fetched int
);

create table if not exists tiktok_watch.product_reviews (
  review_id text primary key,
  product_id text not null,
  rating smallint,
  review_time timestamptz,
  verified boolean,
  incentivized boolean,
  text text,
  sku text,
  country text,
  reviewer text,
  images jsonb,                                    -- small JPEG thumbnails (base64), the CDN links expire
  fetched_at timestamptz not null default now()
);
create index if not exists product_reviews_product on tiktok_watch.product_reviews(product_id, rating);

alter table tiktok_watch.review_requests enable row level security;
alter table tiktok_watch.product_reviews enable row level security;

-- queue a product (the edge function calls this, then starts the GitHub workflow)
create or replace function public.tr_request_reviews(pid text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r tiktok_watch.review_requests;
begin
  perform public.tr_guard();
  insert into tiktok_watch.review_requests (product_id, status, requested_at, error)
  values (pid, 'queued', now(), null)
  on conflict (product_id) do update set
    status = case when tiktok_watch.review_requests.status = 'running' then 'running' else 'queued' end,
    requested_at = now(), error = null
  returning * into r;
  return to_jsonb(r);
end $$;

-- written by the browser extension (signed in as the owner) after it read the reviews on the product page
create or replace function public.tr_save_reviews(pid text, summary jsonb, reviews jsonb, done boolean default true) returns int
language plpgsql security definer set search_path = '' as $$
declare r jsonb; n int := 0;
begin
  perform public.tr_guard();
  for r in select * from jsonb_array_elements(coalesce(reviews, '[]'::jsonb)) loop
    insert into tiktok_watch.product_reviews (review_id, product_id, rating, review_time, verified, incentivized, text, sku, country, reviewer, images, fetched_at)
    values (r->>'review_id', pid, (r->>'rating')::smallint,
            case when (r->>'time') is not null then to_timestamp((r->>'time')::bigint) end,
            (r->>'verified')::boolean, (r->>'incentivized')::boolean, r->>'text', r->>'sku', r->>'country', r->>'reviewer',
            case when jsonb_array_length(coalesce(r->'images','[]'::jsonb)) > 0 then r->'images' end, now())
    on conflict (review_id) do update set rating = excluded.rating, text = excluded.text,
      images = coalesce(excluded.images, tiktok_watch.product_reviews.images), fetched_at = now();
    n := n + 1;
  end loop;
  insert into tiktok_watch.review_requests (product_id, status, requested_at, started_at, finished_at, summary, fetched)
  values (pid, case when done then 'done' else 'running' end, now(), now(), case when done then now() end, summary,
          (select count(*) from tiktok_watch.product_reviews where product_id = pid))
  on conflict (product_id) do update set status = excluded.status, error = null,
    finished_at = excluded.finished_at, summary = coalesce(excluded.summary, tiktok_watch.review_requests.summary),
    fetched = excluded.fetched;
  return n;
end $$;

-- the product's reviews for the drawer
create or replace function public.tr_reviews(pid text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.tr_guard();
  return jsonb_build_object(
    'request', (select to_jsonb(q) from tiktok_watch.review_requests q where q.product_id = pid),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r) - 'product_id' order by r.rating, r.review_time desc)
                         from tiktok_watch.product_reviews r where r.product_id = pid), '[]'::jsonb));
end $$;

revoke all on function public.tr_request_reviews(text) from public, anon;
revoke all on function public.tr_reviews(text) from public, anon;
revoke all on function public.tr_save_reviews(text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.tr_save_reviews(text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.tr_request_reviews(text) to authenticated;
grant execute on function public.tr_reviews(text) to authenticated;
