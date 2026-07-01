create table if not exists public.customers (
  discord_user_id text primary key,
  username text,
  total_spent bigint not null default 0,
  tier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id bigserial primary key,
  type text not null check (type in ('order', 'rekber', 'support')),
  guild_id text not null,
  channel_id text unique,
  opener_id text not null,
  opener_tag text,
  claimed_by text,
  status text not null default 'open' check (status in ('open', 'claimed', 'completed', 'closed')),
  total_amount bigint not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.transactions (
  id bigserial primary key,
  ticket_id bigint references public.tickets(id) on delete set null,
  buyer_id text not null,
  buyer_tag text,
  product text not null,
  amount bigint not null check (amount >= 0),
  payment_method text not null default 'QRIS',
  handled_by text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_panels (
  id bigserial primary key,
  guild_id text not null,
  channel_id text not null,
  message_id text not null,
  type text not null,
  created_at timestamptz not null default now(),
  unique (guild_id, type)
);

create table if not exists public.bot_heartbeat (
  id text primary key default 'ws-store',
  last_ping timestamptz not null default now(),
  note text
);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
before update on public.customers
for each row execute function public.touch_updated_at();

alter table public.customers disable row level security;
alter table public.tickets disable row level security;
alter table public.transactions disable row level security;
alter table public.ticket_panels disable row level security;
alter table public.bot_heartbeat disable row level security;
