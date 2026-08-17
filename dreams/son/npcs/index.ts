import type { FigureAi, FigureTalkContext } from "../../../src/shared/pack";
import { addExhaustion } from "../../../src/player/game/world";
import type { WorldState } from "../../../src/player/game/world";
import { anton } from "./anton";
import { chorus } from "./chorus";
import { glaz } from "./glaz";
import { kirill } from "./kirill";
import { kripto } from "./kripto";
import { kurt } from "./kurt";
import { lysyi } from "./lysyi";
import { mama } from "./mama";
import { raisa } from "./raisa";
import { shchenok } from "./shchenok";
import { turyshev } from "./turyshev";

const SPECIAL: FigureAi[] = [
  shchenok,
  kurt,
  raisa,
  glaz,
  kirill,
  lysyi,
  turyshev,
  kripto,
  anton,
  mama,
];

export const NPCS: Record<string, FigureAi> = Object.fromEntries(
  SPECIAL.map((npc) => [npc.id, npc]),
);

for (const id of [
  "hudozhnik",
  "papa",
  "tetya",
  "babushka-nadya",
  "dolzhniki",
  "ubiitsa",
  "liosha-gnedkov",
  "nilufar",
  "aleksei",
  "ded-slava",
]) {
  NPCS[id] = chorus(id);
}

export function npcFor(id: string): FigureAi {
  return NPCS[id] ?? chorus(id);
}

export function talkContext(
  world: WorldState,
  input: {
    figureId: string;
    utterance: string;
    offeredMemoryText?: string | null;
    leverageOffered?: string | null;
    knownClueIds?: readonly string[];
    knownShardIds?: readonly string[];
    cycle: number;
  },
): FigureTalkContext | null {
  const figure =
    world.figures.find((entry) => entry.id === input.figureId) ??
    world.baseFigures.find((entry) => entry.id === input.figureId);
  if (!figure) return null;
  const turns = Number(world.flags.get(`talk.${figure.id}`) ?? 0);
  world.flags.set(`talk.${figure.id}`, turns + 1);
  return {
    utterance: input.utterance,
    said: input.utterance.toLowerCase(),
    figureId: figure.id,
    figureName: figure.name,
    roomId: figure.roomId,
    portrait: figure.portraitState,
    holdsShardId: figure.holdsShardId,
    exhaustion: world.exhaustion,
    cycle: input.cycle,
    visitCounts: world.visitCounts,
    offeredMemoryText: input.offeredMemoryText ?? null,
    leverageOffered: input.leverageOffered ?? null,
    knownClueIds: input.knownClueIds ?? [],
    knownShardIds: input.knownShardIds ?? [],
    conversationTurns: turns,
    getFlag: (key) => world.flags.get(key),
    setFlag: (key, value) => {
      world.flags.set(key, value);
    },
    addExhaustion: (delta) => {
      addExhaustion(world, delta);
    },
  };
}
