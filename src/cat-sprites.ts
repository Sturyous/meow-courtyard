import type { Activity, Appearance, Direction, FlowerId } from './types';
import { drawHeadFlower } from './garden';

const atlas = new Image(); atlas.src = '/assets/cat-atlas.png';
const actions = new Image(); actions.src = '/assets/cat-actions.png';
const columns = [{ x: 10, width: 210 }, { x: 230, width: 215 }, { x: 452, width: 215 }, { x: 675, width: 205 }];
const rows = [{ y: 60, height: 240 }, { y: 330, height: 210 }, { y: 575, height: 235 }, { y: 850, height: 210 }, { y: 1105, height: 240 }, { y: 1465, height: 210 }];
const frames = new Map<string, HTMLCanvasElement>();
// Observed foot baselines in the exported action sheet; normalize without resizing poses.
const ground = [[.96,.96,.96,.96],[.90,.87,.86,.86],[.82,.82,.82,.82],[.76,.76,.76,.76]];

// Uniform 64x64 cells, ground anchor (32,52). Keep eyes and pink ears unchanged.
function frame(image: HTMLImageElement, row: number, column: number, appearance: Appearance): HTMLCanvasElement | null {
  if (!image.complete || !image.naturalWidth) return null;
  const key = `${image.src}:${row}:${column}:${appearance.coat}`;
  const cached = frames.get(key); if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  if (image === actions) {
    const size = image.naturalWidth / 4;
    ctx.drawImage(image, column * size, row * size, size, size, 0, Math.round(52 - ground[row]![column]! * 64), 64, 64);
  } else {
    const c = columns[column]!; const r = rows[row]!;
    ctx.drawImage(image, c.x, r.y, c.width, r.height, 5, 4, 54, 54);
  }
  const pixels = ctx.getImageData(0, 0, 64, 64);
  const base = appearance.colors[0].match(/\w\w/g)!.map(v => parseInt(v, 16));
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i]!; const g = pixels.data[i + 1]!; const b = pixels.data[i + 2]!;
    if (!pixels.data[i + 3] || r < 45 || (r > g * 1.3 && b > g * .75 && g > 65)) continue;
    const light = (r + g + b) / 3 / 255;
    for (let channel = 0; channel < 3; channel++) {
      const shade = light < .65 ? base[channel]! * (.42 + light * .8) : base[channel]! + (255 - base[channel]!) * ((light - .65) / .35);
      pixels.data[i + channel] = Math.round(shade);
    }
  }
  ctx.putImageData(pixels, 0, 0); frames.set(key, canvas); return canvas;
}

export function drawCatSprite(ctx: CanvasRenderingContext2D, player: { x: number; y: number; activity: Activity; direction: Direction; appearance: Appearance; headFlower?: FlowerId | null; nuzzleWith?: string | null }, time: number): boolean {
  const { activity, direction, appearance } = player;
  const special = activity === 'eat' ? 0 : activity === 'toilet' ? 1 : player.nuzzleWith ? 2 : activity === 'sleep' ? 3 : null;
  const row = special ?? (direction === 'right' ? 1 : direction === 'up' ? 2 : direction === 'left' ? 3 : activity === 'walk' ? 0 : 4);
  const column = special !== null ? activity === 'sleep' ? 1 + Math.floor(time / 900) % 2 : Math.floor(time / (activity === 'eat' ? 320 : 420)) % 4 : activity === 'walk' ? Math.floor(time / 145) % 4 : Math.floor(time / 700) % 2;
  const sprite = frame(special !== null ? actions : atlas, row, column, appearance);
  if (!sprite) return false;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(player.x), Math.round(player.y));
  if (special !== null && direction === 'left' && activity !== 'sleep') ctx.scale(-1, 1);
  ctx.drawImage(sprite, -40, -65, 80, 80);
  ctx.restore();
  if (player.headFlower && direction !== 'up') {
    ctx.save(); ctx.translate(Math.round(player.x) + (direction === 'left' ? -12 : 12), Math.round(player.y) - (activity === 'sleep' ? 26 : 48));
    drawHeadFlower(ctx, player.headFlower, time); ctx.restore();
  }
  return true;
}

export function drawIdentityPreview(canvas: HTMLCanvasElement, appearance: Appearance): void {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const render = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.scale(canvas.width / 96, canvas.height / 96);
    drawCatSprite(ctx, { x: 48, y: 74, activity: 'idle', direction: 'down', appearance }, 0);
    ctx.restore();
  };
  if (atlas.complete) render(); else atlas.addEventListener('load', render, { once: true });
}
