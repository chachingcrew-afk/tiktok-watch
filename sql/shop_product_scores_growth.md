Applied as Supabase migration `shop_product_scores_growth`: adds growth_pct (daily sales as % of units sold before,
only when 50+ sold), sold_per_day_prev and trend (today's pace / previous day's pace) to tiktok_watch.shop_product_scores.

2026-10-15: the "one day ago" snapshot now only needs to be 10 hours older (was 16), so the first day's
numbers appear after the next morning scan; rates are still divided by the real elapsed time.
