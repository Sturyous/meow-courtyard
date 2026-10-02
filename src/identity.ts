import { drawIdentityPreview } from './cat-sprites';
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
      drawIdentityPreview(preview, appearance);
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
