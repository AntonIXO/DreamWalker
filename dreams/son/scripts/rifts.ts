import type { DreamScript } from "../../../src/shared/pack";
import {
  META_IDS,
  metaInjectionChance,
} from "../../../src/player/game/exhaustion";

const STEALABLE = [
  "19-dvor-i-oranzhevye-lavochki--rift-butylka-riadom-s-turyshevym-ne-pervaia",
  "05-shesterochka--rift-m7",
  "02-shkola-kabinet-russkogo--rift-mat-v-uglu-s-rasstelennoi-posteliu",
  "09-hakaton-tretii-po-schetu--rift-m12",
  "08-kvartira-v-kotoroi-zhivut-drugie--rift-m8",
];

export const riftScript: DreamScript = {
  id: "exhaustion-rifts",
  onCycleReset(host) {
    steal(host);
  },
  onMemorySpent(host) {
    steal(host);
  },
};

function steal(host: Parameters<NonNullable<DreamScript["onCycleReset"]>>[0]) {
  const chance = metaInjectionChance(host.exhaustion);
  if (chance <= 0) return;
  const roll = (Number(host.getFlag("rift.nonce") ?? 0) + 1) % 100;
  host.setFlag("rift.nonce", roll);
  if (roll / 100 >= chance) return;
  const door = STEALABLE[roll % STEALABLE.length];
  const dest = META_IDS[roll % META_IDS.length];
  if (!door || !dest) return;
  host.retargetRift(door, dest);
}
