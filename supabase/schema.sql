-- Construction Tracker cloud state table
-- Run this once in Supabase Dashboard → SQL Editor.

create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"entries":{},"repayLogs":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_app_state enable row level security;

drop policy if exists "Users can read their own app state" on public.user_app_state;
drop policy if exists "Users can insert their own app state" on public.user_app_state;
drop policy if exists "Users can update their own app state" on public.user_app_state;
drop policy if exists "Users can delete their own app state" on public.user_app_state;

create policy "Users can read their own app state"
on public.user_app_state
for select
using (auth.uid() = user_id);

create policy "Users can insert their own app state"
on public.user_app_state
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own app state"
on public.user_app_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own app state"
on public.user_app_state
for delete
using (auth.uid() = user_id);
