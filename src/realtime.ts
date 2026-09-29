import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { ChatMessage, PlayerSnapshot, RoomEvent } from './types';

interface RoomCallbacks {
  getLocalPlayer: () => PlayerSnapshot;
  onPlayer: (player: PlayerSnapshot, sequence?: number) => void;
  onPlayerLeave: (id: string) => void;
  onPresenceSync: (ids: Set<string>) => void;
  onChat: (message: ChatMessage) => void;
  onStatus: (state: 'online' | 'offline' | 'connecting', label: string) => void;
}

export class RealtimeRoom {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private sequence = 0;
  private readonly playerId: string;

  constructor(playerId: string, private readonly callbacks: RoomCallbacks) {
    this.playerId = playerId;
  }

  async connect(): Promise<void> {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    const roomId = (import.meta.env.VITE_ROOM_ID as string | undefined) || 'mossbell-courtyard';
    if (!url || !key) {
      this.callbacks.onStatus('offline', '单猫离线模式');
      return;
    }

    this.callbacks.onStatus('connecting', '正在走进庭院…');
    this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    this.channel = this.client.channel(`courtyard:${roomId}`, {
      config: { presence: { key: this.playerId }, broadcast: { self: false, ack: false } },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => this.syncPresence())
      .on('presence', { event: 'leave' }, ({ key: leavingKey }) => this.callbacks.onPlayerLeave(String(leavingKey)))
      .on('broadcast', { event: 'room-event' }, ({ payload }) => this.receive(payload))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.callbacks.onStatus('online', '庭院已连接');
          await this.channel?.track({ player: this.callbacks.getLocalPlayer(), joinedAt: new Date().toISOString() });
          this.send({ type: 'snapshot-request', requesterId: this.playerId });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.callbacks.onStatus('offline', '连接不稳，正在重试');
        } else if (status === 'CLOSED') {
          this.callbacks.onStatus('offline', '已离开庭院');
        }
      });
  }

  sendMovement(player: PlayerSnapshot): void {
    this.send({ type: 'move', player, sequence: ++this.sequence });
  }

  sendActivity(player: PlayerSnapshot): void { this.send({ type: 'activity', player }); }
  sendAppearance(player: PlayerSnapshot): void { this.send({ type: 'appearance', player }); }

  sendChat(name: string, text: string): void {
    this.send({ type: 'chat', playerId: this.playerId, name, text: text.slice(0, 160), sentAt: Date.now() });
  }

  async disconnect(): Promise<void> {
    if (!this.channel || !this.client) return;
    await this.channel.untrack().catch(() => undefined);
    await this.client.removeChannel(this.channel).catch(() => undefined);
  }

  private syncPresence(): void {
    if (!this.channel) return;
    const state = this.channel.presenceState<Record<string, unknown>>();
    const activeIds = new Set<string>();
    for (const [key, entries] of Object.entries(state)) {
      if (key === this.playerId) continue;
      const first = entries[0] as { player?: PlayerSnapshot } | undefined;
      if (!first?.player) continue;
      activeIds.add(first.player.id);
      this.callbacks.onPlayer(first.player);
    }
    this.callbacks.onPresenceSync(activeIds);
    this.send({ type: 'snapshot-request', requesterId: this.playerId });
  }

  private receive(value: unknown): void {
    const event = value as Partial<RoomEvent>;
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'snapshot-request') {
      if (event.requesterId !== this.playerId) this.send({ type: 'snapshot-response', player: this.callbacks.getLocalPlayer() });
      return;
    }
    if (event.type === 'chat') {
      if (typeof event.playerId !== 'string' || event.playerId === this.playerId || typeof event.text !== 'string' || typeof event.name !== 'string') return;
      this.callbacks.onChat({ id: crypto.randomUUID(), playerId: event.playerId, name: '喵喵', text: event.text.slice(0, 160), sentAt: Number(event.sentAt) || Date.now() });
      return;
    }
    if ('player' in event && event.player && event.player.id !== this.playerId) {
      this.callbacks.onPlayer(event.player, event.type === 'move' ? Number(event.sequence) || 0 : undefined);
    }
  }

  private send(event: RoomEvent): void {
    if (!this.channel) return;
    void this.channel.send({ type: 'broadcast', event: 'room-event', payload: event });
  }
}
