import type { DreamScript } from "../../../src/shared/pack";

export const m9Script: DreamScript = {
  id: "m9-wardrobe",
  roomId: "m9-shkaf",
  onEnter(host) {
    host.setFlag("m9.t", 0);
    host.setFlag("m9.stage", 0);
  },
  onUpdate(host, dt) {
    const t = Number(host.getFlag("m9.t") ?? 0) + dt;
    host.setFlag("m9.t", t);
    const stage = Number(host.getFlag("m9.stage") ?? 0);
    if (stage < 1 && t >= 6) {
      host.setFlag("m9.stage", 1);
      host.whisper("Дверца шкафа открывается чуть шире.");
    }
    if (stage < 2 && t >= 16) {
      host.setFlag("m9.stage", 2);
      host.whisper("Ещё шире. Надпись читается целиком.");
    }
  },
};
