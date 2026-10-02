-- Apply after schema.sql. Atomic flower operations; existing anonymous-room access
-- is unchanged. These transactions do not replace authentication / RLS.
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='players' and column_name='head_flower') then
    alter table players add column head_flower text;
    update players set head_flower=last_snapshot->>'headFlower'
      where last_snapshot->>'headFlower' in ('rose','tulip','sunflower');
  end if;
end $$;

create table if not exists flower_receipts (
  room text not null, player_id text not null, request_id uuid not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key (room, player_id, request_id)
);
-- ponytail: retain receipts for reliable retries; add cleanup only after measured growth.

create or replace function flower_action(p_room text, p_player text, p_request uuid,
  p_action text, p_args jsonb default '{}') returns jsonb
language plpgsql set search_path = public as $$
declare
  actor players%rowtype; item decor%rowtype; letter notes%rowtype;
  crop garden_plots%rowtype; result jsonb; flower text; old_flower text;
  amount int; point int; stamp timestamptz := clock_timestamp();
begin
  select * into actor from players where id=p_player and room=p_room for update;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;
  select r.result into result from flower_receipts r
    where room=p_room and player_id=p_player and request_id=p_request;
  if found then return result || jsonb_build_object('flowers',actor.flowers,'headFlower',actor.head_flower); end if;
  flower := p_args->>'flower';
  if flower is not null and flower not in ('rose','tulip','sunflower') then
    raise exception 'INVALID_FLOWER';
  end if;
  if p_action in ('place-decor','place-note') then
    if p_args->>'scene' not in ('yard','cabin','garden') or
      not (coalesce((p_args->>'x')::int,-1) between 0 and 960) or
      not (coalesce((p_args->>'y')::int,-1) between 0 and 640) then
      raise exception 'INVALID_POSITION';
    end if;
  end if;

  if p_action = 'equip' then
    old_flower := actor.head_flower;
    if flower is distinct from old_flower then
      if old_flower is not null then
        actor.flowers := jsonb_set(actor.flowers,array[old_flower],
          to_jsonb(coalesce((actor.flowers->>old_flower)::int,0)+1));
      end if;
      actor.head_flower := flower;
    else flower := null; end if;
  elsif p_action = 'place-decor' then
    if flower is null then raise exception 'INVALID_FLOWER'; end if;
    insert into decor(room,flower,scene,x,y,placed_by)
    values(p_room,flower,p_args->>'scene',(p_args->>'x')::int,(p_args->>'y')::int,p_player)
    returning * into item;
    result := jsonb_build_object('decor',to_jsonb(item));
  elsif p_action = 'recover-decor' then
    delete from decor where room=p_room and id=(p_args->>'id')::uuid returning * into item;
    if not found then raise exception 'ALREADY_CLAIMED'; end if;
    old_flower := item.flower; flower := null;
  elsif p_action = 'place-note' then
    if p_args->>'kind' not in ('note','treat') or
      coalesce(length(p_args->>'text'),0) not between 1 and 200 then
      raise exception 'INVALID_NOTE';
    end if;
    insert into notes(room,author_id,author_name,kind,text,anchor_x,anchor_y,scene,flower)
    values(p_room,p_player,actor.name,p_args->>'kind',p_args->>'text',
      (p_args->>'x')::int,(p_args->>'y')::int,p_args->>'scene',flower)
    returning * into letter;
    result := jsonb_build_object('note',to_jsonb(letter));
  elsif p_action = 'open-note' then
    update notes set opened_at=stamp where room=p_room and id=(p_args->>'id')::uuid
      and opened_at is null and author_id<>p_player returning * into letter;
    if not found then raise exception 'ALREADY_CLAIMED'; end if;
    old_flower := letter.flower; flower := null;
  elsif p_action in ('plant','water','harvest') then
    point := (p_args->>'plot')::int;
    if point is null or point not between 0 and 5 then raise exception 'INVALID_PLOT'; end if;
    insert into garden_plots(room,plot) values(p_room,point) on conflict do nothing;
    select * into crop from garden_plots where room=p_room and plot=point for update;
    -- Each completed contribution round advances once, even if both watered early.
    if crop.flower is not null and crop.stage<4 and cardinality(crop.watered_by)>=2
      and crop.stage_at<=stamp-interval '18 hours' then
      crop.stage:=crop.stage+1; crop.stage_at:=stamp; crop.watered_by:='{}';
    end if;
    if p_action='plant' then
      if crop.flower is not null then raise exception 'PLOT_OCCUPIED'; end if;
      if flower is null then raise exception 'INVALID_FLOWER'; end if;
      crop.flower:=flower; crop.stage:=0; crop.planted_by:=p_player;
      crop.stage_at:=stamp; crop.watered_by:='{}';
      crop.last_watered_at:=stamp; crop.last_watered_by:=null;
      flower:=null; -- Seeds are free; harvested flowers are inventory.
    elsif p_action='water' then
      if crop.flower is null or crop.stage>=4 then raise exception 'NOT_GROWING'; end if;
      if not p_player=any(crop.watered_by) then
        crop.watered_by:=array_append(crop.watered_by,p_player);
      end if;
      crop.last_watered_at:=stamp; crop.last_watered_by:=p_player;
      if cardinality(crop.watered_by)>=2 and crop.stage_at<=stamp-interval '18 hours' then
        crop.stage:=crop.stage+1; crop.stage_at:=stamp; crop.watered_by:='{}';
      end if;
      flower:=null;
    else
      if crop.flower is null or crop.stage<>4 then raise exception 'NOT_READY'; end if;
      old_flower:=crop.flower; flower:=null;
      crop.flower:=null; crop.stage:=0; crop.planted_by:=null; crop.stage_at:=null;
      crop.watered_by:='{}'; crop.last_watered_at:=null; crop.last_watered_by:=null;
    end if;
    update garden_plots set flower=crop.flower,stage=crop.stage,planted_by=crop.planted_by,
      stage_at=crop.stage_at,watered_by=crop.watered_by,last_watered_at=crop.last_watered_at,
      last_watered_by=crop.last_watered_by where room=p_room and plot=point;
    result:=jsonb_build_object('plot',to_jsonb(crop));
  else raise exception 'INVALID_ACTION'; end if;

  if p_action<>'equip' and old_flower is not null then
    actor.flowers:=jsonb_set(actor.flowers,array[old_flower],
      to_jsonb(coalesce((actor.flowers->>old_flower)::int,0)+1));
  end if;
  if flower is not null then
    amount:=coalesce((actor.flowers->>flower)::int,0);
    if amount<=0 then raise exception 'NO_FLOWER'; end if;
    actor.flowers:=jsonb_set(actor.flowers,array[flower],to_jsonb(amount-1));
  end if;
  update players set flowers=actor.flowers,head_flower=actor.head_flower where id=p_player;
  result:=coalesce(result,'{}') || jsonb_build_object('flowers',actor.flowers,'headFlower',actor.head_flower);
  insert into flower_receipts(room,player_id,request_id,result) values(p_room,p_player,p_request,result);
  return result;
end $$;

create or replace function read_garden(p_room text) returns setof garden_plots
language plpgsql set search_path = public as $$
begin
  update garden_plots set stage=stage+1,stage_at=clock_timestamp(),watered_by='{}'
  where room=p_room and flower is not null and stage<4 and cardinality(watered_by)>=2
    and stage_at<=clock_timestamp()-interval '18 hours';
  return query select * from garden_plots where room=p_room order by plot;
end $$;
