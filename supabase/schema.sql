-- Paycheck and Debt Planner: one saved planner per signed-in user.
-- Run once in Supabase: SQL Editor → New query → paste → Run.

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
  new.updated_at := now();
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
