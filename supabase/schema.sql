-- 喵庭 P1 持久层：在 Supabase SQL Editor 里整段执行一次即可。
-- 两人私密房间阶段不开 RLS；公共化时再加 auth 列并启用。

create table if not exists players (
  id            text primary key,
  room          text not null default 'mossbell-courtyard',
  name          text not null,
  appearance    jsonb not null,
  last_snapshot jsonb not null,
  last_seen     timestamptz not null default now()
);

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  room        text not null default 'mossbell-courtyard',
  author_id   text not null references players(id),
  author_name text not null,
  kind        text not null default 'note',
  text        text not null check (char_length(text) <= 200),
  anchor_x    int not null,
  anchor_y    int not null,
  scene       text not null default 'yard',
  created_at  timestamptz not null default now(),
  opened_at   timestamptz
);

-- 已建过表的部署：补场景列（纸条/小鱼干支持留在小屋里），幂等可重复执行
alter table notes add column if not exists scene text not null default 'yard';
-- 纸条可附上一朵花（TA 拆开时花转入 TA 的花袋）
alter table notes add column if not exists flower text;
-- 花袋：挂在 players 行上，upsert 只写固定列不会互相覆盖
alter table players add column if not exists flowers jsonb not null default '{}';

-- 小花园：6 个花位；双方都浇才长一阶，72h 未浇只耷拉不枯死
create table if not exists garden_plots (
  room            text not null default 'mossbell-courtyard',
  plot            int  not null,
  flower          text,
  stage           int  not null default 0,
  planted_by      text,
  stage_at        timestamptz,
  watered_by      text[] not null default '{}',
  last_watered_at timestamptz,
  last_watered_by text,
  primary key (room, plot)
);

-- 装饰花：从花袋种到任意场景地面
create table if not exists decor (
  id        uuid primary key default gen_random_uuid(),
  room      text not null default 'mossbell-courtyard',
  flower    text not null,
  scene     text not null default 'yard',
  x         int not null,
  y         int not null,
  placed_by text not null,
  placed_at timestamptz not null default now()
);

create table if not exists presence_log (
  id        bigint generated always as identity primary key,
  room      text not null default 'mossbell-courtyard',
  player_id text not null,
  event     text not null,
  at        timestamptz not null default now()
);

create index if not exists presence_log_lookup on presence_log (room, player_id, at desc);
create index if not exists notes_open on notes (room) where opened_at is null;

alter table players disable row level security;
alter table notes disable row level security;
alter table presence_log disable row level security;
alter table garden_plots disable row level security;
alter table decor disable row level security;

-- 北极星：周均在线时长（分钟）
create or replace view weekly_online_minutes as
select date_trunc('week', j.at) as week,
       j.player_id,
       sum(extract(epoch from (coalesce(l.at, now()) - j.at)) / 60) as minutes
from presence_log j
left join lateral (
  select x.at from presence_log x
  where x.room = j.room and x.player_id = j.player_id and x.event = 'leave' and x.at > j.at
  order by x.at limit 1
) l on true
where j.event = 'join'
group by 1, 2;
