import './style.css';
import { CourtyardGame } from './game';
import { RealtimeRoom } from './realtime';
import { clockLabel, setTimeMode, type TimeMode } from './daynight';
import { ensureIdentity, roomSecretOk, saveIdentity } from './identity';
import {
  deletePlayer,
  fetchGhosts,
  fetchOpenNotes,
  fetchRecap,
  insertNote,
  markNoteOpened,
  recordPresence,
  startHeartbeat,
  upsertPlayer,
  writeLeave,
} from './persistence';
import { emotes, type ChatMessage, type DuetKind, type Identity, type NoteData, type NoteKind, type PublicActivity, type SceneId } from './types';

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
      toast(scene === 'cabin' ? '壁炉烧得正旺' : '回到院子里');
    },
  });

  // ---- 场景切换（进屋 / 回院子） ----
  const sceneButton = requiredElement<HTMLButtonElement>('#scene-toggle');
  function renderSceneButton(scene: SceneId): void {
    sceneButton.innerHTML = scene === 'yard' ? '<span>⌂</span>进屋' : '<span>⌂</span>回院子';
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
  });

  async function afterJoin(): Promise<void> {
    void recordPresence(identity.id, 'join');
    void upsertPlayer(identity, game.getSnapshot());
    startHeartbeat(identity, () => game.getSnapshot());
    const [ghosts, notes, recap] = await Promise.all([fetchGhosts(identity.id), fetchOpenNotes(), fetchRecap(identity.id)]);
    game.setGhosts(ghosts);
    game.setNotes(notes);
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
  requiredElement<HTMLButtonElement>('#note-button').addEventListener('click', () => {
    composer.classList.add('open');
    noteText.value = '';
    noteText.focus();
  });
  requiredElement<HTMLButtonElement>('#note-cancel').addEventListener('click', () => composer.classList.remove('open'));

  const beginPlacement = (kind: NoteKind) => {
    const text = kind === 'treat' ? '给你留了小鱼干' : noteText.value.trim().slice(0, 200);
    if (!text) return;
    pendingNote = { kind, text };
    composer.classList.remove('open');
    setHint(game.getScene() === 'cabin' ? '点击屋里地面放下 · 右键取消' : '点击庭院放下 · 右键取消');
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
    setHint(HINT_DEFAULT);
  });

  async function placeNote(draft: { kind: NoteKind; text: string }, x: number, y: number): Promise<void> {
    const scene = game.getScene();
    const saved = await insertNote(identity, draft.kind, draft.text, x, y, scene);
    const note: NoteData = saved ?? {
      id: crypto.randomUUID(),
      authorId: identity.id,
      authorName: identity.name,
      kind: draft.kind,
      text: draft.text,
      x,
      y,
      scene,
      createdAt: new Date().toISOString(),
      openedAt: null,
    };
    game.addNote(note);
    myNoteIds.add(note.id);
    room.sendNotePlaced(note);
    toast(draft.kind === 'treat' ? '小鱼干放好了' : '纸条钉好了');
  }

  // ---- 拆纸条 ----
  const noteCard = requiredElement<HTMLDivElement>('#note-card');
  function openNoteCard(note: NoteData): void {
    requiredElement<HTMLDivElement>('#note-card-text').textContent = note.text;
    requiredElement<HTMLDivElement>('#note-card-author').textContent = note.authorId === identity.id ? '你留的' : `${note.authorName} 留的`;
    noteCard.classList.add('open');
    if (note.authorId === identity.id) return;
    game.removeNote(note.id);
    void markNoteOpened(note.id);
    room.sendNoteOpened(note.id);
    if (note.kind === 'treat') game.showEmote(identity.id, 'fish');
  }
  requiredElement<HTMLButtonElement>('#note-card-close').addEventListener('click', () => noteCard.classList.remove('open'));

  // ---- 双人互动 / 右键菜单 ----
  const menu = requiredElement<HTMLDivElement>('#context-menu');
  let menuTarget: string | null = null;

  const MENU_BUTTONS = ['#menu-nuzzle', '#menu-cosleep', '#menu-reroll', '#menu-bed', '#menu-poke', '#menu-dismiss'];
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
    showMenuButtons(['#menu-reroll', '#menu-bed']);
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
    const activityLabel: Record<string, string> = { sleep: '睡觉', study: '学习', eat: '吃饭', play: '玩耍', toilet: '上厕所', idle: '发呆', walk: '溜达' };
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
