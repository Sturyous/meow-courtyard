import './style.css';
import { CourtyardGame } from './game';
import { RealtimeRoom } from './realtime';
import type { ChatMessage, PublicActivity } from './types';

const canvas = requiredElement<HTMLCanvasElement>('#game');
const messages = requiredElement<HTMLDivElement>('#messages');
const form = requiredElement<HTMLFormElement>('#chat-form');
const input = requiredElement<HTMLInputElement>('#chat-input');
const status = requiredElement<HTMLDivElement>('#connection-status');

const playerId = crypto.randomUUID();
let room: RealtimeRoom;
const game = new CourtyardGame(canvas, playerId, {
  onMovement: (player) => room?.sendMovement(player),
  onActivity: (player) => room?.sendActivity(player),
  onAppearance: (player) => {
    room?.sendAppearance(player);
    toast(`变成了${player.appearance.coat}${player.appearance.breed}`);
  },
});

room = new RealtimeRoom(playerId, {
  getLocalPlayer: () => game.getSnapshot(),
  onPlayer: (player, sequence) => game.addOrUpdateRemote(player, sequence),
  onPlayerLeave: (id) => game.removeRemote(id),
  onPresenceSync: (ids) => game.retainRemotes(ids),
  onChat: addMessage,
  onStatus: (state, label) => {
    status.dataset.state = state;
    const labelNode = status.querySelector('span');
    if (labelNode) labelNode.textContent = label;
  },
});

document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach((button) => {
  button.addEventListener('click', () => {
    const activity = button.dataset.activity as PublicActivity;
    document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach((node) => {
      node.classList.remove('active');
      node.setAttribute('aria-pressed', 'false');
    });
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    game.setActivity(activity);
    canvas.focus();
  });
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(event.key)) return;
  document.querySelectorAll<HTMLButtonElement>('[data-activity]').forEach((node) => {
    node.classList.remove('active');
    node.setAttribute('aria-pressed', 'false');
  });
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const player = game.getSnapshot();
  const message: ChatMessage = { id: crypto.randomUUID(), playerId, name: player.name, text: text.slice(0, 160), sentAt: Date.now(), local: true };
  addMessage(message);
  room.sendChat(player.name, message.text);
  input.value = '';
});

document.querySelector('#chat-toggle')?.addEventListener('click', () => document.querySelector('#chat-panel')?.classList.toggle('collapsed'));

function addMessage(message: ChatMessage): void {
  const row = document.createElement('div');
  row.className = `message${message.local ? ' mine' : ''}`;
  const author = document.createElement('strong');
  author.textContent = message.local ? '你' : '喵喵';
  const body = document.createElement('span');
  body.textContent = message.text;
  row.append(author, body);
  messages.append(row);
  while (messages.childElementCount > 40) messages.firstElementChild?.remove();
  messages.scrollTop = messages.scrollHeight;
}

function toast(text: string): void {
  const hint = document.querySelector<HTMLDivElement>('#hint');
  if (!hint) return;
  const original = '方向键 / WASD 移动 · 右键小猫换装';
  hint.textContent = text;
  hint.classList.add('pop');
  window.setTimeout(() => { hint.textContent = original; hint.classList.remove('pop'); }, 1800);
}

void room.connect();
window.addEventListener('pagehide', () => { void room.disconnect(); game.destroy(); });

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素：${selector}`);
  return element;
}
