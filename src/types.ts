export const activities = ['idle', 'walk', 'sleep', 'study', 'eat', 'play', 'toilet'] as const;
export type Activity = (typeof activities)[number];
export type PublicActivity = Exclude<Activity, 'idle' | 'walk'>;
export type Direction = 'up' | 'down' | 'left' | 'right';

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
  updatedAt: number;
}

export type RoomEvent =
  | { type: 'move'; player: PlayerSnapshot; sequence: number }
  | { type: 'activity'; player: PlayerSnapshot }
  | { type: 'appearance'; player: PlayerSnapshot }
  | { type: 'chat'; playerId: string; name: string; text: string; sentAt: number }
  | { type: 'snapshot-request'; requesterId: string }
  | { type: 'snapshot-response'; player: PlayerSnapshot };

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  sentAt: number;
  local?: boolean;
}
