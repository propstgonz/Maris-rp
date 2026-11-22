import { connectEventSource } from './liveUpdates';

interface PlayerLiveEvent { text?: string | null; action?: string | null }

export function initPlayerLive(onEvent: (text: string, action?: string) => void) {
  connectEventSource<PlayerLiveEvent>('/api/game/events', data => {
    if (data.text) onEvent(data.text, data.action ?? undefined);
  });
}
