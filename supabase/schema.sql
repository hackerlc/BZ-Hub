-- 在 Supabase Dashboard > SQL Editor 中执行一次。
-- 此表每个账户只保存一份启动器快照；客户端通过 revision 做乐观并发控制。

create table if not exists public.launcher_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint launcher_state_is_object check (jsonb_typeof(state) = 'object')
);

alter table public.launcher_snapshots enable row level security;

drop policy if exists "Users can read their launcher snapshot" on public.launcher_snapshots;
create policy "Users can read their launcher snapshot"
on public.launcher_snapshots
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their launcher snapshot" on public.launcher_snapshots;
create policy "Users can create their launcher snapshot"
on public.launcher_snapshots
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their launcher snapshot" on public.launcher_snapshots;
create policy "Users can update their launcher snapshot"
on public.launcher_snapshots
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their launcher snapshot" on public.launcher_snapshots;
create policy "Users can delete their launcher snapshot"
on public.launcher_snapshots
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Supabase 项目可能为新表保留默认角色权限。此应用只允许登录用户访问，
-- 因此先清空匿名与登录角色的表权限，再只授予同步所需的 CRUD。
revoke all privileges on table public.launcher_snapshots from anon;
revoke all privileges on table public.launcher_snapshots from authenticated;
grant select, insert, update, delete on table public.launcher_snapshots to authenticated;
