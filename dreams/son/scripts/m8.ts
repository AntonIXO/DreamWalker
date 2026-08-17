import type { DreamScript } from "../../../src/shared/pack";

const DOORS = 8;

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
  roomId: "m8-5854",
  onEnter(host) {
    const index = exitIndex(host.knownClueIds());
    host.setFlag("m8.exit", index ?? -1);
    if (index === null) return;
    host.retargetRift(`m8-5854--day-${index}`, "19-dvor-i-oranzhevye-lavochki");
  },
};
