-- Étape 3 : champs métier du catalogue, clients et stockage d'images.
alter table public.products rename column cost_price to purchase_price;
alter table public.products rename column sale_price to selling_price;
alter table public.products rename column min_stock_quantity to minimum_stock;
alter table public.products
  add column brand text,
  add column proforma_price numeric(14,2) not null default 0 check (proforma_price >= 0),
  add column unit text not null default 'unité' check (char_length(trim(unit)) between 1 and 40),
  add column image_url text,
  add column expiration_date date,
  add column is_low_stock boolean generated always as (stock_quantity > 0 and stock_quantity <= minimum_stock) stored;

alter table public.customers
  add column company_name text,
  add column tax_id text,
  add column customer_type text not null default 'individual' check (customer_type in ('individual', 'business')),
  add column notes text;

create index if not exists products_brand_idx on public.products using gin (brand gin_trgm_ops) where brand is not null;
create index if not exists products_low_stock_idx on public.products(is_low_stock) where is_low_stock;
create index if not exists customers_email_idx on public.customers(email) where email is not null;

-- Les catégories restent désactivables afin de conserver l'historique des produits.
-- La FK products.category_id est volontairement conservée (on delete set null).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "product images public read" on storage.objects for select using (bucket_id = 'product-images');
create policy "product images administrator insert" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());
create policy "product images administrator update" on storage.objects for update to authenticated using (bucket_id = 'product-images' and public.is_admin()) with check (bucket_id = 'product-images' and public.is_admin());
create policy "product images administrator delete" on storage.objects for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());
