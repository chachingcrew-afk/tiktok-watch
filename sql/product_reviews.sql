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
grant execute on function public.tr_request_reviews(text) to authenticated;
grant execute on function public.tr_reviews(text) to authenticated;
