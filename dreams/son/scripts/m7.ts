import type { DreamScript } from "../../../src/shared/pack";

const ORDER = ["zametki", "shemy", "monitor", "stol"] as const;
const INTERVAL = 2.4;

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
    host.closeHotspot(hotspot.id);
    host.removeProp(hotspot.id);
    host.whisper("Одно. Больше не успеешь.");
    return true;
  },
  onUpdate(host, dt) {
    const t = Number(host.getFlag("m7.t") ?? 0) + dt;
    host.setFlag("m7.t", t);
    const next = Number(host.getFlag("m7.next") ?? 0);
    if (next < ORDER.length && t >= (next + 1) * INTERVAL) {
      const id = ORDER[next]!;
      host.closeHotspot(id);
      host.removeProp(id);
      host.setFlag("m7.next", next + 1);
    }
    if (next >= ORDER.length && t >= (ORDER.length + 1) * INTERVAL) {
      const back = String(
        host.getFlag("returnTo") ?? "19-dvor-i-oranzhevye-lavochki",
      );
      host.enterRoom(back, "default", "meta-exit");
    }
  },
};
