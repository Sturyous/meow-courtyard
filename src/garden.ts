// 小花园：星露谷式共同种植。
// 规则定稿（2026-09-30）：
// - 双方都浇才长一阶（wateredBy 集齐两个不同玩家，且距上一阶 >= STAGE_GAP_MS）；
// - 每人的生长贡献只计一次；重复浇水仍可保鲜；阶段推进由数据库读取/操作处理；
// - 72h 未浇水 → 渲染低头耷拉（读时推导，不写库），浇水即恢复，永不枯死。
import { FLOWER_STAGES } from './types';
import type { FlowerId, GardenPlot } from './types';

export const STAGE_GAP_MS = 18 * 3600_000;   // 两阶段之间最短间隔，防双人在线连浇冲阶段
export const WILT_AFTER_MS = 72 * 3600_000;  // 超过则低头耷拉
export const PLOT_COUNT = 6;

export const FLOWER_META: Record<FlowerId, { name: string; icon: string; petal: string; petalDark: string; core: string }> = {
  sunflower: { name: '向日葵', icon: '🌻', petal: '#f2b73c', petalDark: '#d69a26', core: '#6b4226' },
  tulip: { name: '郁金香', icon: '🌷', petal: '#e2607e', petalDark: '#c04462', core: '#f4d789' },
  rose: { name: '玫瑰', icon: '🌹', petal: '#c93a4e', petalDark: '#a32840', core: '#e8b7c0' },
};

export const STAGE_NAMES = ['种子', '发芽', '幼苗', '花苞', '盛开'] as const;

// 花园场景内 6 个花位：两行三列（对齐 garden-bg.png 的空旷草地，避开石板路与洒水壶）
export const PLOT_SPOTS = [
  { x: 190, y: 348 }, { x: 480, y: 348 }, { x: 770, y: 348 },
  { x: 190, y: 484 }, { x: 480, y: 484 }, { x: 770, y: 484 },
] as const;

export function emptyPlot(plot: number): GardenPlot {
  return { plot, flower: null, stage: 0, plantedBy: null, stageAt: null, wateredBy: [], lastWateredAt: null, lastWateredBy: null };
}

export function isWilted(plot: GardenPlot, now = Date.now()): boolean {
  if (!plot.flower || plot.stage >= FLOWER_STAGES - 1 || !plot.lastWateredAt) return false;
  return now - new Date(plot.lastWateredAt).getTime() > WILT_AFTER_MS;
}

export function hasWatered(plot: GardenPlot, playerId: string): boolean {
  return plot.wateredBy.includes(playerId);
}

const STEM = '#4d7a3a';
const STEM_DARK = '#3a5f2c';
const LEAF = '#5c9040';
const WILT_STEM = '#7a6b3f';
const WILT_PETAL = '#9c8a5a';
const SOIL = '#6e4a2e';
const SOIL_DARK = '#54371f';
const SOIL_LIGHT = '#865c3a';

// 一朵盛开的花头（中心在 0,0），scale=1 时约 22px 宽
export function drawFlowerHead(ctx: CanvasRenderingContext2D, flower: FlowerId, scale = 1, sway = 0, wilted = false): void {
  const meta = FLOWER_META[flower];
  const petal = wilted ? WILT_PETAL : meta.petal;
  const petalDark = wilted ? WILT_PETAL : meta.petalDark;
  const core = wilted ? '#5c4f33' : meta.core;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.rotate(sway * 0.14 + (wilted ? 0.9 : 0));
  const p = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  if (flower === 'sunflower') {
    // 8 瓣 + 深芯
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = Math.round(Math.cos(a) * 7) - 2;
      const py = Math.round(Math.sin(a) * 7) - 3;
      p(px, py, 5, 6, i % 2 ? petal : petalDark);
    }
    p(-4, -4, 8, 8, core);
    p(-2, -2, 2, 2, '#4a2c18');
    p(1, 1, 2, 2, '#4a2c18');
  } else if (flower === 'tulip') {
    // 杯状三瓣
    p(-6, -6, 12, 9, petal);
    p(-6, -6, 4, 4, petalDark);
    p(2, -6, 4, 4, petalDark);
    p(-2, -8, 4, 5, petal);
    p(-4, 3, 8, 2, petalDark);
    p(-1, -3, 2, 4, core);
  } else {
    // 玫瑰：旋心
    p(-6, -6, 12, 12, petal);
    p(-6, -6, 12, 3, petalDark);
    p(-6, 3, 12, 3, petalDark);
    p(-3, -3, 6, 6, petalDark);
    p(-1, -1, 3, 3, core);
  }
  ctx.restore();
}

// 单坑渲染：土坑 + 当前阶段作物（wilted 时弯茎棕色）
export function drawPlot(ctx: CanvasRenderingContext2D, plot: GardenPlot, spot: { x: number; y: number }, frame: number, now = Date.now()): void {
  const { x, y } = spot;
  const p = (dx: number, dy: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x + dx, y + dy, w, h); };
  // 翻土坑 44×26
  p(-22, -10, 44, 22, SOIL_DARK);
  p(-20, -12, 40, 22, SOIL);
  p(-16, -8, 32, 3, SOIL_LIGHT);
  p(-16, -1, 32, 3, SOIL_LIGHT);
  p(-16, 6, 32, 3, SOIL_LIGHT);
  if (!plot.flower) return;

  const wilted = isWilted(plot, now);
  const stem = wilted ? WILT_STEM : STEM;
  // frame 是毫秒；约 5.7 秒一轮，茎与花头共用相位。
  const sway = Math.sin(frame / 900 + plot.plot * 1.7) * (plot.stage >= 3 ? 1 : 0.4);
  const bend = wilted ? 5 : 0;
  const stage = plot.stage;

  if (stage === 0) {
    // 种子：两粒小点
    p(-3, -4, 3, 3, '#d9c08a');
    p(2, -2, 3, 3, '#c2a568');
    return;
  }
  // 茎高随阶段
  const stemH = [0, 8, 15, 22, 26][stage] ?? 26;
  const baseY = y - 8;
  ctx.fillStyle = stem;
  for (let i = 0; i < stemH; i += 2) {
    const t = i / stemH;
    const dx = Math.round(bend * t * t + sway * t);
    ctx.fillRect(x + dx - 1, baseY - i, 3, 2);
  }
  const topX = x + Math.round(bend + sway);
  const topY = baseY - stemH;
  if (stage >= 2) {
    // 叶子
    ctx.fillStyle = wilted ? WILT_STEM : LEAF;
    ctx.fillRect(x - 7 + Math.round(sway * 0.5), baseY - Math.round(stemH * 0.5), 6, 3);
    ctx.fillRect(x + 2 + Math.round(sway * 0.5), baseY - Math.round(stemH * 0.7), 6, 3);
  }
  if (stage === 3) {
    // 花苞
    ctx.fillStyle = wilted ? WILT_PETAL : FLOWER_META[plot.flower].petalDark;
    ctx.fillRect(topX - 3, topY - 6, 7, 7);
    ctx.fillStyle = wilted ? WILT_STEM : LEAF;
    ctx.fillRect(topX - 4, topY + 1, 9, 3);
  }
  if (stage >= 4) {
    ctx.save();
    ctx.translate(topX + 1, topY - 4);
    drawFlowerHead(ctx, plot.flower, 1, sway * 0.6, wilted);
    ctx.restore();
  }
}

// 别在猫头上的小花（含短茎，中心锚点）
export function drawHeadFlower(ctx: CanvasRenderingContext2D, flower: FlowerId, frame: number): void {
  ctx.fillStyle = STEM;
  ctx.fillRect(-1, 2, 2, 5);
  ctx.fillStyle = LEAF;
  ctx.fillRect(1, 5, 4, 2);
  drawFlowerHead(ctx, flower, 0.62, Math.sin(frame / 900) * 0.4, false);
}

// 装饰花（种在门口/场景里）：带土坨与整茎
export function drawDecorFlower(ctx: CanvasRenderingContext2D, flower: FlowerId, x: number, y: number, frame: number): void {
  const sway = Math.sin(frame / 900 + x * 0.05);
  ctx.fillStyle = SOIL_DARK;
  ctx.fillRect(x - 6, y - 3, 13, 6);
  ctx.fillStyle = SOIL;
  ctx.fillRect(x - 5, y - 4, 11, 5);
  ctx.fillStyle = STEM;
  ctx.fillRect(x - 1 + Math.round(sway * 0.4), y - 18, 3, 15);
  ctx.fillStyle = LEAF;
  ctx.fillRect(x - 6, y - 11, 5, 3);
  ctx.fillRect(x + 2, y - 14, 5, 3);
  ctx.save();
  ctx.translate(x + Math.round(sway), y - 22);
  drawFlowerHead(ctx, flower, 0.85, sway * 0.6, false);
  ctx.restore();
}

// 浇水水珠粒子颜色
export const WATER_COLORS = ['#9fd4e8', '#6fb4d8', '#cfeaf5'];

// 花园兜底背景（背景图缺失时的代码场景，与庭院兜底同风格）
export function drawGardenFallback(ctx: CanvasRenderingContext2D, width: number, height: number, frame: number): void {
  ctx.fillStyle = '#6f9154';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#67904e';
  for (let gx = 0; gx < width; gx += 64) {
    for (let gy = 0; gy < height; gy += 64) {
      if (((gx + gy) / 64) % 2 === 0) ctx.fillRect(gx, gy, 64, 64);
    }
  }
  ctx.strokeStyle = '#7a5633';
  ctx.lineWidth = 10;
  ctx.strokeRect(24, 30, width - 48, height - 60);
  // 顶部石板路（回庭院）
  ctx.fillStyle = '#b3a58f';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(width / 2 - 26 + (i % 2) * 8, 34 + i * 26, 44 - (i % 2) * 10, 18);
  }
  // 草丛点缀
  ctx.fillStyle = '#5d8a47';
  for (let i = 0; i < 26; i++) {
    const px = (i * 173 + 97) % (width - 120) + 60;
    const py = (i * 211 + 53) % (height - 200) + 120;
    ctx.fillRect(px, py, 6, 4);
    ctx.fillRect(px + 8, py + 2, 4, 4);
  }
  void frame;
}

// 花圃场景的木牌文案（与 drawSceneSign 同风格，由 game 调用）
export const GARDEN_SIGN = { x: 566, y: 208 };
