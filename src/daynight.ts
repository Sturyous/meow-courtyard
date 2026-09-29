// 昼夜系统：把一天分成若干关键帧，相邻关键帧之间线性插值，
// 输出 multiply 叠色与灯光强度。
//
// 时间来源有五种模式（TimeMode），只影响本地渲染，不走网络：
// - local：跟随本地真实时钟（默认）——12 小时时差下，你这里的夜晚正是 TA 那里的白天；
// - partner：按 VITE_PARTNER_TZ 配置的对方时区渲染——"看看 TA 那边的院子现在什么样"；
// - day / dusk / night：手动锁定时段，用于截图、合照与测试。
// 两人想"一起看黄昏"时，各自切到同一手动档即可。

export type TimeMode = 'local' | 'partner' | 'day' | 'dusk' | 'night';

export interface DayPhase {
  label: string;
  tint: [number, number, number];
  glow: number;
}

const KEYFRAMES: { hour: number; tint: [number, number, number]; glow: number }[] = [
  { hour: 0, tint: [54, 64, 112], glow: 1 },
  { hour: 4.5, tint: [54, 64, 112], glow: 1 },
  { hour: 6.5, tint: [232, 202, 190], glow: 0.35 },
  { hour: 8, tint: [255, 255, 255], glow: 0 },
  { hour: 16.5, tint: [255, 255, 255], glow: 0 },
  { hour: 18.5, tint: [248, 182, 134], glow: 0.55 },
  { hour: 20, tint: [54, 64, 112], glow: 1 },
  { hour: 24, tint: [54, 64, 112], glow: 1 },
];

// 手动档锚点：取各自时段里氛围最足的时刻
const LOCKED_HOURS: Record<'day' | 'dusk' | 'night', number> = {
  day: 12,
  dusk: 18.25,
  night: 23,
};

let mode: TimeMode = 'local';
let partnerTz = '';

export function setTimeMode(next: TimeMode, tz = ''): void {
  mode = next;
  partnerTz = tz;
}

export function getTimeMode(): TimeMode {
  return mode;
}

function phaseLabel(hour: number): string {
  if (hour >= 5 && hour < 8) return '清晨';
  if (hour >= 8 && hour < 16.5) return '白天';
  if (hour >= 16.5 && hour < 19.5) return '黄昏';
  return '夜晚';
}

function partnerHours(): number | null {
  if (!partnerTz) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: partnerTz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24;
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    return hour + minute / 60;
  } catch {
    return null;
  }
}

function currentHours(): number {
  if (mode === 'partner') {
    const hours = partnerHours();
    if (hours !== null) return hours;
  }
  if (mode === 'day' || mode === 'dusk' || mode === 'night') return LOCKED_HOURS[mode];
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

export function dayPhase(): DayPhase {
  const hour = currentHours();
  let index = 0;
  while (index < KEYFRAMES.length - 2 && KEYFRAMES[index + 1]!.hour <= hour) index++;
  const a = KEYFRAMES[index]!;
  const b = KEYFRAMES[index + 1]!;
  const span = b.hour - a.hour;
  const t = span > 0 ? Math.min(Math.max((hour - a.hour) / span, 0), 1) : 0;
  return {
    label: phaseLabel(hour),
    tint: [
      Math.round(a.tint[0] + (b.tint[0] - a.tint[0]) * t),
      Math.round(a.tint[1] + (b.tint[1] - a.tint[1]) * t),
      Math.round(a.tint[2] + (b.tint[2] - a.tint[2]) * t),
    ],
    glow: a.glow + (b.glow - a.glow) * t,
  };
}

export function clockLabel(): string {
  const hour = currentHours();
  const whole = Math.floor(hour);
  const hh = String(whole % 24);
  const mm = String(Math.round((hour - whole) * 60) % 60).padStart(2, '0');
  const prefix = mode === 'partner'
    ? (partnerTz ? 'TA的天空' : phaseLabel(hour))
    : mode === 'local'
      ? phaseLabel(hour)
      : `${phaseLabel(hour)}·手动`;
  return `${prefix} ${hh}:${mm} · 晴`;
}
