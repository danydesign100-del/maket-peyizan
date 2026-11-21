-- Regularisation workflow (step 2 of the accounting corrections).
-- An accountant prepares a period-end regularisation entry and submits it; a
-- director or administrator validates it or sends it back with a reason.
-- Editing a submitted draft withdraws the submission, so what was approved is
-- exactly what gets posted. Every step is kept in journal_entry_history.

alter table public.journal_entries add column if not exists regularisation_kind text;
alter table public.journal_entries add column if not exists submitted_by uuid references public.profiles(id) on delete restrict;
alter table public.journal_entries add column if not exists submitted_at timestamptz;

alter table public.journal_entries drop constraint if exists journal_entries_regularisation_kind_check;
alter table public.journal_entries add constraint journal_entries_regularisation_kind_check check (
  (entry_type = 'regularisation' and regularisation_kind in (
    'accrued_expense', 'accrued_revenue', 'prepaid_expense', 'deferred_revenue',
    'depreciation', 'provision', 'inventory', 'correction', 'other'))
  or (entry_type <> 'regularisation' and regularisation_kind is null)
) not valid;

comment on column public.journal_entries.regularisation_kind is 'Kind of period-end regularisation (charges à payer, produits constatés d''avance, amortissement…).';
comment on column public.journal_entries.submitted_at is 'Regularisation drafts: when the preparer submitted it for validation.';

alter table public.journal_entry_history drop constraint if exists journal_entry_history_action_check;
alter table public.journal_entry_history add constraint journal_entry_history_action_check
  check (action in ('created', 'updated', 'submitted', 'returned', 'posted', 'voided'));

-- Who may validate regularisations.
create or replace function public.can_validate_regularisation() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('director') or public.has_role('administrator');
$$;

-- save_journal_entry gains the regularisation kind; the previous signature is replaced.
drop function if exists public.save_journal_entry(uuid, date, text, text, text, text, jsonb);
create or replace function public.save_journal_entry(
  p_entry_id uuid, p_entry_date date, p_description text, p_reference text default null,
  p_entry_type text default 'standard', p_justification text default null, p_lines jsonb default '[]'::jsonb,
  p_regularisation_kind text default null
) returns public.journal_entries language plpgsql security definer set search_path = public as $$
declare v_entry public.journal_entries; v_line record; v_period uuid; v_number integer := 0; v_kind text;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  if p_entry_type not in ('standard', 'regularisation', 'opening') then raise exception 'Type d''écriture invalide'; end if;
  if p_entry_date is null then raise exception 'La date est obligatoire'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Le libellé est obligatoire'; end if;
  if p_entry_type = 'regularisation' and nullif(trim(p_justification), '') is null then raise exception 'Une régularisation doit être justifiée'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'Une écriture doit comporter au moins deux lignes'; end if;
  v_kind := case when p_entry_type = 'regularisation' then coalesce(nullif(p_regularisation_kind, ''), 'other') end;
  v_period := public.accounting_period_for(p_entry_date);

  if p_entry_id is null then
    insert into public.journal_entries (period_id, entry_date, description, reference, entry_type, regularisation_kind, justification, status, created_by)
    values (v_period, p_entry_date, trim(p_description), nullif(trim(p_reference), ''), p_entry_type, v_kind, nullif(trim(p_justification), ''), 'draft', auth.uid())
    returning * into v_entry;
  else
    select * into v_entry from public.journal_entries where id = p_entry_id for update;
    if not found then raise exception 'Écriture introuvable'; end if;
    if v_entry.status <> 'draft' then raise exception 'Seules les écritures en brouillon peuvent être modifiées'; end if;
    if v_entry.entry_type not in ('standard', 'regularisation', 'opening') then raise exception 'Les écritures automatiques ne se modifient pas manuellement'; end if;
    delete from public.journal_entry_lines where journal_entry_id = p_entry_id;
  end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(account_id uuid, description text, debit numeric, credit numeric) loop
    v_number := v_number + 1;
    if v_line.account_id is null then raise exception 'Ligne % : compte manquant', v_number; end if;
    if not exists (select 1 from public.accounts where id = v_line.account_id and is_active) then raise exception 'Ligne % : compte inactif ou introuvable', v_number; end if;
    if coalesce(v_line.debit, 0) < 0 or coalesce(v_line.credit, 0) < 0 then raise exception 'Ligne % : montant négatif', v_number; end if;
    if (coalesce(v_line.debit, 0) > 0) = (coalesce(v_line.credit, 0) > 0) then raise exception 'Ligne % : saisir soit un débit, soit un crédit', v_number; end if;
    insert into public.journal_entry_lines (journal_entry_id, account_id, description, debit_amount, credit_amount, line_number)
    values (v_entry.id, v_line.account_id, nullif(trim(v_line.description), ''), round(coalesce(v_line.debit, 0), 2), round(coalesce(v_line.credit, 0), 2), v_number);
  end loop;

  -- A change withdraws any pending submission.
  update public.journal_entries
     set period_id = v_period, entry_date = p_entry_date, description = trim(p_description), reference = nullif(trim(p_reference), ''),
         entry_type = p_entry_type, regularisation_kind = v_kind, justification = nullif(trim(p_justification), ''),
         submitted_by = null, submitted_at = null
   where id = v_entry.id returning * into v_entry;
  perform public.record_journal_history(v_entry.id, case when p_entry_id is null then 'created' else 'updated' end);
  return v_entry;
end;
$$;

create or replace function public.submit_journal_entry(p_entry_id uuid) returns public.journal_entries
language plpgsql security definer set search_path = public as $$
declare v_entry public.journal_entries; v_lines integer;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found or v_entry.status <> 'draft' then raise exception 'Seules les écritures en brouillon peuvent être soumises'; end if;
  if v_entry.entry_type <> 'regularisation' then raise exception 'Seules les régularisations passent par la validation'; end if;
  if v_entry.submitted_at is not null then raise exception 'Cette régularisation est déjà soumise'; end if;
  select count(*) into v_lines from public.journal_entry_lines where journal_entry_id = p_entry_id;
  if v_lines < 2 or v_entry.total_debit = 0 or abs(v_entry.total_debit - v_entry.total_credit) > 0.005 then
    raise exception 'La régularisation doit être équilibrée avant d''être soumise';
  end if;
  update public.journal_entries set submitted_by = auth.uid(), submitted_at = now() where id = p_entry_id returning * into v_entry;
  perform public.record_journal_history(p_entry_id, 'submitted');
  return v_entry;
end;
$$;

-- Sends a submitted regularisation back to its preparer, with the reason.
create or replace function public.return_journal_entry(p_entry_id uuid, p_reason text) returns public.journal_entries
language plpgsql security definer set search_path = public as $$
declare v_entry public.journal_entries;
begin
  if not public.can_validate_regularisation() then raise exception 'Seul un directeur ou un administrateur peut renvoyer une régularisation'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez le motif du renvoi'; end if;
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found or v_entry.status <> 'draft' or v_entry.submitted_at is null then raise exception 'Seule une régularisation soumise peut être renvoyée'; end if;
  update public.journal_entries set submitted_by = null, submitted_at = null where id = p_entry_id returning * into v_entry;
  perform public.record_journal_history(p_entry_id, 'returned', trim(p_reason));
  return v_entry;
end;
$$;

-- Regularisations are posted only once submitted, by a validator.
create or replace function public.post_journal_entry(p_entry_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_entry public.journal_entries;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found or v_entry.status <> 'draft' then raise exception 'Seules les écritures en brouillon peuvent être validées'; end if;
  if v_entry.entry_type = 'regularisation' then
    if not public.can_validate_regularisation() then raise exception 'Une régularisation doit être validée par un directeur ou un administrateur'; end if;
    if v_entry.submitted_at is null then raise exception 'La régularisation doit d''abord être soumise pour validation'; end if;
  end if;
  perform public.accounting_period_for(v_entry.entry_date);
  -- The balance trigger refuses the change if the entry is not balanced.
  update public.journal_entries set status = 'posted', posted_by = auth.uid(), posted_at = now() where id = p_entry_id;
  perform public.record_journal_history(p_entry_id, 'posted');
  perform public.log_audit('journal_entry_posted', 'journal_entries', p_entry_id, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'posted'), true);
  return true;
end;
$$;

-- Supabase grants new functions to anon by default: name it explicitly.
revoke all on function public.save_journal_entry(uuid, date, text, text, text, text, jsonb, text) from public, anon;
revoke all on function public.submit_journal_entry(uuid) from public, anon;
revoke all on function public.return_journal_entry(uuid, text) from public, anon;
revoke all on function public.can_validate_regularisation() from public, anon;
grant execute on function public.save_journal_entry(uuid, date, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.submit_journal_entry(uuid) to authenticated;
grant execute on function public.return_journal_entry(uuid, text) to authenticated;
grant execute on function public.can_validate_regularisation() to authenticated;

notify pgrst, 'reload schema';
