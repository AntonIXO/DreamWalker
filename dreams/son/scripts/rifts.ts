import {
  META_IDS,
  metaInjectionChance,
} from "../../../src/player/game/exhaustion";
import { makeRng } from "../../../src/shared/rng";
import type { DreamScript, ScriptHost } from "../../../src/shared/pack";
import { RIFT_IDS } from "../rooms/rifts";

function retargetOne(host: ScriptHost, seed: string): string | null {
  const dests = META_IDS.filter((id) => id !== host.currentRoomId);
  const doorId = makeRng(seed).maybePick(RIFT_IDS);
  const toRoomId = makeRng(`${seed}:dest`).maybePick(dests);
  if (!doorId || !toRoomId) return null;
  host.retargetRift(doorId, toRoomId);
  return doorId;
}

export const riftScript: DreamScript = {
  id: "exhaustion-rifts",
  onCycleReset(host) {
    const rng = makeRng(`rifts:${host.cycleNumber}`);
    if (!rng.chance(metaInjectionChance(host.exhaustion))) return;
    retargetOne(host, `rifts:${host.cycleNumber}:door`);
  },
  onMemorySpent(host) {
    // Spending a memory always steals one doorway. Chance would let a player
    // pay and see nothing move, which reads as the cost not landing.
    retargetOne(host, `rifts:memory:${host.cycleNumber}:${host.exhaustion}`);
  },
};
