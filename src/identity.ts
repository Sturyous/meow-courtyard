import { randomAppearance } from './cats';
import type { Appearance, Identity } from './types';

const STORAGE_KEY = 'meow.identity';

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
      const identity: Identity = { id: crypto.randomUUID(), name: name.slice(0, 12), appearance };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      panel.classList.remove('open');
      resolve(identity);
    });

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
