import type { DreamScript } from "../../../src/shared/pack";
import { POND_FAIL_COST } from "../../../src/player/game/exhaustion";

export const m6Script: DreamScript = {
  id: "m6-pond",
  roomId: "m6-krugi-vokrug-pruda",
  onUse(host, hotspot) {
    if (hotspot.id !== "figura-na-beregu") return false;
    const fails = Number(host.getFlag("m6.fails") ?? 0);
    if (fails < 2) {
      host.setFlag("m6.fails", fails + 1);
      host.addExhaustion(POND_FAIL_COST);
      host.placePlayer("default");
      host.whisper("Ну ладно.");
      return true;
    }
    host.setFlag("m6.open", true);
    return false;
  },
  onUpdate(host) {
    if (host.getFlag("m6.open") !== true) return;
    if (host.getFlag("m6.unlocked") === true) return;
    host.setFlag("m6.unlocked", true);
    host.openDoor("m6-krugi-vokrug-pruda--exit");
  },
};
