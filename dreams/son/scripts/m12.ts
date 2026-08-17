import type { DreamScript } from "../../../src/shared/pack";

export const m12Script: DreamScript = {
  id: "m12-call",
  roomId: "m12-nedoliudi",
  onEnter(host) {
    host.setFlag("m12.t", 0);
    host.setFlag("m12.left", 12);
  },
  onUpdate(host, dt) {
    const t = Number(host.getFlag("m12.t") ?? 0) + dt;
    host.setFlag("m12.t", t);
    const left = Math.max(0, 12 - Math.floor(t / 3));
    if (left !== Number(host.getFlag("m12.left") ?? 12)) {
      host.setFlag("m12.left", left);
      if (left === 1) host.whisper("Остался твой квадрат.");
      if (left === 0) {
        host.whisper("И он тоже гаснет.");
        const back = String(
          host.getFlag("returnTo") ?? "19-dvor-i-oranzhevye-lavochki",
        );
        host.enterRoom(back, "default", "meta-exit");
      }
    }
  },
};
