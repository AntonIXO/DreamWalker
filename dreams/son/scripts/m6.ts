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
  /**
   * `resetWorld` restores the authored doors, so the way back is sealed again every
   * cycle. The flag saying it was already opened has to go with it, or the second cycle
   * finds `m6.unlocked` set, never calls `openDoor`, and the pond keeps the sanitar for
   * good. `m6.fails` deliberately stays: the two circles were already walked.
   */
  onCycleReset(host) {
    host.setFlag("m6.unlocked", false);
  },
  /**
   * A figure can be seated on the shore slot. Talking would skip the two failed
   * approaches; refusing talk makes E fall through to the hotspot, and clears the
   * leftover sentence so «Ну ладно.» is not sitting next to a typed question.
   */
  onApproach() {
    return false;
  },
};
