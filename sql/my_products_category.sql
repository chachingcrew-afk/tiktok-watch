-- 2026-10-31: categories for "Saját termékek" (migration my_products_category).
-- my_products.category (free text); tr_save_my_product stores it (an update without the key keeps the old value);
-- tr_my_products returns it. The web app groups and filters the cards by it.
alter table tiktok_watch.my_products add column if not exists category text;
