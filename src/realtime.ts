import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, ROOM_ID } from './supabase';
import { deviceTag } from './identity';
import type { ChatMessage, DecorItem, DuetKind, Emote, GardenPlot, NoteData, PlayerSnapshot, PresenceMember, RoomEvent } from './types';

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

interface RoomCallbacks {
  getLocalPlayer: () => PlayerSnapshot;
  onPlayer: (player: PlayerSnapshot, sequence?: number) => void;
  onPlayerLeave: (id: string) => void;
  onPresenceSync: (members: PresenceMember[]) => void;
  onPartnerTz: (tz: string) => void;
  onChat: (message: ChatMessage) => void;
  onStatus: (state: 'online' | 'offline' | 'connecting', label: string) => void;
  onReady: () => void;
  onNotePlaced: (note: NoteData) => void;
  onNoteOpened: (noteId: string) => void;
  onInteractInvite: (from: string, fromName: string, kind: DuetKind) => void;
  onInteractAccept: (from: string, kind: DuetKind) => void;
  onInteractDecline: (from: string, kind: DuetKind) => void;
  onEmote: (playerId: string, emote: Emote) => void;
  onGardenUpdated: (plot: GardenPlot) => void;
  onDecorPlaced: (decor: DecorItem) => void;
  onDecorRemoved: (decorId: string) => void;
}

export class RealtimeRoom {  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private sequence = 0;
  private joinedAt = '';
  private readonly playerId: string;

  constructor(playerId: string, private readonly callbacks: RoomCallbacks) {
    this.playerId = playerId;
  }

  async connect(): Promise<void> {
    this.client = getSupabase();
    if (!this.client) {
      this.callbacks.onStatus('offline', '单猫离线模式');
      this.callbacks.onReady();
      return;
    }

    this.callbacks.onStatus('connecting', '正在走进庭院…');
    this.channel = this.client.channel(`courtyard:${ROOM_ID}`, {
      config: { presence: { key: `${this.playerId}:${deviceTag()}` }, broadcast: { self: false, ack: false } },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => this.syncPresence())
      .on('presence', { event: 'leave' }, ({ key: leavingKey }) => this.handlePresenceLeave(String(leavingKey)))
      .on('broadcast', { event: 'room-event' }, ({ payload }) => this.receive(payload))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.callbacks.onStatus('online', '庭院已连接');
          await this.channel?.track({ player: this.callbacks.getLocalPlayer(), joinedAt: new Date().toISOString(), tz: localTimeZone() });
          this.callbacks.onReady();
          this.send({ type: 'snapshot-request', requesterId: this.playerId });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.callbacks.onStatus('offline', '连接不稳，正在重试');
        } else if (status === 'CLOSED') {
          this.callbacks.onStatus('offline', '已离开庭院');
        }
      });
  }

  getJoinedAt(): string {
    return this.joinedAt;
  }

  sendMovement(player: PlayerSnapshot): void {
    this.send({ type: 'move', player, sequence: ++this.sequence });
  }

  sendActivity(player: PlayerSnapshot): void { this.send({ type: 'activity', player }); }
  sendAppearance(player: PlayerSnapshot): void { this.send({ type: 'appearance', player }); }
  sendNotePlaced(note: NoteData): void { this.send({ type: 'note-placed', note }); }
  sendNoteOpened(noteId: string): void { this.send({ type: 'note-opened', noteId }); }
  sendEmote(emote: Emote): void { this.send({ type: 'emote', playerId: this.playerId, emote }); }
  sendGardenUpdated(plot: GardenPlot): void { this.send({ type: 'garden-updated', plot }); }
  sendDecorPlaced(decor: DecorItem): void { this.send({ type: 'decor-placed', decor }); }
  sendDecorRemoved(decorId: string): void { this.send({ type: 'decor-removed', decorId }); }

  sendInteractInvite(to: string, fromName: string, kind: DuetKind): void {
    this.send({ type: 'interact-invite', from: this.playerId, fromName, to, kind });
  }

  sendInteractAccept(to: string, kind: DuetKind): void {
    this.send({ type: 'interact-accept', from: this.playerId, to, kind });
  }

  sendInteractDecline(to: string, kind: DuetKind): void {
    this.send({ type: 'interact-decline', from: this.playerId, to, kind });
  }

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
    const members: PresenceMember[] = [];
    const seen = new Set<string>();
    for (const [key, entries] of Object.entries(state)) {
      if (key === this.playerId || key.startsWith(`${this.playerId}:`)) continue;
      const first = entries[0] as { player?: PlayerSnapshot; joinedAt?: string; tz?: string } | undefined;
      if (!first?.player) continue;
      if (seen.has(first.player.id)) continue; // 同一只猫的多台设备只算一个成员
      seen.add(first.player.id);
      members.push({ id: first.player.id, joinedAt: first.joinedAt ?? '' });
      if (typeof first.tz === 'string' && first.tz) this.callbacks.onPartnerTz(first.tz);
      this.callbacks.onPlayer(first.player);
    }
    this.callbacks.onPresenceSync(members);
    this.send({ type: 'snapshot-request', requesterId: this.playerId });
  }

  // presence key 形如 playerId:deviceTag；同一只猫还有其他设备在线时不算离开
  private handlePresenceLeave(leavingKey: string): void {
    const playerId = leavingKey.split(':')[0]!;
    if (!this.channel) {
      this.callbacks.onPlayerLeave(playerId);
      return;
    }
    const state = this.channel.presenceState<Record<string, unknown>>();
    for (const key of Object.keys(state)) {
      if (key === playerId || key.startsWith(`${playerId}:`)) return;
    }
    this.callbacks.onPlayerLeave(playerId);
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
      this.callbacks.onChat({ id: crypto.randomUUID(), playerId: event.playerId, name: event.name, text: event.text.slice(0, 160), sentAt: Number(event.sentAt) || Date.now() });
      return;
    }
    if (event.type === 'note-placed' && event.note && event.note.authorId !== this.playerId) {
      this.callbacks.onNotePlaced(event.note);
      return;
    }
    if (event.type === 'note-opened' && typeof event.noteId === 'string') {
      this.callbacks.onNoteOpened(event.noteId);
      return;
    }
    if (event.type === 'interact-invite' && event.to === this.playerId && typeof event.from === 'string') {
      this.callbacks.onInteractInvite(event.from, String(event.fromName ?? '喵喵'), event.kind as DuetKind);
      return;
    }
    if (event.type === 'interact-accept' && event.to === this.playerId && typeof event.from === 'string') {
      this.callbacks.onInteractAccept(event.from, event.kind as DuetKind);
      return;
    }
    if (event.type === 'interact-decline' && event.to === this.playerId && typeof event.from === 'string') {
      this.callbacks.onInteractDecline(event.from, event.kind as DuetKind);
      return;
    }
    if (event.type === 'emote' && typeof event.playerId === 'string' && event.playerId !== this.playerId && event.emote) {
      this.callbacks.onEmote(event.playerId, event.emote as Emote);
      return;
    }
    if (event.type === 'garden-updated' && event.plot) {
      this.callbacks.onGardenUpdated(event.plot as GardenPlot);
      return;
    }
    if (event.type === 'decor-placed' && event.decor) {
      this.callbacks.onDecorPlaced(event.decor as DecorItem);
      return;
    }
    if (event.type === 'decor-removed' && typeof event.decorId === 'string') {
      this.callbacks.onDecorRemoved(event.decorId);
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
