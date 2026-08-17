import type { DreamScript } from "../../../src/shared/pack";
import { KURT_THRESHOLD } from "../../../src/player/game/exhaustion";

export const kurtScript: DreamScript = {
  id: "kurt-guest",
  onEnter(host) {
    settleKurt(host);
  },
  onMemorySpent(host) {
    settleKurt(host);
  },
  onCycleReset(host) {
    host.setFlag("kurt.indifference", 0);
    settleKurt(host);
  },
  onApproach(host, figureId) {
    if (figureId !== "kurt") return;
    if (host.getFlag("kurt.dismissed") === true) return false;
  },
  onUpdate(host) {
    if (host.getFlag("kurt.dismissed") === true) host.hideFigure("kurt");
  },
};

function settleKurt(host: Parameters<NonNullable<DreamScript["onEnter"]>>[0]) {
  if (host.getFlag("kurt.dismissed") === true) {
    host.hideFigure("kurt");
    return;
  }
  const place = !host.currentRoomId.startsWith("m");
  if (host.exhaustion >= KURT_THRESHOLD && place) {
    host.showFigure("kurt", host.currentRoomId);
    return;
  }
  host.hideFigure("kurt");
}
