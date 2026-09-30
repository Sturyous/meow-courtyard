import { getSupabase, supabaseConfig, ROOM_ID } from './supabase';
import type { Appearance, DecorItem, FlowerId, GardenPlot, Identity, NoteData, NoteKind, PlayerSnapshot, SceneId } from './types';

export interface GhostData {
  id: string;
  name: string;
  snapshot: PlayerSnapshot;
  lastSeen: string;
}

export interface Recap {
  sinceHours: number;
  visits: number;
  activities: { activity: string; minutes: number }[];
  unopenedNotes: number;
}

const GHOST_AFTER_MS = 90_000;

export async function upsertPlayer(identity: Identity, snapshot: PlayerSnapshot): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from('players').upsert({
    id: identity.id,
    room: ROOM_ID,
    name: identity.name,
    appearance: identity.appearance,
    last_snapshot: snapshot,
    last_seen: new Date().toISOString(),
  });
}

export function startHeartbeat(identity: Identity, getSnapshot: () => PlayerSnapshot): () => void {
  const timer = window.setInterval(() => { void upsertPlayer(identity, getSnapshot()); }, 30_000);
  return () => window.clearInterval(timer);
}

export async function fetchGhosts(myId: string): Promise<GhostData[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('players')
    .select('id, name, last_snapshot, last_seen')
    .eq('room', ROOM_ID)
    .neq('id', myId);
  const cutoff = Date.now() - GHOST_AFTER_MS;
  return (data ?? [])
    .filter((row) => row.last_snapshot && new Date(row.last_seen as string).getTime() < cutoff)
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      snapshot: row.last_snapshot as PlayerSnapshot,
      lastSeen: row.last_seen as string,
    }));
}

// 多设备场景：列出本房间所有已登记的猫，供新设备"认领已有的猫"
export interface PlayerRecord {
  id: string;
  name: string;
  appearance: Appearance;
  lastSeen: string;
}

export async function fetchPlayers(): Promise<PlayerRecord[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('players')
    .select('id, name, appearance, last_seen')
    .eq('room', ROOM_ID)
    .order('last_seen', { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    appearance: row.appearance as Appearance,
    lastSeen: row.last_seen as string,
  }));
}

// 送走一只猫（旧设备残留的身份）：删除登记行，影子猫随之消失
export async function deletePlayer(id: string): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from('players').delete().eq('room', ROOM_ID).eq('id', id);
}

export async function recordPresence(playerId: string, event: string): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from('presence_log').insert({ room: ROOM_ID, player_id: playerId, event });
}

export function writeLeave(identity: Identity, snapshot: PlayerSnapshot): void {
  const config = supabaseConfig();
  if (!config) return;
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' };
  void fetch(`${config.url}/rest/v1/presence_log`, {
    method: 'POST',
    headers,
    keepalive: true,
    body: JSON.stringify({ room: ROOM_ID, player_id: identity.id, event: 'leave' }),
  });
  void fetch(`${config.url}/rest/v1/players`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    keepalive: true,
    body: JSON.stringify({
      id: identity.id,
      room: ROOM_ID,
      name: identity.name,
      appearance: identity.appearance,
      last_snapshot: snapshot,
      last_seen: new Date().toISOString(),
    }),
  });
}

interface NoteRow {
  id: string;
  author_id: string;
  author_name: string;
  kind: NoteKind;
  text: string;
  anchor_x: number;
  anchor_y: number;
  scene?: string;
  flower?: string | null;
  created_at: string;
  opened_at: string | null;
}

function toNote(row: NoteRow): NoteData {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    kind: row.kind,
    text: row.text,
    x: row.anchor_x,
    y: row.anchor_y,
    scene: row.scene === 'cabin' ? 'cabin' : row.scene === 'garden' ? 'garden' : 'yard',
    flower: (row.flower as FlowerId | undefined) ?? null,
    createdAt: row.created_at,
    openedAt: row.opened_at,
  };
}

export async function fetchOpenNotes(): Promise<NoteData[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db.from('notes').select('*').eq('room', ROOM_ID).is('opened_at', null);
  return (data ?? []).map((row) => toNote(row as NoteRow));
}

export async function insertNote(identity: Identity, kind: NoteKind, text: string, x: number, y: number, scene: SceneId, flower: FlowerId | null = null): Promise<NoteData | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from('notes')
    .insert({ room: ROOM_ID, author_id: identity.id, author_name: identity.name, kind, text, anchor_x: Math.round(x), anchor_y: Math.round(y), scene, flower })
    .select()
    .single();
  return data ? toNote(data as NoteRow) : null;
}

export async function markNoteOpened(noteId: string): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from('notes').update({ opened_at: new Date().toISOString() }).eq('id', noteId);
}

export async function fetchRecap(myId: string): Promise<Recap | null> {
  const db = getSupabase();
  if (!db) return null;

  const { data: leaves } = await db
    .from('presence_log')
    .select('at')
    .eq('room', ROOM_ID)
    .eq('player_id', myId)
    .eq('event', 'leave')
    .order('at', { ascending: false })
    .limit(1);
  const since = leaves?.[0]?.at as string | undefined;
  if (!since) return null;

  const { data: events } = await db
    .from('presence_log')
    .select('player_id, event, at')
    .eq('room', ROOM_ID)
    .neq('player_id', myId)
    .gt('at', since)
    .order('at', { ascending: true });

  const { count } = await db
    .from('notes')
    .select('id', { count: 'exact', head: true })
    .eq('room', ROOM_ID)
    .neq('author_id', myId)
    .is('opened_at', null);

  const rows = events ?? [];
  const visits = rows.filter((row) => row.event === 'join').length;

  // 估算各活动停留：相邻事件时间差归到前一个活动上
  const activityMs = new Map<string, number>();
  let current: { activity: string; at: number } | null = null;
  for (const row of rows) {
    const at = new Date(row.at as string).getTime();
    if (current) activityMs.set(current.activity, (activityMs.get(current.activity) ?? 0) + (at - current.at));
    if (row.event.startsWith('activity:')) current = { activity: row.event.slice(9), at };
    else current = null;
  }
  const activities = [...activityMs.entries()]
    .map(([activity, ms]) => ({ activity, minutes: Math.round(ms / 60000) }))
    .filter((entry) => entry.minutes >= 1)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 2);

  return {
    sinceHours: Math.round((Date.now() - new Date(since).getTime()) / 360_000) / 10,
    visits,
    activities,
    unopenedNotes: count ?? 0,
  };
}

// ---- 小花园 ----

interface PlotRow {
  plot: number;
  flower: string | null;
  stage: number;
  planted_by: string | null;
  stage_at: string | null;
  watered_by: string[] | null;
  last_watered_at: string | null;
  last_watered_by: string | null;
}

function toPlot(row: PlotRow): GardenPlot {
  return {
    plot: row.plot,
    flower: (row.flower as FlowerId | null) ?? null,
    stage: row.stage,
    plantedBy: row.planted_by,
    stageAt: row.stage_at,
    wateredBy: row.watered_by ?? [],
    lastWateredAt: row.last_watered_at,
    lastWateredBy: row.last_watered_by,
  };
}

export async function fetchGarden(): Promise<GardenPlot[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db.from('garden_plots').select('*').eq('room', ROOM_ID).order('plot');
  return (data ?? []).map((row) => toPlot(row as PlotRow));
}

export async function upsertPlot(plot: GardenPlot): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from('garden_plots').upsert({
    room: ROOM_ID,
    plot: plot.plot,
    flower: plot.flower,
    stage: plot.stage,
    planted_by: plot.plantedBy,
    stage_at: plot.stageAt,
    watered_by: plot.wateredBy,
    last_watered_at: plot.lastWateredAt,
    last_watered_by: plot.lastWateredBy,
  });
}

interface DecorRow {
  id: string;
  flower: string;
  scene: string;
  x: number;
  y: number;
  placed_by: string;
}

function toDecor(row: DecorRow): DecorItem {
  return {
    id: row.id,
    flower: row.flower as FlowerId,
    scene: row.scene === 'cabin' ? 'cabin' : row.scene === 'garden' ? 'garden' : 'yard',
    x: row.x,
    y: row.y,
    placedBy: row.placed_by,
  };
}

export async function fetchDecor(): Promise<DecorItem[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db.from('decor').select('*').eq('room', ROOM_ID);
  return (data ?? []).map((row) => toDecor(row as DecorRow));
}

export async function insertDecor(flower: FlowerId, scene: SceneId, x: number, y: number, placedBy: string): Promise<DecorItem | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from('decor')
    .insert({ room: ROOM_ID, flower, scene, x: Math.round(x), y: Math.round(y), placed_by: placedBy })
    .select()
    .single();
  return data ? toDecor(data as DecorRow) : null;
}

export async function deleteDecor(id: string): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from('decor').delete().eq('room', ROOM_ID).eq('id', id);
}

// ---- 花袋（players.flowers jsonb，形如 {"sunflower": 2}）----

export type FlowerBag = Partial<Record<FlowerId, number>>;

export async function fetchFlowerBag(myId: string): Promise<FlowerBag> {
  const db = getSupabase();
  if (!db) return {};
  const { data } = await db.from('players').select('flowers').eq('room', ROOM_ID).eq('id', myId).maybeSingle();
  return ((data?.flowers as FlowerBag | null) ?? {}) as FlowerBag;
}

export async function writeFlowerBag(myId: string, bag: FlowerBag): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  await db.from('players').update({ flowers: bag }).eq('room', ROOM_ID).eq('id', myId);
}
