import type { Activity, Appearance, Direction, PlayerSnapshot, PublicActivity } from './types';

const WORLD = { width: 960, height: 640 };
const YARD = { left: 46, top: 72, right: 914, bottom: 592 };
const CAT_RADIUS = 15;
const SPEED = 112;
const courtyardImage = loadImage('/assets/courtyard-bg.png');
const catAtlas = loadImage('/assets/cat-atlas.png');
const catSquat = loadImage('/assets/cat-squat-v1.png');
const atlasColumns = [
  { x: 10, width: 210 },
  { x: 230, width: 215 },
  { x: 452, width: 215 },
  { x: 675, width: 205 },
] as const;
const atlasRows = [
  { y: 60, height: 240 },
  { y: 330, height: 210 },
  { y: 575, height: 235 },
  { y: 850, height: 210 },
  { y: 1105, height: 240 },
  { y: 1465, height: 210 },
] as const;

const beds = [
  { x: 143, y: 148, color: '#d98273' },
  { x: 231, y: 148, color: '#7ca6a1' },
  { x: 143, y: 225, color: '#b08dbe' },
  { x: 231, y: 225, color: '#d1a95f' },
];

const targets: Record<Exclude<PublicActivity, 'play' | 'sleep'>, { x: number; y: number }> = {
  study: { x: 674, y: 205 },
  eat: { x: 159, y: 470 },
  toilet: { x: 806, y: 432 },
};

const coatPalettes: Record<Appearance['coat'], [string, string, string]> = {
  橘白: ['#d9863b', '#f8e8c7', '#6e4028'],
  奶牛: ['#f4ead6', '#383638', '#d79285'],
  狸花: ['#8a704f', '#433a31', '#d5b878'],
  三花: ['#eee0c4', '#ce7442', '#4a4038'],
  银灰: ['#9ba6ad', '#e4e0d5', '#4e5961'],
  奶油: ['#e8c987', '#fff0c9', '#9b6c45'],
  玳瑁: ['#4b362e', '#c8753f', '#241f20'],
  重点色: ['#e9d9bc', '#58463f', '#8ab1c6'],
  金渐层: ['#c99645', '#f2d69b', '#5b4432'],
  纯黑: ['#29272a', '#555159', '#111114'],
  蓝白: ['#748594', '#f2eadb', '#34404a'],
  阿比西尼亚: ['#a8613d', '#d99a62', '#56382b'],
};

const breeds: Appearance['breed'][] = ['田园猫', '英短', '暹罗', '长毛猫', '缅因猫', '布偶猫', '孟加拉豹猫', '德文卷毛猫', '挪威森林猫'];
const coats = Object.keys(coatPalettes) as Appearance['coat'][];

interface GameCallbacks {
  onMovement: (snapshot: PlayerSnapshot) => void;
  onActivity: (snapshot: PlayerSnapshot) => void;
  onAppearance: (snapshot: PlayerSnapshot) => void;
}

interface RemotePlayer extends PlayerSnapshot {
  targetX: number;
  targetY: number;
  lastSequence: number;
}

export class CourtyardGame {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pressed = new Set<string>();
  private readonly remotes = new Map<string, RemotePlayer>();
  private readonly callbacks: GameCallbacks;
  private local: PlayerSnapshot;
  private lastFrame = performance.now();
  private lastNetworkMove = 0;
  private lastMoving = false;
  private autoTarget: { x: number; y: number } | null = null;
  private pendingActivity: PublicActivity | null = null;
  private frame = 0;
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement, id: string, callbacks: GameCallbacks) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 Canvas 2D');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.callbacks = callbacks;
    this.local = {
      id,
      name: '你',
      x: 480 + randomInt(-55, 55),
      y: 350 + randomInt(-30, 30),
      direction: 'down',
      activity: 'idle',
      appearance: randomAppearance(),
      updatedAt: Date.now(),
    };
    this.bindInput();
    requestAnimationFrame(this.loop);
  }

  getSnapshot(): PlayerSnapshot {
    return structuredClone({ ...this.local, updatedAt: Date.now() });
  }

  addOrUpdateRemote(snapshot: PlayerSnapshot, sequence = 0): void {
    if (snapshot.id === this.local.id || !validSnapshot(snapshot)) return;
    const existing = this.remotes.get(snapshot.id);
    if (existing && sequence > 0 && sequence <= existing.lastSequence) return;
    if (existing) {
      existing.targetX = snapshot.x;
      existing.targetY = snapshot.y;
      existing.direction = snapshot.direction;
      existing.activity = snapshot.activity;
      existing.appearance = snapshot.appearance;
      existing.name = snapshot.name;
      existing.updatedAt = Date.now();
      existing.lastSequence = Math.max(existing.lastSequence, sequence);
      return;
    }
    this.remotes.set(snapshot.id, {
      ...structuredClone(snapshot),
      targetX: snapshot.x,
      targetY: snapshot.y,
      lastSequence: sequence,
    });
  }

  removeRemote(id: string): void {
    this.remotes.delete(id);
  }

  retainRemotes(ids: Set<string>): void {
    for (const id of this.remotes.keys()) {
      if (!ids.has(id)) this.remotes.delete(id);
    }
  }

  setActivity(activity: PublicActivity): void {
    this.pendingActivity = activity === 'play' ? null : activity;
    this.local.activity = activity === 'play' ? 'play' : 'walk';
    this.autoTarget = activity === 'play'
      ? null
      : activity === 'sleep'
        ? { ...beds[hashString(this.local.id) % beds.length]! }
        : { ...targets[activity] };
    this.local.updatedAt = Date.now();
    this.callbacks.onActivity(this.getSnapshot());
  }

  rerollAppearance(): void {
    this.local.appearance = randomAppearance(this.local.appearance);
    this.local.updatedAt = Date.now();
    this.callbacks.onAppearance(this.getSnapshot());
  }

  destroy(): void {
    this.destroyed = true;
  }

  private bindInput(): void {
    const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D']);
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (movementKeys.has(event.key)) {
        event.preventDefault();
        this.pressed.add(event.key.toLowerCase());
      }
    });
    window.addEventListener('keyup', (event) => this.pressed.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.pressed.clear());

    this.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const point = this.canvasPoint(event.clientX, event.clientY);
      if (Math.hypot(point.x - this.local.x, point.y - this.local.y) < 38) this.rerollAppearance();
    });

    document.querySelectorAll<HTMLButtonElement>('.mobile-pad button').forEach((button) => {
      const key = button.dataset.key?.toLowerCase();
      if (!key) return;
      const press = (event: Event) => { event.preventDefault(); this.pressed.add(key); };
      const release = (event: Event) => { event.preventDefault(); this.pressed.delete(key); };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', release);
    });
  }

  private canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * WORLD.width / rect.width, y: (clientY - rect.top) * WORLD.height / rect.height };
  }

  private readonly loop = (now: number): void => {
    if (this.destroyed) return;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.frame = now;
    this.update(dt, now);
    this.draw();
    requestAnimationFrame(this.loop);
  };

  private update(dt: number, now: number): void {
    let dx = 0;
    let dy = 0;
    if (this.pressed.has('arrowleft') || this.pressed.has('a')) dx -= 1;
    if (this.pressed.has('arrowright') || this.pressed.has('d')) dx += 1;
    if (this.pressed.has('arrowup') || this.pressed.has('w')) dy -= 1;
    if (this.pressed.has('arrowdown') || this.pressed.has('s')) dy += 1;

    if (dx || dy) {
      this.autoTarget = null;
      this.pendingActivity = null;
      this.local.activity = 'walk';
      const length = Math.hypot(dx, dy);
      this.moveLocal(dx / length * SPEED * dt, dy / length * SPEED * dt);
      this.local.direction = directionFromVector(dx, dy);
    } else if (this.autoTarget) {
      const tx = this.autoTarget.x - this.local.x;
      const ty = this.autoTarget.y - this.local.y;
      const distance = Math.hypot(tx, ty);
      if (distance < 3) {
        this.local.x = this.autoTarget.x;
        this.local.y = this.autoTarget.y;
        this.autoTarget = null;
        this.local.activity = this.pendingActivity ?? 'idle';
        this.pendingActivity = null;
        this.callbacks.onActivity(this.getSnapshot());
      } else {
        const step = Math.min(SPEED * 0.82 * dt, distance);
        this.moveLocal(tx / distance * step, ty / distance * step);
        this.local.direction = directionFromVector(tx, ty);
      }
    } else if (this.local.activity === 'walk') {
      this.local.activity = 'idle';
    }

    const moving = dx !== 0 || dy !== 0 || this.autoTarget !== null;
    if (moving && now - this.lastNetworkMove >= 170) {
      this.lastNetworkMove = now;
      this.callbacks.onMovement(this.getSnapshot());
    }
    if (!moving && this.lastMoving) this.callbacks.onMovement(this.getSnapshot());
    this.lastMoving = moving;

    for (const remote of this.remotes.values()) {
      remote.x += (remote.targetX - remote.x) * Math.min(1, dt * 9);
      remote.y += (remote.targetY - remote.y) * Math.min(1, dt * 9);
    }
  }

  private moveLocal(dx: number, dy: number): void {
    this.local.x = clamp(this.local.x + dx, YARD.left + CAT_RADIUS, YARD.right - CAT_RADIUS);
    this.local.y = clamp(this.local.y + dy, YARD.top + CAT_RADIUS, YARD.bottom - CAT_RADIUS);
    this.local.updatedAt = Date.now();
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    drawCourtyard(ctx, this.frame);
    const players = [...this.remotes.values(), this.local].sort((a, b) => a.y - b.y);
    for (const player of players) drawCat(ctx, player, this.frame, player.id === this.local.id);
  }
}

function drawCourtyard(ctx: CanvasRenderingContext2D, time: number): void {
  if (courtyardImage.complete && courtyardImage.naturalWidth > 0) {
    ctx.save();
    ctx.filter = 'saturate(90%)';
    ctx.drawImage(courtyardImage, 0, 0, 960, 640);
    ctx.restore();
    return;
  }
  ctx.fillStyle = '#2e3030'; ctx.fillRect(0, 0, 960, 640);
  ctx.fillStyle = '#728b55'; ctx.fillRect(38, 64, 884, 536);
  for (let y = 76; y < 592; y += 16) for (let x = 48; x < 914; x += 16) {
    const n = hash(x, y);
    ctx.fillStyle = n > 0.75 ? '#82975e' : n < 0.18 ? '#657d4b' : '#748b53';
    ctx.fillRect(x + (n > .5 ? 2 : 8), y + (n > .5 ? 8 : 3), 3, 3);
  }

  // warm stone path
  ctx.fillStyle = '#b89c71'; ctx.fillRect(438, 64, 86, 536);
  for (let y = 76; y < 590; y += 28) {
    ctx.fillStyle = y % 56 ? '#cbb086' : '#a98e68';
    ctx.fillRect(446 + (y % 56 ? 0 : 8), y, 66, 20);
  }

  // fence and gate
  ctx.fillStyle = '#69462f'; ctx.fillRect(38, 60, 884, 12); ctx.fillRect(38, 592, 382, 10); ctx.fillRect(542, 592, 380, 10);
  ctx.fillStyle = '#a56d3f';
  for (let x = 44; x < 920; x += 38) { ctx.fillRect(x, 52, 9, 27); ctx.fillRect(x, 582, 9, 24); }
  ctx.fillStyle = '#d0a45c'; ctx.fillRect(420, 584, 122, 7);

  // flower beds
  ctx.fillStyle = '#57462f'; ctx.fillRect(64, 260, 128, 78); ctx.fillRect(768, 268, 126, 74);
  ctx.fillStyle = '#77573c'; ctx.fillRect(69, 265, 118, 68); ctx.fillRect(773, 273, 116, 64);
  const flowers = ['#e9b55e', '#d66b70', '#f4df9a', '#9e78a8'];
  for (let i = 0; i < 16; i++) {
    const x = i < 8 ? 78 + (i % 4) * 28 : 782 + (i % 4) * 28;
    const y = i < 8 ? 277 + Math.floor(i / 4) * 34 : 285 + Math.floor((i - 8) / 4) * 30;
    ctx.fillStyle = '#426341'; ctx.fillRect(x + 3, y + 5, 3, 12);
    ctx.fillStyle = flowers[i % flowers.length]!; ctx.fillRect(x, y, 9, 7); ctx.fillRect(x + 3, y - 3, 4, 13);
  }

  // beds
  for (const bed of beds) drawBed(ctx, bed.x, bed.y, bed.color);
  // study table
  ctx.fillStyle = '#513824'; ctx.fillRect(650, 114, 160, 62); ctx.fillRect(660, 172, 12, 39); ctx.fillRect(790, 172, 12, 39);
  ctx.fillStyle = '#9c673e'; ctx.fillRect(642, 105, 176, 66); ctx.fillStyle = '#c68a50'; ctx.fillRect(651, 112, 158, 45);
  ctx.fillStyle = '#f2ddaa'; ctx.fillRect(684, 119, 38, 28); ctx.fillRect(727, 119, 38, 28); ctx.fillStyle = '#775c8e'; ctx.fillRect(722, 120, 5, 26);
  ctx.fillStyle = '#d9ae55'; ctx.fillRect(775, 117, 16, 10); ctx.fillStyle = '#fff1a9'; ctx.fillRect(779, 111, 8, 7);

  // bowls
  ctx.fillStyle = '#704b36'; ctx.fillRect(117, 476, 85, 10); ctx.fillStyle = '#e3b357'; ctx.fillRect(126, 463, 28, 18); ctx.fillStyle = '#79a9ad'; ctx.fillRect(164, 463, 28, 18);
  ctx.fillStyle = '#4a382b'; ctx.fillRect(132, 466, 16, 5); ctx.fillStyle = '#9ed1d1'; ctx.fillRect(170, 466, 16, 5);

  // litter box
  ctx.fillStyle = '#516e76'; ctx.fillRect(754, 476, 82, 47); ctx.fillStyle = '#7eabb0'; ctx.fillRect(761, 468, 68, 47); ctx.fillStyle = '#d7c295'; ctx.fillRect(768, 476, 54, 30);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#b69c6d' : '#e7d4a7'; ctx.fillRect(772 + i * 6, 483 + (i % 3) * 6, 3, 3); }

  // lanterns
  for (const x of [420, 536]) {
    ctx.fillStyle = '#493625'; ctx.fillRect(x, 398, 7, 94); ctx.fillStyle = '#bd7d3d'; ctx.fillRect(x - 8, 395, 23, 28);
    ctx.fillStyle = `rgba(255, 223, 128, ${0.65 + Math.sin(time / 300 + x) * .1})`; ctx.fillRect(x - 3, 401, 13, 15);
  }
}

function drawBed(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = '#543927'; ctx.fillRect(x - 33, y - 27, 66, 47);
  ctx.fillStyle = color; ctx.fillRect(x - 28, y - 21, 56, 35);
  ctx.fillStyle = '#ead5ad'; ctx.fillRect(x - 22, y - 16, 44, 22);
  ctx.fillStyle = '#c9a879'; ctx.fillRect(x - 30, y + 12, 60, 9);
}

function drawCat(ctx: CanvasRenderingContext2D, player: PlayerSnapshot, time: number, own: boolean): void {
  if (catAtlas.complete && catAtlas.naturalWidth > 0) {
    drawAtlasCat(ctx, player, time, own);
    return;
  }
  const { x, y, appearance, activity, direction } = player;
  const [base, light, dark] = appearance.colors;
  const moving = activity === 'walk';
  const bob = moving ? Math.round(Math.sin(time / 95 + x) * 2) : activity === 'play' ? Math.round(Math.sin(time / 120) * 2) : 0;
  const px = Math.round(x); const py = Math.round(y + bob);

  ctx.fillStyle = 'rgba(40, 37, 30, .24)'; ctx.fillRect(px - 17, Math.round(y) + 13, 34, 7);

  if (activity === 'sleep') {
    ctx.fillStyle = base; ctx.fillRect(px - 14, py - 4, 28, 15); ctx.fillRect(px - 10, py - 10, 20, 10);
    ctx.fillStyle = dark; ctx.fillRect(px - 13, py - 11, 7, 7); ctx.fillRect(px + 6, py - 11, 7, 7);
    ctx.fillStyle = '#e8c27b'; ctx.fillRect(px - 19, py + 2, 38, 16); ctx.fillStyle = '#c78b62'; ctx.fillRect(px - 19, py + 2, 38, 5);
    ctx.fillStyle = '#4b4236'; ctx.fillRect(px - 6, py - 2, 4, 2); ctx.fillRect(px + 4, py - 2, 4, 2);
    drawLabel(ctx, player, own, py - 24); return;
  }

  if (activity === 'play') {
    const bx = px + Math.round(Math.sin(time / 210) * 23);
    ctx.fillStyle = '#d45d63'; ctx.fillRect(bx - 5, py + 13, 10, 10); ctx.fillStyle = '#f2a0a0'; ctx.fillRect(bx - 2, py + 14, 3, 3);
    ctx.strokeStyle = '#e5d6ae'; ctx.beginPath(); ctx.moveTo(bx, py + 13); ctx.quadraticCurveTo(px + 4, py - 5, px, py + 2); ctx.stroke();
  }

  const longhair = appearance.breed === '长毛猫';
  const round = appearance.breed === '英短';
  const bodyW = round ? 29 : 26;
  ctx.fillStyle = base; ctx.fillRect(px - bodyW / 2, py - 2, bodyW, 18 + (longhair ? 4 : 0));
  ctx.fillStyle = dark;
  if (direction === 'left') ctx.fillRect(px + 10, py - 1, 14, 5);
  else if (direction === 'right') ctx.fillRect(px - 24, py - 1, 14, 5);
  else { ctx.fillRect(px + 9, py + 2, 6, 16); ctx.fillRect(px + 13, py - 2, 5, 8); }

  ctx.fillStyle = base; ctx.fillRect(px - 12, py - 16, 24, 19);
  ctx.fillStyle = dark; ctx.fillRect(px - 11, py - 22, 8, 9); ctx.fillRect(px + 3, py - 22, 8, 9);
  ctx.fillStyle = '#d99b9a'; ctx.fillRect(px - 8, py - 19, 3, 3); ctx.fillRect(px + 5, py - 19, 3, 3);

  // coat markings
  ctx.fillStyle = light; ctx.fillRect(px - 7, py - 5, 14, 13); ctx.fillRect(px - 7, py - 10, 14, 8);
  if (appearance.coat === '奶牛' || appearance.coat === '三花') { ctx.fillStyle = dark; ctx.fillRect(px - 11, py - 14, 8, 8); ctx.fillRect(px + 4, py + 2, 9, 8); }
  if (appearance.coat === '狸花') { ctx.fillStyle = dark; ctx.fillRect(px - 5, py - 15, 3, 6); ctx.fillRect(px + 2, py - 15, 3, 6); ctx.fillRect(px - 9, py + 2, 4, 3); }
  if (appearance.breed === '暹罗') { ctx.fillStyle = '#5a483c'; ctx.fillRect(px - 8, py - 14, 16, 10); }

  ctx.fillStyle = '#29332b';
  if (activity === 'eat') { ctx.fillRect(px - 5, py - 4, 3, 2); ctx.fillRect(px + 3, py - 4, 3, 2); }
  else { ctx.fillRect(px - 6, py - 9, 3, 4); ctx.fillRect(px + 4, py - 9, 3, 4); }
  ctx.fillStyle = '#b7676d'; ctx.fillRect(px - 1, py - 5, 3, 2);
  ctx.fillStyle = dark;
  const step = moving && Math.sin(time / 95) > 0 ? 3 : 0;
  ctx.fillRect(px - 10, py + 12, 7, 6 + step); ctx.fillRect(px + 4, py + 12, 7, 9 - step);

  if (activity === 'study') {
    ctx.fillStyle = '#f1d692'; ctx.fillRect(px + 13, py - 19, 12, 15); ctx.fillStyle = '#8b5a43'; ctx.fillRect(px + 17, py - 17, 3, 11);
  }
  if (activity === 'toilet') { ctx.fillStyle = '#d7c295'; ctx.fillRect(px - 18, py + 13, 36, 6); }
  drawLabel(ctx, player, own, py - 29);
}

function drawAtlasCat(ctx: CanvasRenderingContext2D, player: PlayerSnapshot, time: number, own: boolean): void {
  const { x, y, activity, direction, appearance } = player;
  if (activity === 'toilet' && catSquat.complete && catSquat.naturalWidth > 0) {
    drawSquattingCat(ctx, player, own);
    return;
  }
  const moving = activity === 'walk';
  const column = moving ? Math.floor(time / 145) % 4 : activity === 'sleep' ? 0 : activity === 'play' ? 1 + Math.floor(time / 420) % 2 : Math.floor(time / 700) % 2;
  const row = activity === 'sleep' || activity === 'play'
    ? 5
    : direction === 'right'
      ? 1
      : direction === 'up'
        ? 2
        : direction === 'left'
          ? 3
          : moving
            ? 0
            : 4;
  const sourceColumn = atlasColumns[column]!;
  const sourceRow = atlasRows[row]!;
  const proportions = breedProportions(appearance.breed);
  const width = 67 * proportions.width;
  const height = 76 * proportions.height;
  const anchor = activity === 'sleep' || activity === 'play' ? .55 : .68;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.filter = coatFilter(appearance.coat);
  ctx.drawImage(
    catAtlas,
    sourceColumn.x,
    sourceRow.y,
    sourceColumn.width,
    sourceRow.height,
    Math.round(x - width / 2),
    Math.round(y - height * anchor),
    width,
    height,
  );
  ctx.restore();

  if (activity === 'play') {
    const ballX = Math.round(x + Math.sin(time / 190) * 29);
    ctx.fillStyle = '#7a3158'; ctx.fillRect(ballX - 6, Math.round(y) + 13, 12, 12);
    ctx.fillStyle = '#e792a7'; ctx.fillRect(ballX - 2, Math.round(y) + 15, 4, 4);
  }
  if (activity === 'study') {
    const pageY = Math.round(y) + 7;
    ctx.fillStyle = '#6d432b'; ctx.fillRect(Math.round(x) + 9, pageY - 2, 34, 23);
    ctx.fillStyle = '#f0deb0'; ctx.fillRect(Math.round(x) + 12, pageY, 14, 18); ctx.fillRect(Math.round(x) + 27, pageY, 13, 18);
    ctx.fillStyle = '#a96b58'; ctx.fillRect(Math.round(x) + 26, pageY + 1, 2, 17);
    ctx.fillStyle = '#826b55'; ctx.fillRect(Math.round(x) + 15, pageY + 5, 8, 2); ctx.fillRect(Math.round(x) + 30, pageY + 5, 7, 2);
  }
  drawLabel(ctx, player, own, Math.round(y - height * anchor - 9));
}

function drawSquattingCat(ctx: CanvasRenderingContext2D, player: PlayerSnapshot, own: boolean): void {
  const proportions = breedProportions(player.appearance.breed);
  const width = 72 * proportions.width;
  const height = 64 * proportions.height;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.filter = coatFilter(player.appearance.coat);
  ctx.drawImage(
    catSquat,
    280,
    395,
    710,
    610,
    Math.round(player.x - width / 2),
    Math.round(player.y - height),
    width,
    height,
  );
  ctx.restore();

  // Repaint the litter-box front rim over the paws to place the cat inside the tray.
  ctx.fillStyle = '#94613b'; ctx.fillRect(765, 463, 83, 7);
  ctx.fillStyle = '#c7884e'; ctx.fillRect(769, 463, 75, 3);
  drawLabel(ctx, player, own, Math.round(player.y - height - 8));
}

function coatFilter(coat: Appearance['coat']): string {
  switch (coat) {
    case '橘白': return 'sepia(.85) saturate(2.2) hue-rotate(335deg) brightness(1.08)';
    case '奶牛': return 'grayscale(.9) contrast(1.35) brightness(.96)';
    case '狸花': return 'sepia(.48) saturate(1.25) brightness(.86)';
    case '三花': return 'sepia(.6) saturate(1.65) hue-rotate(345deg) contrast(1.08)';
    case '银灰': return 'grayscale(.72) saturate(.5) brightness(1.04)';
    case '奶油': return 'sepia(.65) saturate(1.1) brightness(1.2)';
    case '玳瑁': return 'sepia(.82) saturate(2.25) hue-rotate(338deg) brightness(.68) contrast(1.25)';
    case '重点色': return 'sepia(.38) saturate(.7) contrast(1.22) brightness(.96)';
    case '金渐层': return 'sepia(.92) saturate(1.75) hue-rotate(348deg) brightness(1.08)';
    case '纯黑': return 'grayscale(1) brightness(.38) contrast(1.35)';
    case '蓝白': return 'grayscale(.55) sepia(.18) hue-rotate(155deg) saturate(.72) brightness(.92)';
    case '阿比西尼亚': return 'sepia(.78) saturate(1.8) hue-rotate(334deg) brightness(.86)';
  }
}

function breedProportions(breed: Appearance['breed']): { width: number; height: number } {
  switch (breed) {
    case '英短': return { width: 1.12, height: .96 };
    case '暹罗': return { width: .93, height: 1.07 };
    case '长毛猫': return { width: 1.12, height: 1.1 };
    case '缅因猫': return { width: 1.2, height: 1.13 };
    case '布偶猫': return { width: 1.15, height: 1.08 };
    case '孟加拉豹猫': return { width: 1.12, height: .98 };
    case '德文卷毛猫': return { width: .91, height: 1.06 };
    case '挪威森林猫': return { width: 1.17, height: 1.12 };
    default: return { width: 1, height: 1 };
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, player: PlayerSnapshot, own: boolean, y: number): void {
  ctx.font = '12px monospace'; ctx.textAlign = 'center';
  const label = own ? '你' : '喵喵';
  const width = ctx.measureText(label).width + 14;
  ctx.fillStyle = own ? '#614531' : 'rgba(48, 43, 37, .8)'; ctx.fillRect(player.x - width / 2, y - 11, width, 16);
  ctx.fillStyle = own ? '#ffe6a3' : '#f5e9ce'; ctx.fillText(label, player.x, y + 1);
}

function randomAppearance(previous?: Appearance): Appearance {
  let breed = pick(breeds); let coat = pick(coats);
  if (previous && breed === previous.breed && coat === previous.coat) coat = coats[(coats.indexOf(coat) + 1) % coats.length]!;
  return { breed, coat, colors: [...coatPalettes[coat]] };
}

function validSnapshot(value: PlayerSnapshot): boolean {
  return Boolean(value && typeof value.id === 'string' && typeof value.name === 'string' && Number.isFinite(value.x) && Number.isFinite(value.y));
}

function directionFromVector(x: number, y: number): Direction {
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

function pick<T>(values: readonly T[]): T { return values[Math.floor(Math.random() * values.length)]!; }
function randomInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function hash(x: number, y: number): number { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); }
function hashString(value: string): number {
  let result = 0;
  for (const character of value) result = ((result << 5) - result + character.charCodeAt(0)) | 0;
  return Math.abs(result);
}

function loadImage(source: string): HTMLImageElement {
  const image = new Image();
  image.src = source;
  return image;
}
