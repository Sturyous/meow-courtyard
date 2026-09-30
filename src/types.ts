export const activities = ['idle', 'walk', 'sleep', 'study', 'eat', 'play', 'toilet'] as const;
export type Activity = (typeof activities)[number];
export type PublicActivity = Exclude<Activity, 'idle' | 'walk'>;
export type Direction = 'up' | 'down' | 'left' | 'right';

export type SceneId = 'yard' | 'cabin' | 'garden';

// 小花园：首批 3 种花；五阶生长（0 种子 → 4 盛开）
export type FlowerId = 'sunflower' | 'tulip' | 'rose';
export const flowers = ['sunflower', 'tulip', 'rose'] as const;
export const FLOWER_STAGES = 5;

export interface Appearance {
  breed: '田园猫' | '英短' | '暹罗' | '长毛猫' | '缅因猫' | '布偶猫' | '孟加拉豹猫' | '德文卷毛猫' | '挪威森林猫';
  coat: '橘白' | '奶牛' | '狸花' | '三花' | '银灰' | '奶油' | '玳瑁' | '重点色' | '金渐层' | '纯黑' | '蓝白' | '阿比西尼亚';
  colors: [string, string, string];
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  direction: Direction;
  activity: Activity;
  appearance: Appearance;
  cosleepWith: string | null;
  scene: SceneId;
  headFlower?: FlowerId | null;
  updatedAt: number;
}

export const emotes = ['heart', 'zzz', 'question', 'fish', 'star', 'angry'] as const;
export type Emote = (typeof emotes)[number];

export type DuetKind = 'nuzzle' | 'cosleep';

export type NoteKind = 'note' | 'treat';

export interface NoteData {
  id: string;
  authorId: string;
  authorName: string;
  kind: NoteKind;
  text: string;
  x: number;
  y: number;
  scene: SceneId;
  flower: FlowerId | null;
  createdAt: string;
  openedAt: string | null;
}

// 花圃一坑的状态（对应 garden_plots 表一行）
export interface GardenPlot {
  plot: number;
  flower: FlowerId | null;
  stage: number;
  plantedBy: string | null;
  stageAt: string | null;
  wateredBy: string[];
  lastWateredAt: string | null;
  lastWateredBy: string | null;
}

// 种在门口/场景里的装饰花（对应 decor 表一行）
export interface DecorItem {
  id: string;
  flower: FlowerId;
  scene: SceneId;
  x: number;
  y: number;
  placedBy: string;
}

export type RoomEvent =
  | { type: 'move'; player: PlayerSnapshot; sequence: number }
  | { type: 'activity'; player: PlayerSnapshot }
  | { type: 'appearance'; player: PlayerSnapshot }
  | { type: 'chat'; playerId: string; name: string; text: string; sentAt: number }
  | { type: 'snapshot-request'; requesterId: string }
  | { type: 'snapshot-response'; player: PlayerSnapshot }
  | { type: 'note-placed'; note: NoteData }
  | { type: 'note-opened'; noteId: string }
  | { type: 'interact-invite'; from: string; fromName: string; to: string; kind: DuetKind }
  | { type: 'interact-accept'; from: string; to: string; kind: DuetKind }
  | { type: 'interact-decline'; from: string; to: string; kind: DuetKind }
  | { type: 'emote'; playerId: string; emote: Emote }
  | { type: 'garden-updated'; plot: GardenPlot }
  | { type: 'decor-placed'; decor: DecorItem }
  | { type: 'decor-removed'; decorId: string };

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  sentAt: number;
  local?: boolean;
}

export interface PresenceMember {
  id: string;
  joinedAt: string;
}

export interface Identity {
  id: string;
  name: string;
  appearance: Appearance;
}
