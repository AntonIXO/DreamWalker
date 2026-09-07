import type { DreamScript } from "../../../src/shared/pack";
import type { WorldReactionHost } from "../../../src/shared/world-reaction";

const ORDER = ["zametki", "shemy", "monitor", "stol"] as const;
const INTERVAL_START = 2.4;
const INTERVAL_END = 0.6;

function delayFor(index: number): number {
  if (ORDER.length <= 1) return INTERVAL_START;
  const t = index / (ORDER.length - 1);
  return INTERVAL_START + (INTERVAL_END - INTERVAL_START) * t;
}

function thresholdFor(index: number): number {
  let total = 0;
  for (let i = 0; i <= index; i++) total += delayFor(i);
  return total;
}

function erase(host: WorldReactionHost, id: string): void {
  host.dispatch({ type: "take", objectId: id });
}

export const m7Script: DreamScript = {
  id: "m7-erase",
  roomId: "m7-rm-rf",
  onEnter(host) {
    host.setFlag("m7.t", 0);
    host.setFlag("m7.next", 0);
    host.setFlag("m7.grabbed", false);
  },
  onUse(host, hotspot) {
    const next = Number(host.getFlag("m7.next") ?? 0);
    const gone = new Set(ORDER.slice(0, next));
    if (gone.has(hotspot.id as (typeof ORDER)[number])) return true;
    if (host.getFlag("m7.grabbed") === true) return false;
    host.setFlag("m7.grabbed", true);
    host.setFlag("m7.taken", hotspot.id);
    if (hotspot.clueId) host.observeClue(hotspot.clueId);
    erase(host, hotspot.id);
    host.whisper("Одно. Больше не успеешь.");
    return true;
  },
  onWorldEvent(host, event) {
    if (event.type !== "object.used") return;
    const id = event.objectId;
    if (!ORDER.includes(id as (typeof ORDER)[number])) return;
    const next = Number(host.getFlag("m7.next") ?? 0);
    const gone = new Set(ORDER.slice(0, next));
    if (gone.has(id as (typeof ORDER)[number])) return;
    if (host.getFlag("m7.grabbed") === true) return;
    host.setFlag("m7.grabbed", true);
    host.setFlag("m7.taken", id);
    erase(host, id);
  },
  onUpdate(host, dt) {
    const t = Number(host.getFlag("m7.t") ?? 0) + dt;
    host.setFlag("m7.t", t);
    let next = Number(host.getFlag("m7.next") ?? 0);
    while (next < ORDER.length && t >= thresholdFor(next)) {
      const id = ORDER[next]!;
      erase(host, id);
      next += 1;
      host.setFlag("m7.next", next);
    }
    if (
      next >= ORDER.length &&
      t >= thresholdFor(ORDER.length - 1) + INTERVAL_END
    ) {
      const back = String(
        host.getFlag("returnTo") ?? "19-dvor-i-oranzhevye-lavochki",
      );
      host.enterRoom(back, "default", "meta-exit");
    }
  },
};
