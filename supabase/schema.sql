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

create table if not exists public.service_statuses (
  guild_id text not null,
  service text not null,
  is_open boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (guild_id, service)
);

create table if not exists public.panel_text_overrides (
  guild_id text not null,
  type text not null,
  title text,
  description text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (guild_id, type)
);

create table if not exists public.giveaways (
  id bigserial primary key,
  guild_id text not null,
  channel_id text not null,
  message_id text,
  host_id text not null,
  prize text not null,
  winners_count integer not null default 1 check (winners_count > 0),
  winner_ids text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'ended')),
  ends_at timestamptz not null,
  ended_at timestamptz,
  ended_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.giveaway_entries (
  giveaway_id bigint not null references public.giveaways(id) on delete cascade,
  user_id text not null,
  username text,
  entries integer not null default 1 check (entries > 0),
  created_at timestamptz not null default now(),
  primary key (giveaway_id, user_id)
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

drop trigger if exists service_statuses_touch_updated_at on public.service_statuses;
create trigger service_statuses_touch_updated_at
before update on public.service_statuses
for each row execute function public.touch_updated_at();

drop trigger if exists panel_text_overrides_touch_updated_at on public.panel_text_overrides;
create trigger panel_text_overrides_touch_updated_at
before update on public.panel_text_overrides
for each row execute function public.touch_updated_at();

alter table public.customers disable row level security;
alter table public.tickets disable row level security;
alter table public.transactions disable row level security;
alter table public.ticket_panels disable row level security;
alter table public.bot_heartbeat disable row level security;
alter table public.service_statuses disable row level security;
alter table public.panel_text_overrides disable row level security;
alter table public.giveaways disable row level security;
alter table public.giveaway_entries disable row level security;
