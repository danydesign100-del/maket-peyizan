-- Étape E2/E3 : proformas consultables, modifiables (avec historique),
-- imprimables et transformables en vente. Une proforma ne touche jamais le
-- stock : seule la vente créée à partir d'elle le déduit.

alter table public.proformas drop constraint if exists proformas_status_check;
alter table public.proformas add constraint proformas_status_check
  check (status in ('draft', 'sent', 'accepted', 'cancelled', 'expired', 'converted'));
alter table public.proformas add column if not exists revision integer not null default 1;
alter table public.proformas add column if not exists updated_by uuid references public.profiles(id) on delete restrict;
alter table public.proformas add column if not exists converted_sale_id uuid references public.sales(id) on delete set null;

create table if not exists public.proforma_history (
  id uuid primary key default gen_random_uuid(),
  proforma_id uuid not null references public.proformas(id) on delete cascade,
  revision integer not null,
  action text not null check (action in ('created', 'updated', 'status', 'converted')),
  status text,
  snapshot jsonb not null,
  note text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists proforma_history_proforma_idx on public.proforma_history (proforma_id, changed_at);
alter table public.proforma_history enable row level security;

-- Who works on proformas (same rule as the screen) and who sees all of them.
create or replace function public.can_handle_proformas() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('cashier') or public.has_role('director') or public.has_role('administrator');
$$;
create or replace function public.can_see_all_proformas() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('director') or public.has_role('administrator') or public.has_role('accountant');
$$;
/** Prices different from the catalogue: directors and administrators. */
create or replace function public.can_price_proformas() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('director') or public.has_role('administrator');
$$;
revoke all on function public.can_handle_proformas() from public, anon;
revoke all on function public.can_see_all_proformas() from public, anon;
revoke all on function public.can_price_proformas() from public, anon;
grant execute on function public.can_handle_proformas() to authenticated;
grant execute on function public.can_see_all_proformas() to authenticated;
grant execute on function public.can_price_proformas() to authenticated;

drop policy if exists "proformas admin or owner read" on public.proformas;
drop policy if exists "proformas read" on public.proformas;
create policy "proformas read" on public.proformas for select to authenticated using (created_by = auth.uid() or public.can_see_all_proformas());
drop policy if exists "proforma items by accessible proforma" on public.proforma_items;
drop policy if exists "proforma items read" on public.proforma_items;
create policy "proforma items read" on public.proforma_items for select to authenticated
  using (exists (select 1 from public.proformas p where p.id = proforma_id and (p.created_by = auth.uid() or public.can_see_all_proformas())));
drop policy if exists "proforma history read" on public.proforma_history;
create policy "proforma history read" on public.proforma_history for select to authenticated
  using (exists (select 1 from public.proformas p where p.id = proforma_id and (p.created_by = auth.uid() or public.can_see_all_proformas())));
-- Changes go through the functions below (one transaction, totals by the server, history).
drop policy if exists "proformas admin or owner insert" on public.proformas;
drop policy if exists "proformas admin or owner update" on public.proformas;

create or replace function public.proforma_snapshot(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'created_at' - 'updated_at' || jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(i) - 'id' - 'proforma_id' - 'created_at' order by i.created_at, i.description) from public.proforma_items i where i.proforma_id = p.id), '[]'::jsonb))
  from public.proformas p where p.id = p_id;
$$;
revoke all on function public.proforma_snapshot(uuid) from public, anon, authenticated;

/**
 * Creates (p_id null) or replaces a proforma and its lines in one transaction.
 * Lines: [{ product_id, quantity, unit_price, discount_amount }]; the description
 * comes from the product; totals are computed here.
 */
create or replace function public.save_proforma(
  p_id uuid, p_customer_id uuid, p_valid_until date, p_notes text, p_items jsonb, p_note text default null
) returns public.proformas language plpgsql security definer set search_path = public as $$
declare
  v_proforma public.proformas;
  v_item record;
  v_product public.products;
  v_price numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.can_handle_proformas() then raise exception 'Seuls les caissiers, directeurs et administrateurs gèrent les proformas'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Ajoutez au moins un produit à la proforma'; end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id and active) then raise exception 'Client indisponible'; end if;
  if p_id is not null then
    select * into v_proforma from public.proformas where id = p_id for update;
    if not found or not (v_proforma.created_by = auth.uid() or public.can_see_all_proformas()) then raise exception 'Proforma introuvable'; end if;
    if v_proforma.status not in ('draft', 'sent') then raise exception 'Une proforma % ne se modifie plus', case v_proforma.status when 'accepted' then 'acceptée' when 'converted' then 'transformée en vente' when 'cancelled' then 'annulée' else 'expirée' end; end if;
  end if;
  if p_valid_until is not null and p_valid_until < coalesce(v_proforma.issue_date, current_date) then raise exception 'La date de validité est antérieure à la date de la proforma'; end if;

  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, unit_price numeric, discount_amount numeric) loop
    select * into v_product from public.products where id = v_item.product_id;
    if not found then raise exception 'Produit introuvable'; end if;
    if v_item.quantity is null or v_item.quantity <= 0 then raise exception 'Quantité invalide pour %', v_product.name; end if;
    v_price := coalesce(v_item.unit_price, nullif(v_product.proforma_price, 0), v_product.selling_price);
    if v_price < 0 then raise exception 'Prix invalide pour %', v_product.name; end if;
    -- Catalogue prices: proforma price, else selling price. Anything else needs the right.
    if v_price not in (v_product.proforma_price, v_product.selling_price) and not public.can_price_proformas() then
      raise exception 'Modifier le prix de « % » est réservé aux responsables autorisés', v_product.name;
    end if;
    if coalesce(v_item.discount_amount, 0) < 0 or coalesce(v_item.discount_amount, 0) > v_item.quantity * v_price then raise exception 'Remise invalide pour %', v_product.name; end if;
    v_subtotal := v_subtotal + round(v_item.quantity * v_price, 2);
    v_discount := v_discount + round(coalesce(v_item.discount_amount, 0), 2);
    v_lines := v_lines || jsonb_build_object('product_id', v_product.id, 'description', v_product.name, 'quantity', v_item.quantity, 'unit_price', v_price, 'discount_amount', round(coalesce(v_item.discount_amount, 0), 2), 'line_total', round(v_item.quantity * v_price - coalesce(v_item.discount_amount, 0), 2));
  end loop;

  if p_id is null then
    insert into public.proformas (customer_id, valid_until, notes, subtotal, discount_amount, tax_amount, total_amount, status, created_by, updated_by)
    values (p_customer_id, p_valid_until, nullif(trim(p_notes), ''), v_subtotal, v_discount, 0, v_subtotal - v_discount, 'draft', auth.uid(), auth.uid())
    returning * into v_proforma;
  else
    update public.proformas set customer_id = p_customer_id, valid_until = p_valid_until, notes = nullif(trim(p_notes), ''),
      subtotal = v_subtotal, discount_amount = v_discount, tax_amount = 0, total_amount = v_subtotal - v_discount,
      revision = revision + 1, updated_by = auth.uid(), updated_at = now()
    where id = p_id returning * into v_proforma;
    delete from public.proforma_items where proforma_id = p_id;
  end if;
  insert into public.proforma_items (proforma_id, product_id, description, quantity, unit_price, discount_amount, tax_amount, line_total)
  select v_proforma.id, (x->>'product_id')::uuid, x->>'description', (x->>'quantity')::numeric, (x->>'unit_price')::numeric, (x->>'discount_amount')::numeric, 0, (x->>'line_total')::numeric
  from jsonb_array_elements(v_lines) x;
  insert into public.proforma_history (proforma_id, revision, action, status, snapshot, note, changed_by)
  values (v_proforma.id, v_proforma.revision, case when p_id is null then 'created' else 'updated' end, v_proforma.status, public.proforma_snapshot(v_proforma.id), nullif(trim(p_note), ''), auth.uid());
  return v_proforma;
end;
$$;
revoke all on function public.save_proforma(uuid, uuid, date, text, jsonb, text) from public, anon;
grant execute on function public.save_proforma(uuid, uuid, date, text, jsonb, text) to authenticated;

create or replace function public.set_proforma_status(p_id uuid, p_status text, p_note text default null) returns public.proformas
language plpgsql security definer set search_path = public as $$
declare v_proforma public.proformas;
begin
  if auth.uid() is null or not public.can_handle_proformas() then raise exception 'Permission refusée'; end if;
  if p_status not in ('draft', 'sent', 'accepted', 'cancelled', 'expired') then raise exception 'Statut invalide'; end if;
  select * into v_proforma from public.proformas where id = p_id for update;
  if not found or not (v_proforma.created_by = auth.uid() or public.can_see_all_proformas()) then raise exception 'Proforma introuvable'; end if;
  if v_proforma.status = 'converted' then raise exception 'Une proforma transformée en vente ne change plus de statut'; end if;
  update public.proformas set status = p_status, updated_by = auth.uid(), updated_at = now() where id = p_id returning * into v_proforma;
  insert into public.proforma_history (proforma_id, revision, action, status, snapshot, note, changed_by)
  values (p_id, v_proforma.revision, 'status', p_status, public.proforma_snapshot(p_id), nullif(trim(p_note), ''), auth.uid());
  return v_proforma;
end;
$$;
revoke all on function public.set_proforma_status(uuid, text, text) from public, anon;
grant execute on function public.set_proforma_status(uuid, text, text) to authenticated;

/** Links the sale made from a proforma (called once the sale is on the server). */
create or replace function public.mark_proforma_converted(p_proforma_id uuid, p_sale_id uuid) returns public.proformas
language plpgsql security definer set search_path = public as $$
declare v_proforma public.proformas;
begin
  if auth.uid() is null or not public.can_handle_proformas() then raise exception 'Permission refusée'; end if;
  select * into v_proforma from public.proformas where id = p_proforma_id for update;
  if not found then raise exception 'Proforma introuvable'; end if;
  if not exists (select 1 from public.sales where id = p_sale_id and created_by = auth.uid()) then raise exception 'Vente introuvable'; end if;
  if v_proforma.status = 'converted' then return v_proforma; end if;
  if v_proforma.status in ('cancelled', 'expired') then raise exception 'Cette proforma est annulée ou expirée'; end if;
  update public.sales set proforma_id = p_proforma_id where id = p_sale_id;
  update public.proformas set status = 'converted', converted_sale_id = p_sale_id, updated_by = auth.uid(), updated_at = now()
   where id = p_proforma_id returning * into v_proforma;
  insert into public.proforma_history (proforma_id, revision, action, status, snapshot, note, changed_by)
  values (p_proforma_id, v_proforma.revision, 'converted', 'converted', public.proforma_snapshot(p_proforma_id), (select 'Vente ' || sale_number from public.sales where id = p_sale_id), auth.uid());
  return v_proforma;
end;
$$;
revoke all on function public.mark_proforma_converted(uuid, uuid) from public, anon;
grant execute on function public.mark_proforma_converted(uuid, uuid) to authenticated;
