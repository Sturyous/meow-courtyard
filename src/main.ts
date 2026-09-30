import './style.css';
import { CourtyardGame } from './game';
import { RealtimeRoom } from './realtime';
import { clockLabel, setTimeMode, type TimeMode } from './daynight';
import { ensureIdentity, roomSecretOk, saveIdentity } from './identity';
import { applyWater, FLOWER_META, hasWatered, isWilted, PLOT_SPOTS, STAGE_NAMES } from './garden';
import {
  deleteDecor,
  deletePlayer,
  fetchDecor,
  fetchFlowerBag,
  fetchGarden,
  fetchGhosts,
  fetchOpenNotes,
  fetchRecap,
  insertDecor,
  insertNote,
  markNoteOpened,
  recordPresence,
  startHeartbeat,
  upsertPlayer,
  upsertPlot,
  writeFlowerBag,
  writeLeave,
  type FlowerBag,
} from './persistence';
import { emotes, flowers, type ChatMessage, type DecorItem, type DuetKind, type FlowerId, type GardenPlot, type Identity, type NoteData, type NoteKind, type PublicActivity, type SceneId } from './types';

const HINT_DEFAULT = '方向键 / WASD 移动 · 右键小猫互动 · 1-6 表情';

// 顶栏时钟：默认跟随本地真实时间；可用 🌗 按钮切换时间模式（仅本地渲染，不走网络）。
// 「TA的天空」优先用对方 presence 上报的时区；VITE_PARTNER_TZ 只在 TA 不在线时兜底。
const PARTNER_TZ_FALLBACK = (import.meta.env.VITE_PARTNER_TZ ?? '') as string;
let partnerTz = '';
const activePartnerTz = () => partnerTz || PARTNER_TZ_FALLBACK;
const TIME_MODES: { mode: TimeMode; label: string }[] = [
  { mode: 'local', label: '跟随本地' },
  { mode: 'partner', label: 'TA的天空' },
  { mode: 'day', label: '白天' },
  { mode: 'dusk', label: '黄昏' },
  { mode: 'night', label: '夜晚' },
];
const clockNode = document.querySelector<HTMLElement>('#clock');
const timeModeButton = document.querySelector<HTMLButtonElement>('#time-mode');
const tickClock = () => { if (clockNode) clockNode.textContent = clockLabel(); };
let timeModeIndex = Math.max(0, TIME_MODES.findIndex((entry) => entry.mode === localStorage.getItem('meow:time-mode')));
const applyTimeMode = () => {
  const entry = TIME_MODES[timeModeIndex]!;
  setTimeMode(entry.mode, activePartnerTz());
  if (timeModeButton) {
    const suffix = entry.mode === 'partner' && !activePartnerTz() ? '·未配时区' : '';
    timeModeButton.textContent = `🌗 ${entry.label}${suffix}`;
    timeModeButton.title = '切换天空时间：跟随本地 / TA的天空 / 白天 / 黄昏 / 夜晚（只影响自己这边）';
  }
  tickClock();
};
timeModeButton?.addEventListener('click', () => {
  timeModeIndex = (timeModeIndex + 1) % TIME_MODES.length;
  localStorage.setItem('meow:time-mode', TIME_MODES[timeModeIndex]!.mode);
  applyTimeMode();
});
applyTimeMode();
window.setInterval(tickClock, 20_000);

if (!roomSecretOk()) {
  document.querySelector('#gate')?.classList.add('open');
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  const canvas = requiredElement<HTMLCanvasElement>('#game');
  const messages = requiredElement<HTMLDivElement>('#messages');
  const form = requiredElement<HTMLFormElement>('#chat-form');
  const input = requiredElement<HTMLInputElement>('#chat-input');
  const status = requiredElement<HTMLDivElement>('#connection-status');

  const identity: Identity = await ensureIdentity();
  const myNoteIds = new Set<string>();
  let pendingInvite: { to: string; kind: DuetKind; timer: number } | null = null;
  let incomingInvite: { from: string; kind: DuetKind; timer: number } | null = null;
  let pendingNote: { kind: NoteKind; text: string } | null = null;
  let pendingDecor: FlowerId | null = null;
  const flowerBag: FlowerBag = {};
  let noteFlower: FlowerId | null = null;

  const bagCount = () => flowers.reduce((sum, f) => sum + (flowerBag[f] ?? 0), 0);
  const addFlower = (flower: FlowerId, count = 1) => {
    flowerBag[flower] = (flowerBag[flower] ?? 0) + count;
    void writeFlowerBag(identity.id, flowerBag);
  };
  const takeFlower = (flower: FlowerId): boolean => {
    if ((flowerBag[flower] ?? 0) <= 0) return false;
    flowerBag[flower] = flowerBag[flower]! - 1;
    if (flowerBag[flower]! <= 0) delete flowerBag[flower];
    void writeFlowerBag(identity.id, flowerBag);
    return true;
  };

  const game = new CourtyardGame(canvas, identity, {
    onMovement: (player) => room?.sendMovement(player),
    onActivity: (player) => {
      room?.sendActivity(player);
      void upsertPlayer(identity, player);
      void recordPresence(identity.id, `activity:${player.activity}`);
    },
    onAppearance: (player) => {
      identity.appearance = player.appearance;
      saveIdentity(identity);
      room?.sendAppearance(player);
      void upsertPlayer(identity, player);
      toast(`变成了${player.appearance.coat}${player.appearance.breed}`);
    },
    onRemoteMenu: (playerId, clientX, clientY) => openRemoteMenu(playerId, clientX, clientY),
    onSelfMenu: (clientX, clientY) => openSelfMenu(clientX, clientY),
    onGhostMenu: (playerId, clientX, clientY) => openGhostMenu(playerId, clientX, clientY),
    onNoteOpen: (note) => openNoteCard(note),
    onSceneChange: (scene) => {
      renderSceneButton(scene);
      toast(scene === 'cabin' ? '壁炉烧得正旺' : scene === 'garden' ? '我们的小花园' : '回到院子里');
    },
    onPlotMenu: (plot, _clientX, _clientY) => openPlotPanel(plot),
    onDecorMenu: (decor, clientX, clientY) => openDecorMenu(decor, clientX, clientY),
  });

  // ---- 场景切换（进屋 / 回院子 / 去花园） ----
  const sceneButton = requiredElement<HTMLButtonElement>('#scene-toggle');
  function renderSceneButton(scene: SceneId): void {
    sceneButton.innerHTML = scene === 'yard' ? '<span>⌂</span>进屋' : scene === 'cabin' ? '<span>⌂</span>回院子' : '<span>⌂</span>回院子';
  }
  renderSceneButton('yard');
  sceneButton.addEventListener('click', () => {
    game.switchScene();
    canvas.focus();
  });

  const room = new RealtimeRoom(identity.id, {
    getLocalPlayer: () => game.getSnapshot(),
    onPlayer: (player, sequence) => game.addOrUpdateRemote(player, sequence),
    onPlayerLeave: (id) => game.removeRemote(id),
    onPartnerTz: (tz) => {
      if (tz === partnerTz) return;
      partnerTz = tz;
      applyTimeMode();
    },
    onPresenceSync: (members) => {
      const order = [...members, { id: identity.id, joinedAt: room.getJoinedAt() }]
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
        .map((member) => member.id);
      game.assignBeds(order);
    },
    onChat: (message) => {
      addMessage(message);
      game.addBubble(message.playerId, message.text);
    },
    onStatus: (state, label) => {
      status.dataset.state = state;
      const labelNode = status.querySelector('span');
      if (labelNode) labelNode.textContent = label;
    },
    onReady: () => { void afterJoin(); },
    onNotePlaced: (note) => {
      game.addNote(note);
      toast(note.scene === 'cabin' ? 'TA 在屋里留了点东西' : 'TA 在院子里留了点东西');
    },
    onNoteOpened: (noteId) => {
      game.removeNote(noteId);
      if (myNoteIds.has(noteId)) toast('TA 拆了你留的东西');
    },
    onInteractInvite: (from, fromName, kind) => showIncomingInvite(from, fromName, kind),
    onInteractAccept: (from, kind) => {
      clearPendingInvite();
      if (kind === 'nuzzle') game.startNuzzle(from);
      else game.startCosleep(from);
      toast(kind === 'nuzzle' ? '蹭蹭！' : '一起钻进被窝');
    },
    onInteractDecline: () => {
      clearPendingInvite();
      toast('TA 现在不想');
    },
    onEmote: (playerId, emote) => game.showEmote(playerId, emote),
    onGardenUpdated: (plot) => {
      game.updatePlot(plot);
      if (plot.lastWateredBy && plot.lastWateredBy !== identity.id) {
        toast(plot.flower ? `TA 给${FLOWER_META[plot.flower].name}浇了水` : 'TA 打理了花园');
      }
    },
    onDecorPlaced: (decor) => {
      game.addDecorItem(decor);
      if (decor.placedBy !== identity.id) toast(`TA 种下了一朵${FLOWER_META[decor.flower].name}`);
    },
    onDecorRemoved: (decorId) => game.removeDecorItem(decorId),
  });

  async function afterJoin(): Promise<void> {
    void recordPresence(identity.id, 'join');
    void upsertPlayer(identity, game.getSnapshot());
    startHeartbeat(identity, () => game.getSnapshot());
    const [ghosts, notes, recap, garden, decor, bag] = await Promise.all([
      fetchGhosts(identity.id),
      fetchOpenNotes(),
      fetchRecap(identity.id),
      fetchGarden(),
      fetchDecor(),
      fetchFlowerBag(identity.id),
    ]);
    game.setGhosts(ghosts);
    game.setNotes(notes);
    game.setGarden(garden);
    game.setDecor(decor);
    Object.assign(flowerBag, bag);
    for (const note of notes) if (note.authorId === identity.id) myNoteIds.add(note.id);
    if (recap) showRecap(recap);
  }

  // ---- 活动按钮 ----
  document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach((button) => {
    button.addEventListener('click', () => {
      const activity = button.dataset.activity as PublicActivity;
      setActiveActivityButton(button);
      game.setActivity(activity);
      canvas.focus();
    });
  });

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(event.key)) {
      setActiveActivityButton(null);
      return;
    }
    const emoteIndex = ['1', '2', '3', '4', '5', '6'].indexOf(event.key);
    if (emoteIndex >= 0) {
      const emote = emotes[emoteIndex]!;
      game.showEmote(identity.id, emote);
      room.sendEmote(emote);
    }
  });

  // ---- 聊天 ----
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const message: ChatMessage = { id: crypto.randomUUID(), playerId: identity.id, name: identity.name, text: text.slice(0, 160), sentAt: Date.now(), local: true };
    addMessage(message);
    game.addBubble(identity.id, message.text);
    room.sendChat(identity.name, message.text);
    input.value = '';
  });

  document.querySelector('#chat-toggle')?.addEventListener('click', () => document.querySelector('#chat-panel')?.classList.toggle('collapsed'));

  // ---- 留纸条 ----
  const composer = requiredElement<HTMLDivElement>('#note-composer');
  const noteText = requiredElement<HTMLTextAreaElement>('#note-text');
  const flowerRow = requiredElement<HTMLDivElement>('#note-flower-row');

  function renderFlowerRow(): void {
    flowerRow.innerHTML = '';
    if (bagCount() === 0) return;
    const none = document.createElement('button');
    none.type = 'button';
    none.className = `flower-pick${noteFlower === null ? ' on' : ''}`;
    none.textContent = '不附花';
    none.addEventListener('click', () => { noteFlower = null; renderFlowerRow(); });
    flowerRow.append(none);
    for (const flower of flowers) {
      const count = flowerBag[flower] ?? 0;
      if (count <= 0) continue;
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = `flower-pick${noteFlower === flower ? ' on' : ''}`;
      pick.textContent = `${FLOWER_META[flower].icon} ×${count}`;
      pick.title = `附上一朵${FLOWER_META[flower].name}，TA 拆开时会收到`;
      pick.addEventListener('click', () => { noteFlower = flower; renderFlowerRow(); });
      flowerRow.append(pick);
    }
  }

  requiredElement<HTMLButtonElement>('#note-button').addEventListener('click', () => {
    composer.classList.add('open');
    noteText.value = '';
    noteFlower = null;
    renderFlowerRow();
    noteText.focus();
  });
  requiredElement<HTMLButtonElement>('#note-cancel').addEventListener('click', () => composer.classList.remove('open'));

  const beginPlacement = (kind: NoteKind) => {
    const text = kind === 'treat' ? '给你留了小鱼干' : noteText.value.trim().slice(0, 200);
    if (!text) return;
    pendingNote = { kind, text };
    composer.classList.remove('open');
    setHint('点击地面放下 · 右键取消');
    game.setNotePlacement((x, y) => {
      setHint(HINT_DEFAULT);
      if (!pendingNote) return;
      const draft = pendingNote;
      pendingNote = null;
      void placeNote(draft, x, y);
    });
  };
  requiredElement<HTMLButtonElement>('#note-place-note').addEventListener('click', () => beginPlacement('note'));
  requiredElement<HTMLButtonElement>('#note-place-treat').addEventListener('click', () => beginPlacement('treat'));

  canvas.addEventListener('contextmenu', () => {
    pendingNote = null;
    pendingDecor = null;
    setHint(HINT_DEFAULT);
  });

  async function placeNote(draft: { kind: NoteKind; text: string }, x: number, y: number): Promise<void> {
    const scene = game.getScene();
    // 附花：先从自己花袋扣掉；TA 拆开时转入 TA 的花袋
    const attached = draft.kind === 'note' && noteFlower && takeFlower(noteFlower) ? noteFlower : null;
    noteFlower = null;
    const saved = await insertNote(identity, draft.kind, draft.text, x, y, scene, attached);
    const note: NoteData = saved ?? {
      id: crypto.randomUUID(),
      authorId: identity.id,
      authorName: identity.name,
      kind: draft.kind,
      text: draft.text,
      x,
      y,
      scene,
      flower: attached,
      createdAt: new Date().toISOString(),
      openedAt: null,
    };
    game.addNote(note);
    myNoteIds.add(note.id);
    room.sendNotePlaced(note);
    toast(attached ? `纸条钉好了，附上了一朵${FLOWER_META[attached].name}` : draft.kind === 'treat' ? '小鱼干放好了' : '纸条钉好了');
  }

  // ---- 拆纸条 ----
  const noteCard = requiredElement<HTMLDivElement>('#note-card');
  function openNoteCard(note: NoteData): void {
    requiredElement<HTMLDivElement>('#note-card-text').textContent = note.text;
    requiredElement<HTMLDivElement>('#note-card-author').textContent = note.authorId === identity.id ? '你留的' : `${note.authorName} 留的`;
    const flowerLine = requiredElement<HTMLDivElement>('#note-card-flower');
    flowerLine.textContent = '';
    noteCard.classList.add('open');
    if (note.authorId === identity.id) {
      if (note.flower) flowerLine.textContent = `${FLOWER_META[note.flower].icon} 附上的一朵${FLOWER_META[note.flower].name}，等 TA 来拆`;
      return;
    }
    game.removeNote(note.id);
    void markNoteOpened(note.id);
    room.sendNoteOpened(note.id);
    if (note.kind === 'treat') game.showEmote(identity.id, 'fish');
    if (note.flower) {
      addFlower(note.flower);
      flowerLine.textContent = `${FLOWER_META[note.flower].icon} 随纸条附来的一朵${FLOWER_META[note.flower].name}，已放进你的花袋`;
    }
  }
  requiredElement<HTMLButtonElement>('#note-card-close').addEventListener('click', () => noteCard.classList.remove('open'));

  // ---- 花圃面板 ----
  const plotPanel = requiredElement<HTMLDivElement>('#plot-panel');
  const plotTitle = requiredElement<HTMLHeadingElement>('#plot-title');
  const plotStage = requiredElement<HTMLDivElement>('#plot-stage');
  const plotStatus = requiredElement<HTMLDivElement>('#plot-status');
  const plotActions = requiredElement<HTMLDivElement>('#plot-actions');
  requiredElement<HTMLButtonElement>('#plot-close').addEventListener('click', () => plotPanel.classList.remove('open'));

  function openPlotPanel(plot: GardenPlot): void {
    renderPlotPanel(plot);
    plotPanel.classList.add('open');
  }

  function renderPlotPanel(plot: GardenPlot): void {
    plotActions.innerHTML = '';
    const spot = PLOT_SPOTS[plot.plot]!;
    if (!plot.flower) {
      plotTitle.textContent = '一空坑，种点什么？';
      plotStage.innerHTML = '';
      plotStatus.textContent = '两个人都浇过水，种子才会长大。';
      for (const flower of flowers) {
        const button = document.createElement('button');
        button.textContent = `${FLOWER_META[flower].icon} 种${FLOWER_META[flower].name}`;
        button.addEventListener('click', () => {
          plotPanel.classList.remove('open');
          plantFlower(plot, flower, spot);
        });
        plotActions.append(button);
      }
      return;
    }

    const meta = FLOWER_META[plot.flower];
    const wilted = isWilted(plot);
    plotTitle.textContent = `${meta.icon} ${meta.name} · ${wilted ? '蔫了' : STAGE_NAMES[plot.stage]!}`;
    plotStage.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const cell = document.createElement('i');
      if (i < plot.stage) cell.className = wilted ? 'wilt' : 'on';
      plotStage.append(cell);
    }

    const mine = hasWatered(plot, identity.id);
    const waiting = plot.wateredBy.length > 0 && !mine;
    plotStatus.innerHTML = wilted
      ? '好久没浇水，花都低头了。<br>浇浇水就能救回来。'
      : plot.stage >= 4
        ? '开得正好，可以收获了。'
        : mine
          ? '你这轮浇过了，<strong>等 TA 来浇</strong>就会长大。'
          : waiting
            ? 'TA 已经浇过了，<strong>轮到你</strong>。'
            : '还没人浇水，你来第一瓢？';

    if (plot.stage >= 4) {
      const harvest = document.createElement('button');
      harvest.textContent = '✂ 收获';
      harvest.addEventListener('click', () => {
        plotPanel.classList.remove('open');
        harvestFlower(plot, spot);
      });
      plotActions.append(harvest);
      return;
    }
    const water = document.createElement('button');
    water.textContent = '💧 浇水';
    if (mine) {
      water.disabled = true;
      water.textContent = '💧 已浇过';
    }
    water.addEventListener('click', () => {
      plotPanel.classList.remove('open');
      waterPlot(plot, spot);
    });
    plotActions.append(water);
  }

  function waterPlot(plot: GardenPlot, spot: { x: number; y: number }): void {
    game.approachAnd(spot.x, spot.y + 34, () => {
      const { next, advanced, revived } = applyWater(game.getPlot(plot.plot), identity.id);
      game.updatePlot(next);
      game.splashWater(spot.x, spot.y);
      game.showEmote(identity.id, 'heart');
      void upsertPlot(next);
      room.sendGardenUpdated(next);
      void recordPresence(identity.id, 'activity:water');
      toast(revived ? '花缓过来了' : advanced ? `${FLOWER_META[next.flower!].name}长大了一截` : '浇好了，等 TA 也来浇');
    });
  }

  function plantFlower(plot: GardenPlot, flower: FlowerId, spot: { x: number; y: number }): void {
    game.approachAnd(spot.x, spot.y + 34, () => {
      const now = new Date().toISOString();
      const next: GardenPlot = {
        plot: plot.plot,
        flower,
        stage: 0,
        plantedBy: identity.id,
        stageAt: now,
        wateredBy: [],
        lastWateredAt: null,
        lastWateredBy: null,
      };
      game.updatePlot(next);
      game.splashWater(spot.x, spot.y);
      void upsertPlot(next);
      room.sendGardenUpdated(next);
      toast(`种下了${FLOWER_META[flower].name}，记得和 TA 轮流浇水`);
    });
  }

  function harvestFlower(plot: GardenPlot, spot: { x: number; y: number }): void {
    game.approachAnd(spot.x, spot.y + 34, () => {
      const flower = game.getPlot(plot.plot).flower;
      if (!flower) return;
      addFlower(flower);
      const cleared: GardenPlot = { plot: plot.plot, flower: null, stage: 0, plantedBy: null, stageAt: null, wateredBy: [], lastWateredAt: null, lastWateredBy: null };
      game.updatePlot(cleared);
      game.showEmote(identity.id, 'star');
      void upsertPlot(cleared);
      room.sendGardenUpdated(cleared);
      toast(`收获了一朵${FLOWER_META[flower].name}，放进花袋了`);
    });
  }

  // ---- 花袋面板 ----
  const bagPanel = requiredElement<HTMLDivElement>('#bag-panel');
  const bagList = requiredElement<HTMLDivElement>('#bag-list');
  requiredElement<HTMLButtonElement>('#bag-button').addEventListener('click', () => {
    renderBagPanel();
    bagPanel.classList.add('open');
  });
  requiredElement<HTMLButtonElement>('#bag-close').addEventListener('click', () => bagPanel.classList.remove('open'));

  function renderBagPanel(): void {
    bagList.innerHTML = '';
    for (const flower of flowers) {
      const count = flowerBag[flower] ?? 0;
      if (count <= 0) continue;
      const meta = FLOWER_META[flower];
      const row = document.createElement('div');
      row.className = 'bag-row';
      const icon = document.createElement('div');
      icon.className = 'bag-icon';
      icon.textContent = meta.icon;
      const name = document.createElement('div');
      name.className = 'bag-name';
      name.innerHTML = `${meta.name}<small>×${count}</small>`;
      const actions = document.createElement('div');
      actions.className = 'bag-actions';

      const toNote = document.createElement('button');
      toNote.textContent = '插在纸条上';
      toNote.title = '写一张纸条附上这朵花，TA 拆开时会收到';
      toNote.addEventListener('click', () => {
        bagPanel.classList.remove('open');
        composer.classList.add('open');
        noteText.value = '';
        noteFlower = flower;
        renderFlowerRow();
        noteText.focus();
      });

      const toDecor = document.createElement('button');
      toDecor.textContent = '种在门口';
      toDecor.title = '种在任意场景的地面上当装饰，右键可收回';
      toDecor.addEventListener('click', () => {
        bagPanel.classList.remove('open');
        pendingDecor = flower;
        setHint('点击地面种下这朵花 · 右键取消');
        game.setNotePlacement((x, y) => {
          setHint(HINT_DEFAULT);
          if (!pendingDecor) return;
          const chosen = pendingDecor;
          pendingDecor = null;
          void placeDecor(chosen, x, y);
        });
      });

      const toHead = document.createElement('button');
      toHead.textContent = '别在头上';
      toHead.title = '别在猫耳朵后面，TA 也能看见；右键自己可取回';
      toHead.addEventListener('click', () => {
        if (!takeFlower(flower)) return;
        game.setHeadFlower(flower);
        bagPanel.classList.remove('open');
        toast(`别上了一朵${meta.name}`);
      });

      actions.append(toNote, toDecor, toHead);
      row.append(icon, name, actions);
      bagList.append(row);
    }
  }

  async function placeDecor(flower: FlowerId, x: number, y: number): Promise<void> {
    if (!takeFlower(flower)) return;
    const scene = game.getScene();
    const saved = await insertDecor(flower, scene, x, y, identity.id);
    const item: DecorItem = saved ?? { id: crypto.randomUUID(), flower, scene, x: Math.round(x), y: Math.round(y), placedBy: identity.id };
    game.addDecorItem(item);
    room.sendDecorPlaced(item);
    toast(`种下了一朵${FLOWER_META[flower].name}`);
  }

  // ---- 双人互动 / 右键菜单 ----
  const menu = requiredElement<HTMLDivElement>('#context-menu');
  let menuTarget: string | null = null;

  const MENU_BUTTONS = ['#menu-nuzzle', '#menu-cosleep', '#menu-reroll', '#menu-bed', '#menu-poke', '#menu-dismiss', '#menu-flower-off', '#menu-decor-remove'];
  const showMenuButtons = (visible: string[]) => {
    for (const selector of MENU_BUTTONS) {
      requiredElement<HTMLButtonElement>(selector).style.display = visible.includes(selector) ? '' : 'none';
    }
  };

  function openRemoteMenu(playerId: string, clientX: number, clientY: number): void {
    menuTarget = playerId;
    showMenuButtons(game.getRemoteActivity(playerId) === 'sleep' ? ['#menu-nuzzle', '#menu-cosleep'] : ['#menu-nuzzle']);
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.classList.add('open');
  }

  function openSelfMenu(clientX: number, clientY: number): void {
    menuTarget = null;
    const buttons = ['#menu-reroll', '#menu-bed'];
    if (game.getHeadFlower()) buttons.push('#menu-flower-off');
    showMenuButtons(buttons);
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.classList.add('open');
  }

  // 装饰花：右键收回花袋
  let decorTarget: DecorItem | null = null;
  function openDecorMenu(decor: DecorItem, clientX: number, clientY: number): void {
    menuTarget = null;
    decorTarget = decor;
    requiredElement<HTMLButtonElement>('#menu-decor-remove').textContent = `收回这朵${FLOWER_META[decor.flower].name}`;
    showMenuButtons(['#menu-decor-remove']);
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.classList.add('open');
  }

  // 影子猫（TA 不在线 / 旧设备残留的猫）：戳一下互动，或把旧猫送走
  function openGhostMenu(playerId: string, clientX: number, clientY: number): void {
    menuTarget = playerId;
    showMenuButtons(['#menu-poke', '#menu-dismiss']);
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.classList.add('open');
  }

  const closeMenu = () => menu.classList.remove('open');
  window.addEventListener('click', (event) => {
    if (!menu.contains(event.target as Node)) closeMenu();
  });

  const invite = (kind: DuetKind) => {
    if (!menuTarget) return;
    const to = menuTarget;
    closeMenu();
    room.sendInteractInvite(to, identity.name, kind);
    toast('等 TA 回应…');
    pendingInvite = {
      to,
      kind,
      timer: window.setTimeout(() => { pendingInvite = null; toast('TA 没理你'); }, 12_000),
    };
  };
  requiredElement<HTMLButtonElement>('#menu-nuzzle').addEventListener('click', () => invite('nuzzle'));
  requiredElement<HTMLButtonElement>('#menu-cosleep').addEventListener('click', () => invite('cosleep'));
  requiredElement<HTMLButtonElement>('#menu-reroll').addEventListener('click', () => { closeMenu(); game.rerollAppearance(); });
  requiredElement<HTMLButtonElement>('#menu-bed').addEventListener('click', () => { closeMenu(); game.sleepInBed(); canvas.focus(); });
  requiredElement<HTMLButtonElement>('#menu-poke').addEventListener('click', () => {
    if (menuTarget) game.pokeGhost(menuTarget);
    closeMenu();
  });
  requiredElement<HTMLButtonElement>('#menu-dismiss').addEventListener('click', () => {
    if (menuTarget) {
      game.forgetGhost(menuTarget);
      void deletePlayer(menuTarget);
      toast('送走了这只猫，它的东西还留在原地');
    }
    closeMenu();
  });
  requiredElement<HTMLButtonElement>('#menu-flower-off').addEventListener('click', () => {
    const flower = game.getHeadFlower();
    if (flower) {
      game.setHeadFlower(null);
      addFlower(flower);
      toast(`取下了${FLOWER_META[flower].name}，放回花袋`);
    }
    closeMenu();
  });
  requiredElement<HTMLButtonElement>('#menu-decor-remove').addEventListener('click', () => {
    if (decorTarget) {
      const item = decorTarget;
      game.removeDecorItem(item.id);
      addFlower(item.flower);
      void deleteDecor(item.id);
      room.sendDecorRemoved(item.id);
      toast(`收回了这朵${FLOWER_META[item.flower].name}`);
    }
    decorTarget = null;
    closeMenu();
  });

  function clearPendingInvite(): void {
    if (pendingInvite) window.clearTimeout(pendingInvite.timer);
    pendingInvite = null;
  }

  const inviteBar = requiredElement<HTMLDivElement>('#invite-bar');
  function showIncomingInvite(from: string, fromName: string, kind: DuetKind): void {
    if (incomingInvite) window.clearTimeout(incomingInvite.timer);
    incomingInvite = {
      from,
      kind,
      timer: window.setTimeout(() => {
        if (incomingInvite) room.sendInteractDecline(incomingInvite.from, incomingInvite.kind);
        incomingInvite = null;
        inviteBar.classList.remove('open');
      }, 10_000),
    };
    requiredElement<HTMLSpanElement>('#invite-text').textContent = kind === 'nuzzle' ? `${fromName} 想蹭蹭你` : `${fromName} 想和你挤一个被窝`;
    inviteBar.classList.add('open');
  }

  const settleIncoming = () => {
    if (incomingInvite) window.clearTimeout(incomingInvite.timer);
    inviteBar.classList.remove('open');
    return incomingInvite;
  };

  requiredElement<HTMLButtonElement>('#invite-accept').addEventListener('click', () => {
    const current = settleIncoming();
    incomingInvite = null;
    if (!current) return;
    room.sendInteractAccept(current.from, current.kind);
    if (current.kind === 'nuzzle') game.startNuzzle(current.from);
    else game.acceptCosleep(current.from);
  });
  requiredElement<HTMLButtonElement>('#invite-decline').addEventListener('click', () => {
    const current = settleIncoming();
    incomingInvite = null;
    if (current) room.sendInteractDecline(current.from, current.kind);
  });

  // ---- 上线回放 ----
  function showRecap(recap: { sinceHours: number; visits: number; activities: { activity: string; minutes: number }[]; unopenedNotes: number }): void {
    const activityLabel: Record<string, string> = { sleep: '睡觉', study: '学习', eat: '吃饭', play: '玩耍', toilet: '上厕所', idle: '发呆', walk: '溜达', water: '浇花' };
    let text = `你不在的 ${recap.sinceHours} 小时里，TA 来过 ${recap.visits} 次`;
    for (const entry of recap.activities) text += `，${activityLabel[entry.activity] ?? entry.activity}了 ${entry.minutes} 分钟`;
    if (recap.unopenedNotes > 0) text += `，还给你留了 ${recap.unopenedNotes} 样东西`;
    text += '。';
    const banner = requiredElement<HTMLDivElement>('#recap');
    banner.textContent = text;
    banner.classList.add('open');
    window.setTimeout(() => banner.classList.remove('open'), 10_000);
  }

  // ---- 消息与提示 ----
  function addMessage(message: ChatMessage): void {
    const row = document.createElement('div');
    row.className = `message${message.local ? ' mine' : ''}`;
    const author = document.createElement('strong');
    author.textContent = message.local ? '你' : message.name;
    const body = document.createElement('span');
    body.textContent = message.text;
    row.append(author, body);
    messages.append(row);
    while (messages.childElementCount > 40) messages.firstElementChild?.remove();
    messages.scrollTop = messages.scrollHeight;
  }

  function setHint(text: string): void {
    const hint = document.querySelector<HTMLDivElement>('#hint');
    if (hint) hint.textContent = text;
  }

  function toast(text: string): void {
    const hint = document.querySelector<HTMLDivElement>('#hint');
    if (!hint) return;
    hint.textContent = text;
    hint.classList.add('pop');
    window.setTimeout(() => { hint.textContent = HINT_DEFAULT; hint.classList.remove('pop'); }, 1800);
  }

  void room.connect();
  window.addEventListener('pagehide', () => {
    writeLeave(identity, game.getSnapshot());
    void room.disconnect();
    game.destroy();
  });
}

function setActiveActivityButton(active: HTMLButtonElement | null): void {
  document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach((node) => {
    const isActive = node === active;
    node.classList.toggle('active', isActive);
    node.setAttribute('aria-pressed', String(isActive));
  });
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素：${selector}`);
  return element;
}
