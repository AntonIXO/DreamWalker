import type { DreamScript } from "../../../src/shared/pack";
import { RAISA_RELIEF } from "../../../src/player/game/exhaustion";

export const raisaScript: DreamScript = {
  id: "raisa-rest",
  onApproach(host, figureId) {
    if (figureId !== "raisa") return;
    if (host.getFlag("raisa.helped") === true) return;
    host.setFlag("raisa.helped", true);
    host.addExhaustion(RAISA_RELIEF);
    host.whisper("Садитесь. Вы не торопитесь.");
  },
  onCycleReset(host) {
    host.setFlag("raisa.helped", false);
  },
};
