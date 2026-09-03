import type { DreamScript } from "../../../src/shared/pack";

const DOORS = 8;
const EXHAUST_EVERY = 20;
const FORCE_EXIT_AFTER = 40;
const DOOR_COST = 0.05;

function exitIndex(clueIds: readonly string[]): number | null {
  if (clueIds.length < 3) return null;
  const key = [...clueIds].sort().join(",");
  let hash = 0;
  for (let i = 0; i < key.length; i++)
    hash = (hash * 33 + key.charCodeAt(i)) | 0;
  return Math.abs(hash) % DOORS;
}

export const m8Script: DreamScript = {
  id: "m8-days",
  onEnter(host) {
    if (host.currentRoomId === "m8-den") {
      const opened = Number(host.getFlag("m8.opened") ?? 0) + 1;
      host.setFlag("m8.opened", opened);
      if (opened > 0 && opened % EXHAUST_EVERY === 0) {
        host.addExhaustion(DOOR_COST);
        host.whisper("Ещё двадцать дверей. Комната та же.");
      }
      if (opened >= FORCE_EXIT_AFTER) {
        const back = String(
          host.getFlag("returnTo") ?? "19-dvor-i-oranzhevye-lavochki",
        );
        host.enterRoom(back, "default", "meta-exit");
      }
      return;
    }
    if (host.currentRoomId !== "m8-5854") return;
    const index = exitIndex(host.knownClueIds());
    host.setFlag("m8.exit", index ?? -1);
    if (index === null) return;
    host.retargetRift(`m8-5854--day-${index}`, "19-dvor-i-oranzhevye-lavochki");
  },
};
