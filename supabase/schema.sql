-- Paycheck and Debt Planner: one saved planner per signed-in user.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
begin;

create table if not exists public.planner_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.planner_state enable row level security;

drop policy if exists "Read own planner"   on public.planner_state;
drop policy if exists "Insert own planner" on public.planner_state;
drop policy if exists "Update own planner" on public.planner_state;
drop policy if exists "Delete own planner" on public.planner_state;

create policy "Read own planner"   on public.planner_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own planner" on public.planner_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own planner" on public.planner_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own planner" on public.planner_state for delete to authenticated using ((select auth.uid()) = user_id);

-- keep updated_at current so other devices can tell a newer copy exists
create or replace function public.planner_state_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end $$;

drop trigger if exists planner_state_touch on public.planner_state;
create trigger planner_state_touch before update on public.planner_state
  for each row execute function public.planner_state_touch();

-- Reject saves from copies of the planner loaded before this rule. Current copies send a new random
-- `writer` with every save; older ones don't, and would otherwise put back bills filed with outdated
-- rules (e.g. a loan as "UnionBank CC"). An old copy sees "Not saved" until it is reloaded.
alter table public.planner_state add column if not exists writer text;

create or replace function public.planner_state_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.writer is null or (tg_op = 'UPDATE' and new.writer is not distinct from old.writer) then
    raise exception 'This copy of the planner is out of date. Reload the page.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists planner_state_guard on public.planner_state;
create trigger planner_state_guard before insert or update on public.planner_state
  for each row execute function public.planner_state_guard();

-- Atomic saves: two tabs cannot silently overwrite changes from one another.
-- Run this entire file before deploying the client that uses this RPC.
-- Returns a scalar timestamp; SQLSTATE 40001 means reload/reconcile first.
create or replace function public.save_planner_state(
  p_state jsonb, p_expected_at timestamptz, p_writer text
) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  previous_at timestamptz;
  saved_at timestamptz;
begin
  if caller is null then
    raise exception 'Sign in before saving.' using errcode = '28000';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object'
     or p_writer is null or length(p_writer) < 1 or length(p_writer) > 200 then
    raise exception 'Invalid planner save.' using errcode = '22023';
  end if;
  -- Serialize even a first save, when there is no row to lock yet.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  select updated_at into previous_at from public.planner_state
    where user_id = caller for update;
  if found then
    if previous_at is distinct from p_expected_at then
      raise exception 'Your planner changed on another device. Reload before saving.' using errcode = '40001';
    end if;
    update public.planner_state set state = p_state, writer = p_writer
      where user_id = caller returning updated_at into saved_at;
  else
    if p_expected_at is not null then
      raise exception 'Your planner changed on another device. Reload before saving.' using errcode = '40001';
    end if;
    insert into public.planner_state(user_id, state, writer, updated_at)
      values(caller, p_state, p_writer, clock_timestamp()) returning updated_at into saved_at;
  end if;
  return saved_at;
end $$;

revoke all on function public.save_planner_state(jsonb, timestamptz, text) from public, anon;
grant execute on function public.save_planner_state(jsonb, timestamptz, text) to authenticated;
-- Direct legacy upserts would bypass the comparison above. Reads and account
-- deletion remain available under the existing user-scoped RLS policies.
revoke insert, update on public.planner_state from public, anon, authenticated;
grant select, delete on public.planner_state to authenticated;
commit;
