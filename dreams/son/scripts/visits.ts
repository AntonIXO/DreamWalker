import type { DreamScript } from "../../../src/shared/pack";
import { ROOM_EXHAUSTION } from "../../../src/player/game/exhaustion";

export const visitScript: DreamScript = {
  id: "room-exhaustion",
  onEnter(host) {
    const cost = ROOM_EXHAUSTION[host.currentRoomId];
    if (!cost) return;
    const key = `exh.${host.currentRoomId}`;
    if (host.getFlag(key) === true) return;
    host.setFlag(key, true);
    host.addExhaustion(cost);
  },
};
