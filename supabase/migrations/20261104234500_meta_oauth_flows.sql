-- Keep only short-lived state hashes. OAuth codes and tokens never enter the DB.
create table if not exists public.meta_oauth_flows (
  state_hash text primary key,
  account_id text not null,
  install_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint meta_oauth_state_hash_format check (state_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists meta_oauth_flows_expires_at_idx on public.meta_oauth_flows (expires_at);
alter table public.meta_oauth_flows enable row level security;
revoke all on public.meta_oauth_flows from public, anon, authenticated;
grant select, insert, delete on public.meta_oauth_flows to service_role;
