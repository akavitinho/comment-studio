-- One-time relay for Instagram authorization completed in an external browser.
-- The OAuth code is encrypted by the Edge Function and never exposed through the Data API.
alter table public.meta_oauth_flows
  add column if not exists poll_secret_hash text,
  add column if not exists code_ciphertext text,
  add column if not exists code_iv text,
  add column if not exists oauth_error text;

alter table public.meta_oauth_flows
  add constraint meta_oauth_poll_secret_hash_format check (poll_secret_hash is null or poll_secret_hash ~ '^[0-9a-f]{64}$');

grant update on public.meta_oauth_flows to service_role;
