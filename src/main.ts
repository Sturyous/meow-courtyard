import './style.css';
import { CourtyardGame } from './game';
import { RealtimeRoom } from './realtime';
import { clockLabel, setTimeMode, type TimeMode } from './daynight';
import { ensureIdentity, roomSecretOk, saveIdentity } from './identity';
import { FLOWER_META, hasWatered, isWilted, PLOT_SPOTS, STAGE_NAMES } from './garden';
import {
  deletePlayer,
  fetchDecor,
  fetchOwnState,
  fetchPlayers,
  flowerAction,
  fetchGarden,
  fetchGhosts,
  fetchOpenNotes,
  fetchRecap,
  recordPresence,
  startHeartbeat,
  upsertPlayer,
  writeLeave,
  type FlowerBag,
} from './persistence';
import { emotes, flowers, type ChatMessage, type DecorItem, type DuetKind, type DuetInvite, type FlowerId, type GardenPlot, type Identity, type NoteData, type NoteKind, type PublicActivity, type SceneId } from './types';

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
  const bedMembers = new Set([identity.id]);
  let pendingInvite: (DuetInvite & { timer: number }) | null = null;
  let incomingInvite: (DuetInvite & { timer: number }) | null = null;
  type NoteDraft = { kind: NoteKind; text: string; flower: FlowerId | null; requestId: string };
  let pendingNote: NoteDraft | null = null;
  let retryNote: NoteDraft | null = null;
  let pendingDecor: { flower: FlowerId; requestId: string } | null = null;
  let retryDecor: { flower: FlowerId; requestId: string } | null = null;
  const flowerBag: FlowerBag = {};
  let noteFlower: FlowerId | null = null;

  const bagCount = () => flowers.reduce((sum, f) => sum + (flowerBag[f] ?? 0), 0);
  const syncBag = (bag: FlowerBag) => {
    for (const flower of flowers) delete flowerBag[flower];
    Object.assign(flowerBag, bag);
  };
  let saving = false;
  let failedRequest: { key: string; id: string } | null = null;
  async function saveAction(action: Parameters<typeof flowerAction>[1], args: Record<string, unknown>, explicitRequestId?: string) {
    if (saving) throw new Error('上一件物品还在保存，请稍等');
    saving = true;
    const writeButtons = [...document.querySelectorAll<HTMLButtonElement>('#note-place-note, #note-place-treat, .bag-actions button, #menu-flower-off, #menu-decor-remove, #plot-actions button')].map(button => [button, button.disabled] as const);
    for (const [button] of writeButtons) button.disabled = true;
    const key = JSON.stringify([action, args]);
    const requestId = explicitRequestId ?? (failedRequest?.key === key ? failedRequest.id : crypto.randomUUID());
    try {
      const result = await flowerAction(identity.id, action, args, requestId);
      failedRequest = null;
      syncBag(result.flowers);
      if (game.getHeadFlower() !== result.headFlower) game.setHeadFlower(result.headFlower);
      return result;
    } catch (error) { failedRequest = { key, id: requestId }; throw error; }
    finally { saving = false; for (const [button, disabled] of writeButtons) button.disabled = disabled; }
  }
  const failedSave = (error: unknown) => toast(error instanceof Error ? '保存未确认：' + error.message : '保存未确认，请重试');
  let stopHeartbeat: (() => void) | undefined;
  let joining = false;
  let joinedOnce = false;

  const game = new CourtyardGame(canvas, identity, {
    onMovement: (player) => { if (player.activity === 'walk') cancelInvites(); room?.sendMovement(player); },
    onActivity: (player) => {
      cancelInvites();
      setActiveActivityButton(document.querySelector<HTMLButtonElement>(`[data-activity="${player.activity}"]`));
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
      cancelInvites();
      setActiveActivityButton(null);
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
    onPlayer: (player, sequence) => {
      game.addOrUpdateRemote(player, sequence);
      if ((incomingInvite?.from === player.id || pendingInvite?.to === player.id) && player.scene !== game.getScene() && player.cosleepWith !== identity.id) cancelInvites();
    },
    onPlayerLeave: (id) => { cancelInvites(); game.removeRemote(id); },
    onPartnerTz: (tz) => {
      if (tz === partnerTz) return;
      partnerTz = tz;
      applyTimeMode();
    },
    onPresenceSync: (members) => {
      for (const member of members) bedMembers.add(member.id);
      game.assignBeds([...bedMembers].sort());
    },
    onChat: (message) => {
      addMessage(message);
      game.addBubble(message.playerId, message.text);
    },
    onStatus: (state, label) => {
      if (state === 'offline') cancelInvites();
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
    onInteractInvite: (invite) => showIncomingInvite(invite),
    onInteractAccept: (from, requestId) => {
      const invite = pendingInvite;
      if (!invite || invite.to !== from || invite.requestId !== requestId || invite.expiresAt < Date.now() || game.getScene() !== invite.scene) return;
      clearPendingInvite();
      if (invite.kind === 'nuzzle') { if (!game.canInteract(from)) return; game.startNuzzle(from, invite); }
      else game.startCosleep(from);
      toast(invite.kind === 'nuzzle' ? '蹭蹭！' : '一起钻进被窝');
    },
    onInteractDecline: (from, requestId) => {
      if (pendingInvite?.to === from && pendingInvite.requestId === requestId) { clearPendingInvite(); toast('这次先不了'); }
      if (incomingInvite?.from === from && incomingInvite.requestId === requestId) { settleIncoming(); incomingInvite = null; }
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
    onDecorRemoved: (decorId) => {
      game.removeDecorItem(decorId);
      if (decorTarget?.id === decorId) { decorTarget = null; closeMenu(); }
    },
  });

  async function afterJoin(): Promise<void> {
    if (joining) return;
    joining = true;
    try {
      await upsertPlayer(identity, game.getSnapshot());
      stopHeartbeat?.();
      stopHeartbeat = startHeartbeat(identity, () => game.getSnapshot());
      if (!joinedOnce) { joinedOnce = true; void recordPresence(identity.id, 'join'); }
      const [ghosts, notes, recap, garden, decor, own] = await Promise.all([
        fetchGhosts(identity.id), fetchOpenNotes(), fetchRecap(identity.id),
        fetchGarden(), fetchDecor(), fetchOwnState(identity.id),
      ]);
      game.setGhosts(ghosts); game.setNotes(notes); game.setGarden(garden); game.setDecor(decor);
      syncBag(own.flowers); game.setHeadFlower(own.headFlower);
      for (const note of notes) if (note.authorId === identity.id) myNoteIds.add(note.id);
      if (recap) showRecap(recap);
    } catch (error) { failedSave(error); }
    finally { joining = false; }
  }

  // ---- 活动按钮 ----
  document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach((button) => {
    button.addEventListener('click', () => {
      const activity = button.dataset.activity as PublicActivity;
      setActiveActivityButton(button);
      cancelInvites();
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
    noteFlower = null;
    renderFlowerRow();
    noteText.focus();
  });
  requiredElement<HTMLButtonElement>('#note-cancel').addEventListener('click', () => composer.classList.remove('open'));

  const beginPlacement = (kind: NoteKind) => {
    const text = kind === 'treat' ? '给你留了小鱼干' : noteText.value.trim().slice(0, 200);
    if (!text) return;
    const flower = kind === 'note' ? noteFlower : null;
    pendingNote = retryNote?.kind === kind && retryNote.text === text && retryNote.flower === flower
      ? retryNote : { kind, text, flower, requestId: crypto.randomUUID() };
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

  async function placeNote(draft: NoteDraft, x: number, y: number): Promise<void> {
    const scene = game.getScene();
    const attached = draft.flower;
    let note: NoteData;
    try {
      const result = await saveAction('place-note', { kind: draft.kind, text: draft.text, x: Math.round(x), y: Math.round(y), scene, flower: attached }, draft.requestId);
      note = result.note!;
      retryNote = null;
      if (noteText.value === draft.text && noteFlower === draft.flower) { noteFlower = null; noteText.value = ''; }
    } catch (error) {
      retryNote = draft; noteFlower = draft.flower;
      noteText.value = draft.text; composer.classList.add('open'); renderFlowerRow();
      failedSave(error); return;
    }
    game.addNote(note);
    myNoteIds.add(note.id);
    room.sendNotePlaced(note);
    toast(attached ? `纸条钉好了，附上了一朵${FLOWER_META[attached].name}` : draft.kind === 'treat' ? '小鱼干放好了' : '纸条钉好了');
  }

  // ---- 拆纸条 ----
  const noteCard = requiredElement<HTMLDivElement>('#note-card');
  async function openNoteCard(note: NoteData): Promise<void> {
    requiredElement<HTMLDivElement>('#note-card-text').textContent = note.text;
    requiredElement<HTMLDivElement>('#note-card-author').textContent = note.authorId === identity.id ? '你留的' : `${note.authorName} 留的`;
    const flowerLine = requiredElement<HTMLDivElement>('#note-card-flower');
    flowerLine.textContent = '';
    noteCard.classList.add('open');
    if (note.authorId === identity.id) {
      if (note.flower) flowerLine.textContent = `${FLOWER_META[note.flower].icon} 附上的一朵${FLOWER_META[note.flower].name}，等 TA 来拆`;
      return;
    }
    try { await saveAction('open-note', { id: note.id }); }
    catch (error) { failedSave(error); flowerLine.textContent = '尚未领取，关闭后可重试'; return; }
    game.removeNote(note.id);
    room.sendNoteOpened(note.id);
    if (note.kind === 'treat') game.showEmote(identity.id, 'fish');
    if (note.flower) {
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

  async function openPlotPanel(plot: GardenPlot): Promise<void> {
    try { game.setGarden(await fetchGarden()); plot = game.getPlot(plot.plot); }
    catch (error) { failedSave(error); return; }
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
        : plot.wateredBy.length >= 2
          ? '两个人都浇好了，满 18 小时会长大；仍可浇水保鲜。'
        : mine
          ? '你这轮浇过了，等 TA 来浇；仍可浇水保鲜。'
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
    if (mine) water.textContent = wilted ? '💧 救活这朵花' : '💧 浇水保鲜';
    water.addEventListener('click', () => {
      plotPanel.classList.remove('open');
      waterPlot(plot, spot);
    });
    plotActions.append(water);
  }

  function gardenAction(action: 'plant' | 'water' | 'harvest', plot: GardenPlot, spot: { x: number; y: number }, flower?: FlowerId): void {
    game.approachAnd(spot.x, spot.y + 34, () => {
      void saveAction(action, { plot: plot.plot, flower }).then((result) => {
        game.updatePlot(result.plot!); room.sendGardenUpdated(result.plot!);
        game.splashWater(spot.x, spot.y);
        toast(action === 'harvest' ? '收获好了，已放入花袋' : action === 'plant' ? '种好了，和 TA 轮流浇水吧' : '浇好了，花又精神了');
      }).catch(failedSave);
    });
  }
  const waterPlot = (plot: GardenPlot, spot: { x: number; y: number }) => gardenAction('water', plot, spot);
  const plantFlower = (plot: GardenPlot, flower: FlowerId, spot: { x: number; y: number }) => gardenAction('plant', plot, spot, flower);
  const harvestFlower = (plot: GardenPlot, spot: { x: number; y: number }) => gardenAction('harvest', plot, spot);

  // ---- 花袋面板 ----
  const bagPanel = requiredElement<HTMLDivElement>('#bag-panel');
  const bagList = requiredElement<HTMLDivElement>('#bag-list');
  requiredElement<HTMLButtonElement>('#bag-button').addEventListener('click', async () => {
    try { const own = await fetchOwnState(identity.id); syncBag(own.flowers); if (game.getHeadFlower() !== own.headFlower) game.setHeadFlower(own.headFlower); }
    catch (error) { failedSave(error); return; }
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
        pendingDecor = retryDecor?.flower === flower ? retryDecor : { flower, requestId: crypto.randomUUID() };
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
        void saveAction('equip', { flower }).then(() => {
          bagPanel.classList.remove('open'); toast(`别上了一朵${meta.name}`);
        }).catch(failedSave);
      });

      actions.append(toNote, toDecor, toHead);
      row.append(icon, name, actions);
      bagList.append(row);
    }
  }

  async function placeDecor(draft: { flower: FlowerId; requestId: string }, x: number, y: number): Promise<void> {
    try {
      const result = await saveAction('place-decor', { flower: draft.flower, scene: game.getScene(), x: Math.round(x), y: Math.round(y) }, draft.requestId);
      retryDecor = null;
      game.addDecorItem(result.decor!); room.sendDecorPlaced(result.decor!);
      toast('种好了');
    } catch (error) { retryDecor = draft; failedSave(error); }
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

  function positionMenu(clientX: number, clientY: number): void {
    menu.classList.add('open');
    menu.style.left = Math.max(8, Math.min(clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
  }

  function openRemoteMenu(playerId: string, clientX: number, clientY: number): void {
    menuTarget = playerId;
    showMenuButtons(game.getRemoteActivity(playerId) === 'sleep' ? ['#menu-nuzzle', '#menu-cosleep'] : ['#menu-nuzzle']);
    positionMenu(clientX, clientY);
  }

  function openSelfMenu(clientX: number, clientY: number): void {
    menuTarget = null;
    const buttons = ['#menu-reroll', '#menu-bed'];
    if (game.getHeadFlower()) buttons.push('#menu-flower-off');
    showMenuButtons(buttons);
    positionMenu(clientX, clientY);
  }

  // 装饰花：右键收回花袋
  let decorTarget: DecorItem | null = null;
  function openDecorMenu(decor: DecorItem, clientX: number, clientY: number): void {
    menuTarget = null;
    decorTarget = decor;
    requiredElement<HTMLButtonElement>('#menu-decor-remove').textContent = `收回这朵${FLOWER_META[decor.flower].name}`;
    showMenuButtons(['#menu-decor-remove']);
    positionMenu(clientX, clientY);
  }

  // 影子猫（TA 不在线 / 旧设备残留的猫）：戳一下互动，或把旧猫送走
  function openGhostMenu(playerId: string, clientX: number, clientY: number): void {
    menuTarget = playerId;
    showMenuButtons(['#menu-poke', '#menu-dismiss']);
    positionMenu(clientX, clientY);
  }

  const closeMenu = () => menu.classList.remove('open');
  window.addEventListener('click', (event) => {
    if (!menu.contains(event.target as Node)) closeMenu();
  });

  const invite = (kind: DuetKind) => {
    if (!menuTarget) return;
    const to = menuTarget;
    closeMenu();
    cancelInvites();
    if (!game.canInteract(to)) return;
    const player = game.getSnapshot();
    const invite: DuetInvite = { requestId: crypto.randomUUID(), from: identity.id, fromName: identity.name, to, kind, scene: game.getScene(), expiresAt: Date.now() + 12_000, x: player.x, y: player.y };
    pendingInvite = { ...invite, timer: window.setTimeout(() => { cancelInvites(); toast('邀请已过期'); }, 12_000) };
    room.sendInteractInvite(invite); toast('等 TA 回应…');
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
    void saveAction('equip', { flower: null }).then(() => toast('花已放回花袋')).catch(failedSave);
    closeMenu();
  });
  requiredElement<HTMLButtonElement>('#menu-decor-remove').addEventListener('click', () => {
    const item = decorTarget;
    decorTarget = null; closeMenu();
    if (!item) return;
    void saveAction('recover-decor', { id: item.id }).then(() => {
      game.removeDecorItem(item.id); room.sendDecorRemoved(item.id); toast('花已收回花袋');
    }).catch(failedSave);
  });

  function clearPendingInvite(): void {
    if (pendingInvite) window.clearTimeout(pendingInvite.timer);
    pendingInvite = null;
  }

  const inviteBar = requiredElement<HTMLDivElement>('#invite-bar');
  function cancelInvites(): void {
    if (pendingInvite) room.sendInteractDecline(pendingInvite.to, pendingInvite.requestId);
    if (incomingInvite) room.sendInteractDecline(incomingInvite.from, incomingInvite.requestId);
    clearPendingInvite();
    if (incomingInvite) window.clearTimeout(incomingInvite.timer);
    incomingInvite = null;
    document.querySelector('#invite-bar')?.classList.remove('open');
  }

  function showIncomingInvite(invite: DuetInvite): void {
    if (invite.expiresAt <= Date.now() || invite.expiresAt > Date.now() + 15_000 || invite.scene !== game.getScene() || !game.canInteract(invite.from)) return;
    // Simultaneous invitations: both clients choose the same request ID.
    if (pendingInvite && pendingInvite.requestId < invite.requestId) {
      room.sendInteractDecline(invite.from, invite.requestId); return;
    }
    cancelInvites();
    incomingInvite = { ...invite, timer: window.setTimeout(cancelInvites, invite.expiresAt - Date.now()) };
    requiredElement<HTMLSpanElement>('#invite-text').textContent = invite.kind === 'nuzzle' ? invite.fromName + ' 想蹭蹭你' : invite.fromName + ' 想一起去小屋睡';
    inviteBar.classList.add('open');
  }
  function settleIncoming() {
    const current = incomingInvite;
    if (current) window.clearTimeout(current.timer);
    inviteBar.classList.remove('open'); incomingInvite = null;
    return current;
  }
  requiredElement<HTMLButtonElement>('#invite-accept').addEventListener('click', () => {
    const current = settleIncoming();
    if (!current || current.expiresAt <= Date.now() || current.scene !== game.getScene() || !game.canInteract(current.from)) return;
    clearPendingInvite();
    room.sendInteractAccept(current.from, current.requestId);
    if (current.kind === 'nuzzle') game.startNuzzle(current.from, current);
    else game.acceptCosleep(current.from);
  });
  requiredElement<HTMLButtonElement>('#invite-decline').addEventListener('click', () => {
    const current = settleIncoming();
    if (current) room.sendInteractDecline(current.from, current.requestId);
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

  try {
    const [own, players] = await Promise.all([fetchOwnState(identity.id), fetchPlayers()]);
    for (const player of players) bedMembers.add(player.id);
    game.assignBeds([...bedMembers].sort());
    syncBag(own.flowers); game.restoreHeadFlower(own.headFlower);
  } catch (error) { failedSave(error); }
  void room.connect();
  window.addEventListener('pagehide', () => {
    stopHeartbeat?.();
    writeLeave(identity, game.getSnapshot());
    void room.disconnect();
    game.destroy();
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
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
