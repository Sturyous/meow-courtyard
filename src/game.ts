import { randomAppearance } from './cats';
import { dayPhase } from './daynight';
import { drawCatSprite } from './cat-sprites';
import { drawDecorFlower, drawFlowerHead, drawGardenFallback, drawHeadFlower, drawPlot, emptyPlot, PLOT_SPOTS, WATER_COLORS } from './garden';
import type { Activity, Appearance, DecorItem, Direction, DuetKind, Emote, FlowerId, GardenPlot, Identity, NoteData, PlayerSnapshot, PublicActivity, SceneId } from './types';

const WORLD = { width: 960, height: 640 };
const YARD = { left: 46, top: 72, right: 914, bottom: 592 };
const CABIN = { left: 88, top: 178, right: 872, bottom: 600 };
const GARDEN = { left: 60, top: 92, right: 900, bottom: 566 };
const CAT_RADIUS = 15;
const SPEED = 112;
const RENDER_DELAY = 120;
const BUFFER_LIMIT = 12;
const BUBBLE_LIFE = 4200;
const EMOTE_LIFE = 2600;
const HEART_LIFE = 950;

const courtyardImage = loadImage('/assets/courtyard-bg.png');
const cabinImage = loadImage('/assets/cabin-clean.png');
const gardenImage = loadImage('/assets/garden-bg.png');
const beds = [
  { x: 143, y: 148, color: '#d98273' },
  { x: 231, y: 148, color: '#7ca6a1' },
  { x: 143, y: 225, color: '#b08dbe' },
  { x: 231, y: 225, color: '#d1a95f' },
];

const targets: Record<Exclude<PublicActivity, 'play' | 'sleep'>, { x: number; y: number }> = {
  study: { x: 746, y: 195 },
  eat: { x: 115, y: 438 },
  toilet: { x: 806, y: 432 },
};

// 小屋内活动点：扶手椅读书位 / 壁炉前的双人软垫
const cabinTargets = {
  study: { x: 210, y: 400 },
  cushion: { x: 745, y: 470 },
};

// 庭院灯光位（对齐 courtyard-bg.png 中的灯笼与书桌台灯）
const YARD_LIGHTS = [
  { x: 416, y: 55, radius: 70 },
  { x: 544, y: 55, radius: 70 },
  { x: 96, y: 384, radius: 80 },
  { x: 868, y: 338, radius: 80 },
  { x: 805, y: 94, radius: 58 },
];

// 小屋壁炉火光与窗景玻璃区（对齐 cabin-bg.png）
const FIRE_GLOW = { x: 258, y: 233, radius: 130 };
const WINDOW_GLASS = { x: 427, y: 84, width: 115, height: 74 };

// 花园夜里的萤火虫光点
const GARDEN_LIGHTS = [
  { x: 130, y: 200, radius: 60 },
  { x: 830, y: 420, radius: 60 },
  { x: 620, y: 540, radius: 55 },
];

type ParticleKind = 'heart' | 'zzz' | 'crumb' | 'sand' | 'drop';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  at: number;
}

interface GameCallbacks {
  onMovement: (snapshot: PlayerSnapshot) => void;
  onActivity: (snapshot: PlayerSnapshot) => void;
  onAppearance: (snapshot: PlayerSnapshot) => void;
  onRemoteMenu: (playerId: string, clientX: number, clientY: number) => void;
  onSelfMenu: (clientX: number, clientY: number) => void;
  onGhostMenu: (playerId: string, clientX: number, clientY: number) => void;
  onNoteOpen: (note: NoteData) => void;
  onSceneChange: (scene: SceneId) => void;
  onPlotMenu: (plot: GardenPlot, clientX: number, clientY: number) => void;
  onDecorMenu: (decor: DecorItem, clientX: number, clientY: number) => void;
}

interface PositionSample {
  x: number;
  y: number;
  at: number;
}

interface RemotePlayer {
  id: string;
  name: string;
  appearance: Appearance;
  activity: Activity;
  direction: Direction;
  cosleepWith: string | null;
  nuzzleWith: string | null;
  headFlower: FlowerId | null;
  scene: SceneId;
  buffer: PositionSample[];
  lastSequence: number;
  lastAppliedAt: number;
  x: number;
  y: number;
}

interface GhostCat {
  id: string;
  name: string;
  x: number;
  y: number;
  activity: Activity;
  direction: Direction;
  appearance: Appearance;
  headFlower: FlowerId | null;
  scene: SceneId;
  pokeUntil: number;
}

interface DuetState {
  kind: DuetKind;
  partnerId: string;
  phase: 'approach' | 'play';
  until: number;
}

interface OverheadEntity {
  id: string;
  x: number;
  y: number;
}

export class CourtyardGame {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pressed = new Set<string>();
  private readonly remotes = new Map<string, RemotePlayer>();
  private readonly ghosts = new Map<string, GhostCat>();
  private readonly groundNotes = new Map<string, NoteData>();
  private readonly bubbles = new Map<string, { text: string; at: number }[]>();
  private readonly emoteFx = new Map<string, { emote: Emote; at: number }>();
  private readonly particles: Particle[] = [];
  private readonly ambientAt = new Map<string, number>();
  private readonly bedAssignments = new Map<string, number>();
  private readonly callbacks: GameCallbacks;
  private local: PlayerSnapshot;
  private scene: SceneId = 'yard';
  private lastFrame = performance.now();
  private lastNetworkMove = 0;
  private lastMoving = false;
  private autoTarget: { x: number; y: number } | null = null;
  private pendingActivity: PublicActivity | null = null;
  private pendingCosleepId: string | null = null;
  private duet: DuetState | null = null;
  private lastHeartAt = 0;
  private notePlacement: ((x: number, y: number) => void) | null = null;
  private readonly plots = new Map<number, GardenPlot>();
  private readonly decorItems = new Map<string, DecorItem>();
  private pendingArrival: (() => void) | null = null;
  private frame = 0;
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement, identity: Identity, callbacks: GameCallbacks) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 Canvas 2D');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.callbacks = callbacks;
    this.local = {
      id: identity.id,
      name: identity.name,
      x: 480 + randomInt(-55, 55),
      y: 350 + randomInt(-30, 30),
      direction: 'down',
      activity: 'idle',
      appearance: identity.appearance,
      cosleepWith: null,
      headFlower: null,
      scene: 'yard',
      updatedAt: Date.now(),
    };
    this.bindInput();
    requestAnimationFrame(this.loop);
  }

  getSnapshot(): PlayerSnapshot {
    return structuredClone({ ...this.local, updatedAt: Date.now() });
  }

  restoreHeadFlower(flower: FlowerId | null): void {
    this.local.headFlower = flower;
  }

  canInteract(id: string): boolean {
    return this.remotes.get(id)?.scene === this.scene;
  }

  duetAnchor(point: { x: number; y: number } = this.local): { x: number; y: number } {
    const x = clamp(point.x, 110, 850), y = clamp(point.y, 280, 510);
    const onFurniture = this.scene === 'yard'
      ? (x < 300 && y < 285) || (x > 660 && y < 285) || (x < 245 && y > 385) || (x > 700 && y > 345)
      : this.scene === 'cabin'
        ? x < 360 || x > 630
        : PLOT_SPOTS.some(spot => Math.abs(x - spot.x) < 80 && Math.abs(y - spot.y) < 60);
    return onFurniture ? { x: 480, y: this.scene === 'cabin' ? 400 : this.scene === 'garden' ? 280 : 350 } : { x, y };
  }

  addOrUpdateRemote(snapshot: PlayerSnapshot, sequence = 0): void {
    if (snapshot.id === this.local.id || !validSnapshot(snapshot)) return;
    this.ghosts.delete(snapshot.id);
    const now = performance.now();
    const scene: SceneId = snapshot.scene ?? 'yard';
    const existing = this.remotes.get(snapshot.id);
    if (existing) {
      // 同一只猫多台设备同时在线时，各设备的序列号各自计数会互相挡住，
      // 用快照自带的 updatedAt（发送端时钟）做"最新者胜"仲裁
      const staleBySequence = sequence > 0 && sequence <= existing.lastSequence;
      const staleByClock = snapshot.updatedAt < existing.lastAppliedAt;
      if (staleByClock || (staleBySequence && snapshot.updatedAt === existing.lastAppliedAt)) return;
      if (existing.scene !== scene) { existing.buffer.length = 0; existing.x = snapshot.x; existing.y = snapshot.y; }
      existing.buffer.push({ x: snapshot.x, y: snapshot.y, at: now });
      if (existing.buffer.length > BUFFER_LIMIT) existing.buffer.shift();
      existing.name = snapshot.name;
      existing.activity = snapshot.activity;
      existing.direction = snapshot.direction;
      existing.appearance = snapshot.appearance;
      existing.cosleepWith = snapshot.cosleepWith ?? null;
      existing.nuzzleWith = snapshot.nuzzleWith ?? null;
      existing.headFlower = snapshot.headFlower ?? null;
      existing.scene = scene;
      existing.lastSequence = Math.max(existing.lastSequence, sequence);
      existing.lastAppliedAt = Math.max(existing.lastAppliedAt, snapshot.updatedAt);
      return;
    }
    this.remotes.set(snapshot.id, {
      id: snapshot.id,
      name: snapshot.name,
      appearance: snapshot.appearance,
      activity: snapshot.activity,
      direction: snapshot.direction,
      cosleepWith: snapshot.cosleepWith ?? null,
      nuzzleWith: snapshot.nuzzleWith ?? null,
      headFlower: snapshot.headFlower ?? null,
      scene,
      buffer: [{ x: snapshot.x, y: snapshot.y, at: now }],
      lastSequence: sequence,
      lastAppliedAt: snapshot.updatedAt,
      x: snapshot.x,
      y: snapshot.y,
    });
  }

  getRemoteActivity(id: string): Activity | null {
    return this.remotes.get(id)?.activity ?? null;
  }

  pokeGhost(id: string): void {
    const ghost = this.ghosts.get(id);
    if (ghost) ghost.pokeUntil = performance.now() + 1600;
  }

  // 送走旧设备残留的猫：从场上移除影子（登记行的删除由调用方负责）
  forgetGhost(id: string): void {
    this.ghosts.delete(id);
  }

  removeRemote(id: string): void {
    const remote = this.remotes.get(id);
    this.remotes.delete(id);
    if (this.duet?.partnerId === id || this.pendingCosleepId === id) this.endDuet();
    if (this.local.cosleepWith === id) { this.local.cosleepWith = null; this.callbacks.onActivity(this.getSnapshot()); }
    if (remote) {
      this.ghosts.set(id, {
        id,
        name: remote.name,
        x: remote.x,
        y: remote.y,
        activity: remote.activity === 'walk' ? 'idle' : remote.activity,
        direction: remote.direction,
        appearance: remote.appearance,
        headFlower: remote.headFlower,
        scene: remote.scene,
        pokeUntil: 0,
      });
    }
  }

  retainRemotes(ids: Set<string>): void {
    for (const id of [...this.remotes.keys()]) {
      if (!ids.has(id)) this.removeRemote(id);
    }
  }

  assignBeds(order: string[]): void {
    // ponytail: four yard beds / two facility seats; add facilities before bigger rooms.
    this.bedAssignments.clear();
    order.forEach((id, index) => this.bedAssignments.set(id, index % beds.length));
  }

  setGhosts(list: { id: string; name: string; snapshot: PlayerSnapshot }[]): void {
    for (const ghost of list) {
      if (ghost.id === this.local.id || this.remotes.has(ghost.id)) continue;
      const snapshot = ghost.snapshot;
      this.ghosts.set(ghost.id, {
        id: ghost.id,
        name: ghost.name,
        x: snapshot.x,
        y: snapshot.y,
        activity: snapshot.activity === 'walk' ? 'idle' : snapshot.activity,
        direction: snapshot.direction,
        appearance: snapshot.appearance,
        headFlower: snapshot.headFlower ?? null,
        scene: snapshot.scene ?? 'yard',
        pokeUntil: 0,
      });
    }
  }

  setNotes(list: NoteData[]): void {
    this.groundNotes.clear();
    for (const note of list) this.groundNotes.set(note.id, note);
  }

  addNote(note: NoteData): void {
    this.groundNotes.set(note.id, note);
  }

  removeNote(noteId: string): void {
    this.groundNotes.delete(noteId);
  }

  // ---- 小花园 ----
  setGarden(list: GardenPlot[]): void {
    this.plots.clear();
    for (const plot of list) this.plots.set(plot.plot, plot);
  }

  updatePlot(plot: GardenPlot): void {
    this.plots.set(plot.plot, plot);
  }

  getPlot(index: number): GardenPlot {
    return this.plots.get(index) ?? emptyPlot(index);
  }

  setDecor(list: DecorItem[]): void {
    this.decorItems.clear();
    for (const item of list) this.decorItems.set(item.id, item);
  }

  addDecorItem(item: DecorItem): void {
    this.decorItems.set(item.id, item);
  }

  removeDecorItem(id: string): void {
    this.decorItems.delete(id);
  }

  // 别/取头上的花：写入快照并广播（影子猫与远端经快照自然带出）
  setHeadFlower(flower: FlowerId | null): void {
    this.local.headFlower = flower;
    this.local.updatedAt = Date.now();
    this.callbacks.onActivity(this.getSnapshot());
  }

  getHeadFlower(): FlowerId | null {
    return this.local.headFlower ?? null;
  }

  // 走到某点后执行动作（浇水/收获前的就位）
  approachAnd(x: number, y: number, fn: () => void): void {
    this.endDuet();
    this.pendingActivity = null;
    this.pendingCosleepId = null;
    this.pendingArrival = fn;
    this.local.activity = 'walk';
    this.autoTarget = { x, y };
    this.local.updatedAt = Date.now();
    this.callbacks.onActivity(this.getSnapshot());
  }

  // 浇水动效：一蓬水珠洒向花位
  splashWater(x: number, y: number): void {
    const now = this.frame;
    for (let i = 0; i < 12; i++) {
      this.particles.push({ kind: 'drop', x: x + randomInt(-16, 16), y: y - 26 + randomInt(-8, 4), at: now + randomInt(0, 160) });
    }
  }

  addBubble(playerId: string, text: string): void {
    const list = this.bubbles.get(playerId) ?? [];
    list.push({ text: text.slice(0, 24), at: performance.now() });
    while (list.length > 2) list.shift();
    this.bubbles.set(playerId, list);
  }

  showEmote(playerId: string, emote: Emote): void {
    this.emoteFx.set(playerId, { emote, at: performance.now() });
  }

  setNotePlacement(handler: ((x: number, y: number) => void) | null): void {
    this.notePlacement = handler;
  }

  startNuzzle(partnerId: string, anchor?: { x: number; y: number }): void {
    const partner = this.remotes.get(partnerId);
    if (!partner || partner.scene !== this.scene) return;
    this.endDuet();
    this.local.cosleepWith = null;
    this.pendingCosleepId = null;
    const mx = anchor?.x ?? (this.local.x + partner.x) / 2;
    const my = anchor?.y ?? (this.local.y + partner.y) / 2;
    const target = this.duetAnchor({ x: mx, y: my });
    this.autoTarget = { x: target.x + (this.local.id < partnerId ? -24 : 24), y: target.y };
    this.pendingActivity = null;
    this.local.activity = 'walk';
    this.duet = { kind: 'nuzzle', partnerId, phase: 'approach', until: performance.now() + 9000 };
    this.callbacks.onActivity(this.getSnapshot());
  }

  startCosleep(partnerId: string): void {
    const partner = this.remotes.get(partnerId);
    if (!partner) return;
    this.endDuet();
    this.switchScene('cabin');
    this.pendingCosleepId = partnerId;
    this.pendingActivity = 'sleep';
    this.autoTarget = { x: cabinTargets.cushion.x + (this.local.id < partnerId ? -28 : 28), y: cabinTargets.cushion.y };
    this.local.activity = 'walk';
    this.callbacks.onActivity(this.getSnapshot());
  }

  acceptCosleep(inviterId: string): void {
    this.startCosleep(inviterId);
  }

  setActivity(activity: PublicActivity): void {
    this.endDuet();
    this.local.cosleepWith = null;
    this.pendingCosleepId = null;
    if (activity === 'sleep') {
      // 猫困了就地蜷下：原地睡，不强制回窝
      this.autoTarget = null;
      this.pendingActivity = null;
      this.local.activity = 'sleep';
      this.local.updatedAt = Date.now();
      this.callbacks.onActivity(this.getSnapshot());
      return;
    }
    // 食盆和猫砂盆都在院子里：在小屋点吃饭/上厕所会先走回院子
    if ((this.scene !== 'yard' && (activity === 'eat' || activity === 'toilet')) || (this.scene === 'garden' && activity === 'study')) {
      this.switchScene('yard');
    }
    this.pendingActivity = activity === 'play' ? null : activity;
    this.local.activity = activity === 'play' ? 'play' : 'walk';
    this.autoTarget = activity === 'play'
      ? null
      : this.scene === 'cabin'
        ? { ...cabinTargets.study }
        : { ...targets[activity] };
    const seat = (this.bedAssignments.get(this.local.id) ?? 0) % 2;
    if (this.autoTarget && activity === 'study') this.autoTarget.x += seat * (this.scene === 'cabin' ? 76 : 60);
    if (this.autoTarget && activity === 'eat') this.autoTarget.x += seat * 40;
    this.local.updatedAt = Date.now();
    this.callbacks.onActivity(this.getSnapshot());
  }

  getScene(): SceneId {
    return this.scene;
  }

  // 场景切换：庭院顶门 → 小屋，庭院下门 → 花园；花园顶路 / 小屋地垫 → 回院子；也可由 dock 按钮直接调用
  switchScene(next?: SceneId): void {
    const target = next ?? (this.scene === 'yard' ? 'cabin' : 'yard');
    if (target === this.scene) return;
    const from = this.scene;
    this.scene = target;
    this.endDuet();
    this.local.cosleepWith = null;
    this.pendingCosleepId = null;
    this.pendingActivity = null;
    this.autoTarget = null;
    this.pendingArrival = null;
    this.notePlacement = null;
    if (target === 'cabin') {
      this.local.x = 480;
      this.local.y = 536;
    } else if (target === 'garden') {
      // 从庭院下门进来：落在花园顶部石板路口
      this.local.x = 480;
      this.local.y = 150;
    } else if (from === 'garden') {
      // 从花园顶路回院子：落在庭院下门口
      this.local.x = 480;
      this.local.y = 520;
    } else {
      this.local.x = 480;
      this.local.y = 132;
    }
    this.local.scene = target;
    this.local.activity = 'idle';
    this.local.direction = target === 'cabin' || from === 'garden' ? 'up' : 'down';
    this.local.updatedAt = Date.now();
    this.callbacks.onSceneChange(target);
    this.callbacks.onActivity(this.getSnapshot());
  }

  // 回自己的窝睡：院子里是猫窝，小屋里是壁炉前的双人软垫（右键自己 → 去窝里睡）
  sleepInBed(): void {
    this.endDuet();
    if (this.scene === 'garden') this.switchScene('yard');
    this.local.cosleepWith = null;
    this.pendingCosleepId = null;
    this.pendingActivity = 'sleep';
    this.local.activity = 'walk';
    this.autoTarget = this.scene === 'cabin'
      ? { x: cabinTargets.cushion.x + ((this.bedAssignments.get(this.local.id) ?? 0) % 2 ? 28 : -28), y: cabinTargets.cushion.y }
      : { ...beds[this.bedAssignments.get(this.local.id) ?? 0]! };
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

  private endDuet(): void {
    this.duet = null;
    this.local.nuzzleWith = null;
    this.pendingArrival = null;
    this.autoTarget = null;
    this.pendingActivity = null;
    this.pendingCosleepId = null;
  }

  private bindInput(): void {
    const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D']);
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (movementKeys.has(event.key)) {
        event.preventDefault();
        this.pressed.add(event.key.toLowerCase());
      }
    });
    window.addEventListener('keyup', (event) => this.pressed.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.pressed.clear());

    this.canvas.addEventListener('click', (event) => {
      if (!this.notePlacement) return;
      const point = this.canvasPoint(event.clientX, event.clientY);
      const handler = this.notePlacement;
      this.notePlacement = null;
      const bounds = this.scene === 'yard' ? YARD : this.scene === 'cabin' ? CABIN : GARDEN;
      handler(clamp(point.x, bounds.left + 10, bounds.right - 10), clamp(point.y, bounds.top + 10, bounds.bottom - 10));
    });

    this.canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (this.notePlacement) {
        this.notePlacement = null;
        return;
      }
      const point = this.canvasPoint(event.clientX, event.clientY);

      // 花园里的土坑：右键开花圃面板
      if (this.scene === 'garden') {
        for (let index = 0; index < PLOT_SPOTS.length; index++) {
          const spot = PLOT_SPOTS[index]!;
          if (Math.abs(point.x - spot.x) < 30 && Math.abs(point.y - spot.y) < 22) {
            this.callbacks.onPlotMenu(this.getPlot(index), event.clientX, event.clientY);
            return;
          }
        }
      }
      // 装饰花：右键可收回
      for (const item of this.decorItems.values()) {
        if (item.scene !== this.scene) continue;
        if (Math.hypot(point.x - item.x, point.y - item.y) < 20) {
          this.callbacks.onDecorMenu(item, event.clientX, event.clientY);
          return;
        }
      }

      for (const note of this.groundNotes.values()) {
        if (note.scene !== this.scene) continue;
        if (Math.hypot(point.x - note.x, point.y - note.y) < 20) {
          this.callbacks.onNoteOpen(note);
          return;
        }
      }
      for (const remote of this.remotes.values()) {
        if (remote.scene !== this.scene) continue;
        if (Math.hypot(point.x - remote.x, point.y - remote.y) < 42) {
          this.callbacks.onRemoteMenu(remote.id, event.clientX, event.clientY);
          return;
        }
      }
      for (const ghost of this.ghosts.values()) {
        if (ghost.scene !== this.scene) continue;
        if (Math.hypot(point.x - ghost.x, point.y - ghost.y) < 34) {
          this.callbacks.onGhostMenu(ghost.id, event.clientX, event.clientY);
          return;
        }
      }
      if (Math.hypot(point.x - this.local.x, point.y - this.local.y) < 38) {
        this.callbacks.onSelfMenu(event.clientX, event.clientY);
      }
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
    const elapsed = Math.max(0, (now - this.lastFrame) / 1000);
    const dt = Math.min(elapsed, 0.05);
    this.lastFrame = now;
    this.frame = now;
    this.update(dt, now, elapsed);
    this.draw();
    requestAnimationFrame(this.loop);
  };

  private update(dt: number, now: number, elapsed = dt): void {
    let dx = 0;
    let dy = 0;
    if (this.pressed.has('arrowleft') || this.pressed.has('a')) dx -= 1;
    if (this.pressed.has('arrowright') || this.pressed.has('d')) dx += 1;
    if (this.pressed.has('arrowup') || this.pressed.has('w')) dy -= 1;
    if (this.pressed.has('arrowdown') || this.pressed.has('s')) dy += 1;

    if (dx || dy) {
      this.autoTarget = null;
      this.pendingActivity = null;
      this.pendingCosleepId = null;
      this.pendingArrival = null;
      this.endDuet();
      if (this.local.cosleepWith) this.local.cosleepWith = null;
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
        const arrival = this.pendingArrival;
        this.pendingArrival = null;
        if (this.pendingCosleepId) {
          this.local.cosleepWith = this.pendingCosleepId;
          this.pendingCosleepId = null;
          this.local.activity = 'sleep';
        } else {
          this.local.activity = this.pendingActivity ?? 'idle';
        }
        this.pendingActivity = null;
        if (this.local.activity === 'eat' || this.local.activity === 'toilet') this.local.direction = 'right';
        this.callbacks.onActivity(this.getSnapshot());
        if (arrival) arrival();
      } else {
        // Auto walking follows elapsed time when a background tab throttles frames.
        // Clamp to the remaining distance; manual movement still uses the small dt.
        const step = Math.min(SPEED * 0.82 * elapsed, distance);
        this.moveLocal(tx / distance * step, ty / distance * step);
        this.local.direction = directionFromVector(tx, ty);
      }
    } else if (this.local.activity === 'walk') {
      this.local.activity = 'idle';
    }

    // 庭院顶门 → 小屋；庭院下门 → 花园；小屋地垫 / 花园顶路 → 回院子
    if (this.scene === 'yard' && this.local.y <= YARD.top + CAT_RADIUS + 6 && Math.abs(this.local.x - 480) < 62) {
      this.switchScene('cabin');
    } else if (this.scene === 'yard' && this.local.y >= YARD.bottom - CAT_RADIUS - 4 && Math.abs(this.local.x - 480) < 62) {
      this.switchScene('garden');
    } else if (this.scene === 'cabin' && this.local.y >= CABIN.bottom - CAT_RADIUS - 4 && Math.abs(this.local.x - 480) < 50) {
      this.switchScene('yard');
    } else if (this.scene === 'garden' && this.local.y <= GARDEN.top + CAT_RADIUS + 6 && Math.abs(this.local.x - 480) < 60) {
      this.switchScene('yard');
    }

    this.updateDuet(now);

    const moving = dx !== 0 || dy !== 0 || this.autoTarget !== null;
    if (moving && now - this.lastNetworkMove >= 170) {
      this.lastNetworkMove = now;
      this.callbacks.onMovement(this.getSnapshot());
    }
    if (!moving && this.lastMoving) this.callbacks.onMovement(this.getSnapshot());
    this.lastMoving = moving;

    for (const remote of this.remotes.values()) this.sampleRemote(remote, now);
    this.spawnAmbient(now);
    this.pruneFx(now);
  }

  private updateDuet(now: number): void {
    if (!this.duet) return;
    const partner = this.remotes.get(this.duet.partnerId);
    if (!partner || partner.scene !== this.scene || now > this.duet.until) {
      this.endDuet();
      this.local.activity = 'idle'; this.callbacks.onActivity(this.getSnapshot());
      return;
    }
    if (this.duet.kind === 'nuzzle') {
      const distance = Math.hypot(partner.x - this.local.x, partner.y - this.local.y);
      if (this.duet.phase === 'approach' && distance < 55 && !this.autoTarget && partner.activity !== 'walk') {
        this.duet.phase = 'play';
        this.duet.until = now + 2400;
        this.autoTarget = null;
        this.local.activity = 'play';
        this.local.nuzzleWith = partner.id;
        this.local.direction = partner.x < this.local.x ? 'left' : 'right';
        this.callbacks.onActivity(this.getSnapshot());
      } else if (this.duet.phase === 'play') {
        if (partner.activity !== 'idle' && partner.activity !== 'play') { this.endDuet(); this.local.activity = 'idle'; this.callbacks.onActivity(this.getSnapshot()); return; }
        this.local.direction = partner.x < this.local.x ? 'left' : 'right';
        if (now - this.lastHeartAt > 150) {
          this.lastHeartAt = now;
          this.particles.push({
            kind: 'heart',
            x: (this.local.x + partner.x) / 2 + randomInt(-8, 8),
            y: Math.min(this.local.y, partner.y) - 46,
            at: now,
          });
        }
      }
    }
  }

  private sampleRemote(remote: RemotePlayer, now: number): void {
    const buffer = remote.buffer;
    if (buffer.length === 0) return;
    const t = now - RENDER_DELAY;
    const newest = buffer[buffer.length - 1]!;
    if (t >= newest.at) {
      remote.x = newest.x;
      remote.y = newest.y;
      return;
    }
    const oldest = buffer[0]!;
    if (t <= oldest.at) {
      remote.x = oldest.x;
      remote.y = oldest.y;
      return;
    }
    for (let i = buffer.length - 1; i > 0; i--) {
      const after = buffer[i]!;
      const before = buffer[i - 1]!;
      if (before.at <= t && t < after.at) {
        const span = after.at - before.at;
        const alpha = span > 0 ? (t - before.at) / span : 1;
        const nx = before.x + (after.x - before.x) * alpha;
        const ny = before.y + (after.y - before.y) * alpha;
        if (Math.hypot(after.x - before.x, after.y - before.y) > 4) {
          remote.direction = directionFromVector(after.x - before.x, after.y - before.y);
        }
        remote.x = nx;
        remote.y = ny;
        return;
      }
    }
  }

  private pruneFx(now: number): void {
    for (const [id, list] of this.bubbles) {
      const alive = list.filter((bubble) => now - bubble.at < BUBBLE_LIFE);
      if (alive.length === 0) this.bubbles.delete(id);
      else this.bubbles.set(id, alive);
    }
    for (const [id, fx] of this.emoteFx) {
      if (now - fx.at > EMOTE_LIFE) this.emoteFx.delete(id);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (now - this.particles[i]!.at > particleLife(this.particles[i]!.kind)) this.particles.splice(i, 1);
    }
  }

  // 环境小动作：当前场景里的猫（含远端与影子）按活动自发冒粒子，不走网络，各端本地生成。
  private spawnAmbient(now: number): void {
    const cats: { id: string; x: number; y: number; activity: Activity }[] = [
      this.local,
      ...[...this.remotes.values()].filter((cat) => cat.scene === this.scene),
      ...[...this.ghosts.values()].filter((cat) => cat.scene === this.scene),
    ];
    for (const cat of cats) {
      const interval = cat.activity === 'sleep' ? 1500 : cat.activity === 'eat' ? 480 : cat.activity === 'toilet' ? 560 : 0;
      if (!interval) continue;
      if (now - (this.ambientAt.get(cat.id) ?? 0) < interval) continue;
      this.ambientAt.set(cat.id, now);
      if (cat.activity === 'sleep') {
        this.particles.push({ kind: 'zzz', x: cat.x + 16, y: cat.y - 38, at: now });
      } else if (cat.activity === 'eat') {
        // 吃饭时一次掉一小撮饭粒，2px 的单粒在画面上根本看不见
        for (let i = 0; i < 3; i++) {
          this.particles.push({ kind: 'crumb', x: cat.x + randomInt(-9, 9), y: cat.y + randomInt(0, 6), at: now });
        }
      } else {
        // 刨猫砂：向后上方踢起一蓬沙子
        for (let i = 0; i < 4; i++) {
          this.particles.push({ kind: 'sand', x: cat.x + randomInt(-24, -8), y: cat.y + randomInt(4, 12), at: now });
        }
      }
    }
  }

  private moveLocal(dx: number, dy: number): void {
    const bounds = this.scene === 'yard' ? YARD : this.scene === 'cabin' ? CABIN : GARDEN;
    this.local.x = clamp(this.local.x + dx, bounds.left + CAT_RADIUS, bounds.right - CAT_RADIUS);
    this.local.y = clamp(this.local.y + dy, bounds.top + CAT_RADIUS, bounds.bottom - CAT_RADIUS);
    this.local.updatedAt = Date.now();
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    if (this.scene === 'yard') {
      drawCourtyard(ctx, this.frame);
    } else if (this.scene === 'cabin') {
      drawCabin(ctx, this.frame);
    } else {
      this.drawGardenScene(ctx);
    }
    this.drawNotes(ctx);
    this.drawDecor(ctx);

    const cast: { entity: OverheadEntity & PlayerSnapshotLike; label: string; ghost: boolean; poke: boolean }[] = [];
    for (const remote of this.remotes.values()) {
      if (remote.scene !== this.scene) continue;
      cast.push({ entity: remote, label: remote.name, ghost: false, poke: false });
    }
    for (const ghost of this.ghosts.values()) {
      if (ghost.scene !== this.scene) continue;
      const poke = this.frame < ghost.pokeUntil;
      cast.push({ entity: ghost, label: `${ghost.name} · 不在`, ghost: true, poke });
    }
    cast.push({ entity: this.local, label: '你', ghost: false, poke: false });
    cast.sort((a, b) => a.entity.y - b.entity.y);

    for (const member of cast) {
      let entity = member.poke
        ? { ...member.entity, activity: 'idle' as Activity, direction: 'down' as Direction }
        : member.entity;
      // One accepted contact phase draws both poses, despite packet/render delay.
      if (this.duet?.phase === 'play' && (entity.id === this.local.id || entity.id === this.duet.partnerId)) {
        const otherId = entity.id === this.local.id ? this.duet.partnerId : this.local.id;
        entity = { ...entity, activity: 'play', nuzzleWith: otherId, direction: entity.id < otherId ? 'right' : 'left' };
      }
      drawCat(ctx, entity, this.frame, member.ghost);
    }

    // Foreground from the same background asset: actual tray lip, not a painted strip.
    if (this.scene === 'yard' && cast.some(({entity}) => entity.activity === 'toilet')) {
      ctx.drawImage(courtyardImage, 1195, 705, 179, 34, 747, 441, 112, 21);
    }
    this.drawBlankets(ctx);
    this.drawParticles(ctx);
    this.applyDayNight(ctx);
    this.drawSceneSign(ctx);
    ctx.font = '12px monospace';
    const labels: { left: number; right: number; y: number }[] = [];
    for (const member of cast) {
      const half = (ctx.measureText(member.label).width + 14) / 2;
      const left = member.entity.x - half, right = member.entity.x + half;
      let y = member.entity.y - 65;
      // ponytail: O(n²) label packing for a small room; index spatially if rooms grow.
      while (labels.some(label => left < label.right && right > label.left && Math.abs(y - label.y) < 18)) y -= 20;
      drawLabel(ctx, member.entity.x, y, member.label, !member.ghost && member.entity.id === this.local.id);
      labels.push({ left, right, y });
      this.drawOverhead(ctx, member.entity, member.label);
    }
  }

  // 花园场景：背景图 → 代码绘制的 6 个土坑（长在背景上、猫之下）
  private drawGardenScene(ctx: CanvasRenderingContext2D): void {
    if (gardenImage.complete && gardenImage.naturalWidth > 0) {
      ctx.save();
      ctx.filter = 'saturate(92%)';
      ctx.drawImage(gardenImage, 0, 0, WORLD.width, WORLD.height);
      ctx.restore();
    } else {
      drawGardenFallback(ctx, WORLD.width, WORLD.height, this.frame);
    }
    for (let index = 0; index < PLOT_SPOTS.length; index++) {
      drawPlot(ctx, this.getPlot(index), PLOT_SPOTS[index]!, this.frame);
    }
  }

  // 门口/场景里的装饰花（所有场景通用，种在地面）
  private drawDecor(ctx: CanvasRenderingContext2D): void {
    for (const item of this.decorItems.values()) {
      if (item.scene !== this.scene) continue;
      drawDecorFlower(ctx, item.flower, item.x, item.y, this.frame);
    }
  }

  // 昼夜叠色与灯光：multiply 压暗全场（含猫），再叠加光源光晕。
  // 两端各自按本地真实时间计算——时差让"我这儿天黑了你那儿还是下午"成为日常。
  private applyDayNight(ctx: CanvasRenderingContext2D): void {
    const phase = dayPhase();
    const [r, g, b] = phase.tint;
    if (r < 252 || g < 252 || b < 252) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.restore();
    }
    if (this.scene === 'yard') {
      if (phase.glow > 0.02) {
        for (const spot of YARD_LIGHTS) drawGlow(ctx, spot.x, spot.y, spot.radius, phase.glow, this.frame);
      }
    } else if (this.scene === 'garden') {
      // 夜里萤火虫点点
      if (phase.glow > 0.02) {
        for (const spot of GARDEN_LIGHTS) drawGlow(ctx, spot.x, spot.y, spot.radius, phase.glow * 0.8, this.frame);
      }
    } else {
      // 壁炉常燃，夜里光晕更暖更亮
      drawGlow(ctx, FIRE_GLOW.x, FIRE_GLOW.y, FIRE_GLOW.radius, 0.3 + phase.glow * 0.7, this.frame);
      // 窗景画在叠色层之上：屋里的窗永远看得见外面的天色
      drawWindowSky(ctx, phase.label, this.frame);
    }
  }

  // 同眠被窝：两只猫身上盖一床被子（1 张代码绘制的被子，覆盖任意花色组合），院子猫窝与小屋软垫通用
  private drawBlankets(ctx: CanvasRenderingContext2D): void {
    for (const remote of this.remotes.values()) {
      if (remote.scene !== this.scene) continue;
      const paired = this.local.cosleepWith === remote.id
        && remote.cosleepWith === this.local.id
        && this.local.activity === 'sleep'
        && remote.activity === 'sleep';
      if (paired && Math.hypot(this.local.x - remote.x, this.local.y - remote.y) < 70) drawBlanket(ctx, (this.local.x + remote.x) / 2, (this.local.y + remote.y) / 2);
    }
  }

  // 异场景指示牌：TA 在别的场景、或 TA 在别的场景留了东西时，在门口立小木牌
  private drawSceneSign(ctx: CanvasRenderingContext2D): void {
    const sceneName: Record<SceneId, string> = { yard: '院子里', cabin: '屋里', garden: '花园里' };
    const texts: string[] = [];
    for (const remote of this.remotes.values()) {
      if (remote.scene !== this.scene) texts.push(`${remote.name} 在${sceneName[remote.scene]}`);
    }
    const notesElsewhere = [...this.groundNotes.values()]
      .filter((note) => note.scene !== this.scene && note.authorId !== this.local.id).length;
    if (notesElsewhere > 0) texts.push(`别处有 ${notesElsewhere} 个 TA 留的东西`);

    texts.forEach((text, index) => {
      const x = this.scene === 'garden' ? 690 : 480;
      const baseY = this.scene === 'yard' ? 108 : this.scene === 'cabin' ? 520 : 240;
      const y = baseY + index * 30;
      const bob = Math.round(Math.sin(this.frame / 500) * 1.5);
      ctx.save();
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      const width = Math.round(ctx.measureText(text).width) + 20;
      ctx.fillStyle = '#4a3626';
      ctx.fillRect(x - 3, y + 8 + bob, 6, 16);
      ctx.fillStyle = '#8a6844';
      ctx.fillRect(x - width / 2 - 2, y - 12 + bob, width + 4, 22);
      ctx.fillStyle = '#e8d3a8';
      ctx.fillRect(x - width / 2, y - 10 + bob, width, 18);
      ctx.fillStyle = '#5a4632';
      ctx.fillText(text, x, y + 4 + bob);
      ctx.restore();
    });
  }

  private drawNotes(ctx: CanvasRenderingContext2D): void {
    const now = this.frame;
    for (const note of this.groundNotes.values()) {
      if (note.scene !== this.scene) continue;
      const x = Math.round(note.x);
      const y = Math.round(note.y);
      ctx.fillStyle = 'rgba(40, 37, 30, .2)';
      ctx.fillRect(x - 7, y + 4, 14, 3);

      // 高亮提示：TA 留的东西带呼吸光环 + 上下浮动的感叹号，避免"留了找不到"
      const mine = note.authorId === this.local.id;
      if (!mine) {
        const pulse = (Math.sin(now / 420 + x) + 1) / 2;
        ctx.save();
        ctx.globalAlpha = 0.28 + pulse * 0.3;
        ctx.strokeStyle = '#f1c56f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y + 5, 14 + pulse * 4, 6 + pulse * 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.12 + pulse * 0.14;
        ctx.fillStyle = '#f1c56f';
        ctx.beginPath();
        ctx.ellipse(x, y + 5, 14 + pulse * 4, 6 + pulse * 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (note.kind === 'treat') {
        ctx.fillStyle = '#e8a04c';
        ctx.fillRect(x - 6, y - 2, 9, 5);
        ctx.fillRect(x + 3, y - 4, 4, 9);
        ctx.fillStyle = '#f7d9a0';
        ctx.fillRect(x - 4, y - 1, 2, 2);
      } else {
        ctx.fillStyle = '#8a6c4c';
        ctx.fillRect(x - 7, y - 5, 14, 11);
        ctx.fillStyle = '#f6eed8';
        ctx.fillRect(x - 6, y - 4, 12, 9);
        ctx.fillStyle = '#b0a184';
        ctx.fillRect(x - 4, y - 1, 8, 1);
        ctx.fillRect(x - 4, y + 2, 6, 1);
      }
      if (!mine) {
        const bounce = Math.round(Math.sin(now / 260 + x) * 2);
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#543927';
        ctx.fillText('!', x + 1, y - 11 + bounce);
        ctx.fillStyle = '#ffd97a';
        ctx.fillText('!', x, y - 12 + bounce);
      }
      // 附在纸条上的花：别在纸角上
      if (note.flower) {
        ctx.save();
        ctx.translate(x + 10, y - 6);
        drawFlowerHead(ctx, note.flower, 0.55, Math.sin(now / 900 + x) * 0.4, false);
        ctx.restore();
      }
    }
  }

  private drawOverhead(ctx: CanvasRenderingContext2D, entity: OverheadEntity, _label: string): void {
    const now = this.frame;
    let anchorY = entity.y - 104;

    const fx = this.emoteFx.get(entity.id);
    if (fx) {
      const age = now - fx.at;
      const alpha = age > EMOTE_LIFE - 600 ? (EMOTE_LIFE - age) / 600 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      drawEmoteIcon(ctx, fx.emote, entity.x, anchorY + Math.round(Math.sin(now / 200) * 2));
      ctx.restore();
      anchorY -= 20;
    }

    const list = this.bubbles.get(entity.id);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const bubble = list[i]!;
      const age = now - bubble.at;
      const rise = Math.min(age / 300, 1) * 4 + (age / BUBBLE_LIFE) * 6;
      const alpha = age > BUBBLE_LIFE - 900 ? (BUBBLE_LIFE - age) / 900 : 1;
      const depth = list.length - 1 - i;
      drawBubble(ctx, entity.x, anchorY - depth * 22 - rise, bubble.text, Math.max(0, alpha));
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    const now = this.frame;
    for (const particle of this.particles) {
      const age = now - particle.at;
      if (age < 0) continue; //  staggered 粒子还没到出场时间
      const progress = age / particleLife(particle.kind);
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      if (particle.kind === 'heart') {
        drawPixelHeart(ctx, Math.round(particle.x), Math.round(particle.y - progress * 22), 2);
      } else if (particle.kind === 'zzz') {
        ctx.font = `bold ${Math.round(11 + progress * 4)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#9db4d0';
        ctx.fillText('z', Math.round(particle.x + progress * 8), Math.round(particle.y - progress * 26));
      } else if (particle.kind === 'crumb') {
        ctx.fillStyle = '#f2cf8a';
        ctx.fillRect(Math.round(particle.x), Math.round(particle.y + progress * 10), 3, 3);
        ctx.fillStyle = '#d9a95e';
        ctx.fillRect(Math.round(particle.x) + 1, Math.round(particle.y + progress * 10) + 2, 1, 1);
      } else if (particle.kind === 'drop') {
        // 浇水水珠：斜向下洒落
        ctx.fillStyle = WATER_COLORS[Math.floor(hash(particle.x, particle.y) * WATER_COLORS.length)]!;
        ctx.fillRect(Math.round(particle.x - progress * 6), Math.round(particle.y + progress * 26), 2, 3);
      } else {
        ctx.fillStyle = '#e8d5a6';
        ctx.fillRect(Math.round(particle.x - progress * 14), Math.round(particle.y - Math.sin(progress * Math.PI) * 12), 3, 3);
      }
      ctx.restore();
    }
  }
}

interface PlayerSnapshotLike {
  id: string;
  x: number;
  y: number;
  activity: Activity;
  direction: Direction;
  appearance: Appearance;
  cosleepWith?: string | null;
  nuzzleWith?: string | null;
  headFlower?: FlowerId | null;
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

function drawCabin(ctx: CanvasRenderingContext2D, time: number): void {
  if (cabinImage.complete && cabinImage.naturalWidth > 0) {
    ctx.save();
    ctx.filter = 'saturate(94%)';
    ctx.drawImage(cabinImage, 0, 0, WORLD.width, WORLD.height);
    ctx.restore();
    return;
  }
  // 兜底小屋（素材加载完成前显示）：木地板 + 墙 + 壁炉 + 地毯 + 双人软垫
  ctx.fillStyle = '#3a2a1c'; ctx.fillRect(0, 0, 960, 640);
  ctx.fillStyle = '#6b4a2e'; ctx.fillRect(60, 40, 840, 560);
  ctx.fillStyle = '#8a5f3a';
  for (let y = 210; y < 600; y += 26) {
    ctx.fillRect(70, y, 820, 24);
    ctx.fillStyle = '#7d5534'; ctx.fillRect(70, y + 23, 820, 2); ctx.fillStyle = '#8a5f3a';
  }
  ctx.fillStyle = '#5a3d26'; ctx.fillRect(60, 40, 840, 170);
  ctx.fillStyle = '#7a5636';
  for (let x = 76; x < 890; x += 42) ctx.fillRect(x, 48, 4, 156);

  // 壁炉
  ctx.fillStyle = '#7d7268'; ctx.fillRect(200, 60, 130, 150);
  ctx.fillStyle = '#8d8378'; ctx.fillRect(192, 60, 146, 26);
  ctx.fillStyle = '#2e2016'; ctx.fillRect(222, 128, 86, 72);
  const flick = Math.sin(time / 130) * 4;
  ctx.fillStyle = '#e0762e'; ctx.fillRect(238, 158 - flick, 54, 40 + flick);
  ctx.fillStyle = '#f2b13c'; ctx.fillRect(248, 168 - flick, 34, 30 + flick);
  ctx.fillStyle = '#fff1a9'; ctx.fillRect(258, 182, 14, 16);

  // 书架
  ctx.fillStyle = '#5f3d24'; ctx.fillRect(720, 56, 170, 150);
  const bookColors = ['#b3543f', '#4f7a5a', '#4a6a8a', '#c9a35a', '#7a5a8a'];
  for (let row = 0; row < 3; row++) {
    ctx.fillStyle = '#7a5636'; ctx.fillRect(728, 66 + row * 46, 154, 40);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = bookColors[(i + row * 2) % bookColors.length]!;
      ctx.fillRect(733 + i * 12, 70 + row * 46 + (i % 3), 9, 32 - (i % 3));
    }
  }

  // 地毯
  ctx.fillStyle = '#b3543f'; ctx.fillRect(370, 310, 220, 170);
  ctx.fillStyle = '#d9b06a'; ctx.fillRect(384, 324, 192, 142);
  ctx.fillStyle = '#b3543f'; ctx.fillRect(400, 340, 160, 110);
  ctx.fillStyle = '#e8cf9a'; ctx.fillRect(424, 364, 112, 62);

  // 双人软垫
  ctx.fillStyle = '#a85450'; ctx.fillRect(690, 420, 130, 90);
  ctx.fillStyle = '#d98273'; ctx.fillRect(698, 428, 114, 74);
  ctx.fillStyle = '#eaa48f'; ctx.fillRect(714, 440, 82, 50);

  // 扶手椅与小桌
  ctx.fillStyle = '#7a4f30'; ctx.fillRect(150, 340, 90, 96);
  ctx.fillStyle = '#9a6a42'; ctx.fillRect(158, 348, 74, 80);
  ctx.fillStyle = '#6d432b'; ctx.fillRect(258, 400, 60, 44);
  ctx.fillStyle = '#f0deb0'; ctx.fillRect(268, 404, 40, 26);

  // 门口地垫
  ctx.fillStyle = '#a9805a'; ctx.fillRect(438, 566, 84, 30);
  ctx.fillStyle = '#8a6844'; ctx.fillRect(446, 573, 68, 16);

  // 窗框（天空由 drawWindowSky 在叠色层之上绘制）
  ctx.fillStyle = '#5a3d26'; ctx.fillRect(WINDOW_GLASS.x - 10, WINDOW_GLASS.y - 10, WINDOW_GLASS.width + 20, WINDOW_GLASS.height + 20);
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, strength: number, time: number): void {
  const flicker = 0.88 + Math.sin(time / 260 + x * 0.7) * 0.12;
  const alpha = strength * flicker;
  const gradient = ctx.createRadialGradient(x, y, 4, x, y, radius);
  gradient.addColorStop(0, `rgba(255, 198, 100, ${0.5 * alpha})`);
  gradient.addColorStop(0.55, `rgba(255, 166, 64, ${0.22 * alpha})`);
  gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

// 窗景：画在昼夜叠色层之上，屋里的窗永远映着外面的天色
function drawWindowSky(ctx: CanvasRenderingContext2D, label: string, time: number): void {
  const { x, y, width, height } = WINDOW_GLASS;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  if (label === '夜晚') {
    ctx.fillStyle = '#141c38';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#f4e8b0';
    ctx.beginPath(); ctx.arc(x + width - 26, y + 20, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8cc96';
    ctx.fillRect(x + width - 30, y + 16, 3, 3); ctx.fillRect(x + width - 22, y + 24, 2, 2);
    ctx.fillStyle = '#e8ecf8';
    for (let i = 0; i < 9; i++) {
      const sx = x + 8 + hash(i * 31, 7) * (width - 20);
      const sy = y + 6 + hash(i * 17, 3) * (height - 16);
      if (Math.sin(time / 700 + i * 2.4) > -0.2) ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
    }
  } else if (label === '黄昏') {
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, '#7a4a68');
    gradient.addColorStop(0.55, '#e0764e');
    gradient.addColorStop(1, '#f2b06a');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#ffd98a';
    ctx.beginPath(); ctx.arc(x + 30, y + height - 18, 9, 0, Math.PI * 2); ctx.fill();
  } else if (label === '清晨') {
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, '#9ab8d8');
    gradient.addColorStop(1, '#f0d8c0');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
  } else {
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, '#8ec8e8');
    gradient.addColorStop(1, '#d8ecf8');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#ffffff';
    const drift = Math.round((time / 120) % (width + 40)) - 20;
    ctx.fillRect(x + drift, y + 14, 22, 7);
    ctx.fillRect(x + drift + 5, y + 10, 12, 5);
  }
  // 远山剪影（白天/清晨/黄昏）
  if (label !== '夜晚') {
    ctx.fillStyle = label === '黄昏' ? '#5a3a52' : '#6a8a78';
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x + width * 0.3, y + height - 18);
    ctx.lineTo(x + width * 0.55, y + height - 8);
    ctx.lineTo(x + width * 0.8, y + height - 20);
    ctx.lineTo(x + width, y + height - 10);
    ctx.lineTo(x + width, y + height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // 窗棂（四格窗）
  ctx.fillStyle = '#5a3d26';
  ctx.fillRect(x + Math.round(width / 2) - 2, y, 4, height);
  ctx.fillRect(x, y + Math.round(height / 2) - 2, width, 4);
  ctx.fillRect(x, y - 3, width, 3);
  ctx.fillRect(x, y + height, width, 3);
}

// 双人被窝的被子：代码绘制的像素被，覆盖两只猫的下半身——1 张被子适配全部花色组合
function drawBlanket(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const x = Math.round(cx - 58);
  const y = Math.round(cy + 4);
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cabinImage, 1090, 760, 170, 58, x, y, 116, 40);
  ctx.restore();
}

function drawBed(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = '#543927'; ctx.fillRect(x - 33, y - 27, 66, 47);
  ctx.fillStyle = color; ctx.fillRect(x - 28, y - 21, 56, 35);
  ctx.fillStyle = '#ead5ad'; ctx.fillRect(x - 22, y - 16, 44, 22);
  ctx.fillStyle = '#c9a879'; ctx.fillRect(x - 30, y + 12, 60, 9);
}

function drawCat(ctx: CanvasRenderingContext2D, player: PlayerSnapshotLike, time: number, ghost: boolean): void {
  ctx.save(); if (ghost) ctx.globalAlpha = .85;
  if (drawCatSprite(ctx, player, time)) {
    if (player.activity === 'play' && !player.nuzzleWith) {
      const ballX = Math.round(player.x + Math.sin(time / 190) * 29);
      ctx.fillStyle = '#7a3158'; ctx.fillRect(ballX - 6, Math.round(player.y) + 13, 12, 12);
      ctx.fillStyle = '#e792a7'; ctx.fillRect(ballX - 2, Math.round(player.y) + 15, 4, 4);
    }
    if (player.activity === 'study') {
      ctx.fillStyle='#6d432b'; ctx.fillRect(player.x + 9, player.y + 2, 34, 20);
      ctx.fillStyle='#f0deb0'; ctx.fillRect(player.x + 12, player.y + 4, 27, 14);
      ctx.fillStyle='#a96b58'; ctx.fillRect(player.x + 25, player.y + 4, 2, 14);
    }
  } else drawProceduralCat(ctx, player, time);
  ctx.restore();
}

function drawProceduralCat(ctx: CanvasRenderingContext2D, player: PlayerSnapshotLike, time: number): void {
  const { x, y, appearance, activity, direction } = player;
  const [base, light, dark] = appearance.colors;
  const moving = activity === 'walk';
  const bob = moving
    ? Math.round(Math.sin(time / 95 + x) * 2)
    : activity === 'play'
      ? Math.round(Math.sin(time / 120) * 2)
      : activity === 'eat'
        ? Math.round(Math.max(0, Math.sin(time / 170 + x)) * 2.5)
        : activity === 'toilet'
          ? Math.round(Math.sin(time / 240 + x) * 1.2)
          : activity === 'sleep'
            ? Math.round(Math.sin(time / 900 + x) * 1.5)
            : Math.round(Math.sin(time / 650 + x));
  const px = Math.round(x); const py = Math.round(y + bob);

  ctx.fillStyle = 'rgba(40, 37, 30, .24)'; ctx.fillRect(px - 17, Math.round(y) + 13, 34, 7);

  if (activity === 'sleep') {
    ctx.fillStyle = base; ctx.fillRect(px - 14, py - 4, 28, 15); ctx.fillRect(px - 10, py - 10, 20, 10);
    ctx.fillStyle = dark; ctx.fillRect(px - 13, py - 11, 7, 7); ctx.fillRect(px + 6, py - 11, 7, 7);
    ctx.fillStyle = '#e8c27b'; ctx.fillRect(px - 19, py + 2, 38, 16); ctx.fillStyle = '#c78b62'; ctx.fillRect(px - 19, py + 2, 38, 5);
    ctx.fillStyle = '#4b4236'; ctx.fillRect(px - 6, py - 2, 4, 2); ctx.fillRect(px + 4, py - 2, 4, 2);
    if (player.headFlower) {
      // 睡觉时花放在枕边
      ctx.save();
      ctx.translate(px - 20, py - 12);
      drawHeadFlower(ctx, player.headFlower, time);
      ctx.restore();
    }
    return;
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
  const blink = activity !== 'eat' && ((time + hashString(player.id) * 977) % 3400) < 280;
  if (activity === 'eat') { ctx.fillRect(px - 5, py - 4, 3, 2); ctx.fillRect(px + 3, py - 4, 3, 2); }
  else if (blink) { ctx.fillRect(px - 6, py - 7, 3, 1); ctx.fillRect(px + 4, py - 7, 3, 1); }
  else { ctx.fillRect(px - 6, py - 9, 3, 4); ctx.fillRect(px + 4, py - 9, 3, 4); }
  ctx.fillStyle = '#b7676d'; ctx.fillRect(px - 1, py - 5, 3, 2);
  ctx.fillStyle = dark;
  const step = moving && Math.sin(time / 95) > 0 ? 3 : 0;
  ctx.fillRect(px - 10, py + 12, 7, 6 + step); ctx.fillRect(px + 4, py + 12, 7, 9 - step);

  if (activity === 'study') {
    const flip = Math.floor(time / 2400) % 2 === 0;
    ctx.fillStyle = '#f1d692'; ctx.fillRect(px + 13, py - 19, 12, 15);
    ctx.fillStyle = '#8b5a43'; ctx.fillRect(px + (flip ? 17 : 21), py - 17, 3, 11);
  }
  if (activity === 'toilet') { ctx.fillStyle = '#d7c295'; ctx.fillRect(px - 18, py + 13, 36, 6); }
  if (player.headFlower && direction !== 'up') {
    // 别在耳后：随头部 bob，左右方向时靠前侧
    const side = direction === 'left' ? -10 : 10;
    ctx.save();
    ctx.translate(px + side, py - 25);
    drawHeadFlower(ctx, player.headFlower, time);
    ctx.restore();
  }
}

function drawBubble(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  const width = Math.round(ctx.measureText(text).width) + 16;
  const left = Math.round(cx - width / 2);
  const top = Math.round(y - 18);
  ctx.fillStyle = '#3e2e25';
  ctx.fillRect(left - 2, top - 2, width + 4, 22);
  ctx.fillStyle = '#f8ecc9';
  ctx.fillRect(left, top, width, 18);
  ctx.fillStyle = '#3e2e25';
  ctx.fillRect(Math.round(cx) - 2, top + 18, 4, 4);
  ctx.fillStyle = '#40342a';
  ctx.fillText(text, cx, top + 13);
  ctx.restore();
}

function drawEmoteIcon(ctx: CanvasRenderingContext2D, emote: Emote, cx: number, cy: number): void {
  const x = Math.round(cx);
  const y = Math.round(cy);
  switch (emote) {
    case 'heart':
      drawPixelHeart(ctx, x, y, 2);
      return;
    case 'zzz':
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9db4d0';
      ctx.fillText('zZ', x, y);
      return;
    case 'question':
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f1c56f';
      ctx.fillText('?', x, y);
      return;
    case 'fish':
      ctx.fillStyle = '#e8a04c';
      ctx.fillRect(x - 7, y - 3, 10, 6);
      ctx.fillRect(x + 3, y - 5, 5, 10);
      ctx.fillStyle = '#fff2d8';
      ctx.fillRect(x - 5, y - 1, 2, 2);
      return;
    case 'star':
      ctx.fillStyle = '#f1c56f';
      ctx.fillRect(x - 1, y - 7, 3, 15);
      ctx.fillRect(x - 7, y - 1, 15, 3);
      ctx.fillRect(x - 3, y - 3, 7, 7);
      return;
    case 'angry':
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#d9534f';
      ctx.fillRect(-7, -2, 14, 4);
      ctx.fillRect(-2, -7, 4, 14);
      ctx.restore();
      return;
  }
}

function drawPixelHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  const rows = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
  const left = cx - 3.5 * scale;
  const top = cy - 3 * scale;
  ctx.fillStyle = '#e05d6f';
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      if (row[rx] === '1') ctx.fillRect(Math.round(left + rx * scale), Math.round(top + ry * scale), scale, scale);
    }
  });
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, own: boolean): void {
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  const width = ctx.measureText(label).width + 14;
  ctx.fillStyle = own ? '#614531' : 'rgba(48, 43, 37, .8)';
  ctx.fillRect(x - width / 2, y - 11, width, 16);
  ctx.fillStyle = own ? '#ffe6a3' : '#f5e9ce';
  ctx.fillText(label, x, y + 1);
}

function validSnapshot(value: PlayerSnapshot): boolean {
  return Boolean(value && typeof value.id === 'string' && typeof value.name === 'string' && Number.isFinite(value.x) && Number.isFinite(value.y));
}

function directionFromVector(x: number, y: number): Direction {
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

function randomInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function hash(x: number, y: number): number { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); }
function hashString(value: string): number {
  let result = 0;
  for (const character of value) result = ((result << 5) - result + character.charCodeAt(0)) | 0;
  return Math.abs(result);
}
function particleLife(kind: ParticleKind): number {
  return kind === 'heart' ? HEART_LIFE : kind === 'zzz' ? 1800 : kind === 'crumb' ? 900 : kind === 'drop' ? 620 : 1000;
}

function loadImage(source: string): HTMLImageElement {
  const image = new Image();
  image.src = source;
  return image;
}
