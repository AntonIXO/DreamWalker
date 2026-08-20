import type { DreamScript } from "../../../src/shared/pack";

export const riftScript: DreamScript = {
  id: "exhaustion-rifts",
  onCycleReset() {
    // Rifts used to steal a doorway into a meta-space. The street map does not.
  },
  onMemorySpent() {
    // Same: exhaustion no longer rewires geography.
  },
};
