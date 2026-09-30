import { randomAppearance } from './cats';
import { fetchPlayers } from './persistence';
import type { Appearance, Identity } from './types';

const STORAGE_KEY = 'meow.identity';
const DEVICE_KEY = 'meow.device';

// 设备标识：同一身份（同一只猫）可能同时登在多台设备上，
// presence 通道用 playerId:deviceTag 作 key 避免互相顶掉。
export function deviceTag(): string {
  let tag = localStorage.getItem(DEVICE_KEY);
  if (!tag) {
    tag = Math.random().toString(36).slice(2, 8);
    localStorage.setItem(DEVICE_KEY, tag);
  }
  return tag;
}

export function roomSecretOk(): boolean {
  const secret = import.meta.env.VITE_ROOM_SECRET as string | undefined;
  if (!secret) return true;
  return location.hash.replace(/^#/, '').replace(/^k=/, '') === secret;
}

export function loadIdentity(): Identity | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as Identity;
  if (!value.id || !value.name || !value.appearance) return null;
  return value;
}

export function ensureIdentity(): Promise<Identity> {
  const stored = loadIdentity();
  if (stored) return Promise.resolve(stored);

  const panel = document.querySelector<HTMLDivElement>('#identity-panel');
  if (!panel) return Promise.resolve(fallbackIdentity());

  return new Promise((resolve) => {
    let appearance = randomAppearance();
    const preview = panel.querySelector<HTMLCanvasElement>('#identity-preview')!;
    const label = panel.querySelector<HTMLSpanElement>('#identity-label')!;
    const nameInput = panel.querySelector<HTMLInputElement>('#identity-name')!;

    const adopt = (identity: Identity) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      panel.classList.remove('open');
      resolve(identity);
    };

    const render = () => {
      label.textContent = `${appearance.coat} · ${appearance.breed}`;
      drawPreviewCat(preview, appearance);
    };
    panel.querySelector<HTMLButtonElement>('#identity-reroll')!.addEventListener('click', () => {
      appearance = randomAppearance(appearance);
      render();
    });
    panel.querySelector<HTMLButtonElement>('#identity-confirm')!.addEventListener('click', () => {
      const name = nameInput.value.trim() || '无名猫';
      adopt({ id: crypto.randomUUID(), name: name.slice(0, 12), appearance });
    });

    // 多设备认领：列出房间里已登记的猫，点"这是我"直接继承同一只猫的身份，
    // 避免每台设备都变出一只新猫。离线（无 Supabase）时此区为空，只能新建。
    const existingBox = panel.querySelector<HTMLDivElement>('#identity-existing');
    if (existingBox) {
      void fetchPlayers().then((players) => {
        if (players.length === 0) return;
        const title = document.createElement('p');
        title.className = 'identity-existing-title';
        title.textContent = '院子里已经有这些猫——换设备的话点「这是我」认领回来：';
        existingBox.appendChild(title);
        for (const player of players) {
          const row = document.createElement('div');
          row.className = 'identity-existing-row';
          const swatch = document.createElement('i');
          swatch.style.background = player.appearance.colors[0];
          const info = document.createElement('span');
          const days = Math.floor((Date.now() - new Date(player.lastSeen).getTime()) / 86_400_000);
          info.textContent = `${player.name} · ${player.appearance.coat}${player.appearance.breed} · ${days <= 0 ? '今天来过' : `${days} 天前来过`}`;
          const claim = document.createElement('button');
          claim.type = 'button';
          claim.textContent = '这是我';
          claim.addEventListener('click', () => adopt({ id: player.id, name: player.name, appearance: player.appearance }));
          row.append(swatch, info, claim);
          existingBox.appendChild(row);
        }
      });
    }

    render();
    panel.classList.add('open');
    nameInput.focus();
  });
}

export function saveIdentity(identity: Identity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function resetIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function fallbackIdentity(): Identity {
  const identity: Identity = { id: crypto.randomUUID(), name: '无名猫', appearance: randomAppearance() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

function drawPreviewCat(canvas: HTMLCanvasElement, appearance: Appearance): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [base, light, dark] = appearance.colors;
  const s = canvas.width / 48;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s));
  };
  rect(11, 26, 26, 14, base);
  rect(12, 12, 24, 17, base);
  rect(13, 6, 8, 8, dark);
  rect(27, 6, 8, 8, dark);
  rect(15, 10, 3, 3, '#d99b9a');
  rect(30, 10, 3, 3, '#d99b9a');
  rect(17, 22, 14, 10, light);
  rect(17, 17, 14, 7, light);
  rect(18, 18, 3, 4, '#29332b');
  rect(28, 18, 3, 4, '#29332b');
  rect(23, 22, 3, 2, '#b7676d');
  rect(14, 38, 7, 5, dark);
  rect(28, 38, 7, 5, dark);
}
