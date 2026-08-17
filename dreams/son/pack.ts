import {
  DREAM_FORMAT_VERSION,
  validateDreamArtifact,
  type DreamArtifact,
} from "../../src/shared/dream";
import type { DreamPack, DreamScript } from "../../src/shared/pack";
import { CLUES } from "./clues";
import { allCharacters } from "./figures/cards";
import { allFigures } from "./figures/roster";
import {
  CYCLE,
  GENRE,
  HEARTBEAT,
  MNEMONIC,
  PALETTE,
  SECRET_HASH,
  SHARDS,
  SLUG,
  STYLE,
  STYLE_WORDS,
  TITLE,
} from "./meta";
import { allRooms } from "./rooms/catalog";
import { kurtScript } from "./scripts/kurt";
import { m5Script } from "./scripts/m5";
import { m6Script } from "./scripts/m6";
import { m7Script } from "./scripts/m7";
import { m8Script } from "./scripts/m8";
import { m11Script } from "./scripts/m11";
import { m12Script } from "./scripts/m12";
import { raisaScript } from "./scripts/raisa";
import { riftScript } from "./scripts/rifts";
import { visitScript } from "./scripts/visits";
import { NPCS } from "./npcs";

const SCRIPTS: DreamScript[] = [
  visitScript,
  riftScript,
  kurtScript,
  raisaScript,
  m5Script,
  m6Script,
  m7Script,
  m8Script,
  m11Script,
  m12Script,
];

let cached: DreamArtifact | null = null;

export function sonArtifact(): DreamArtifact {
  if (cached) return cached;
  cached = validateDreamArtifact({
    format: DREAM_FORMAT_VERSION,
    slug: SLUG,
    title: TITLE,
    genreContract: GENRE,
    styleWords: [...STYLE_WORDS],
    secretHash: SECRET_HASH,
    shards: SHARDS,
    palette: PALETTE,
    style: STYLE,
    rooms: allRooms(),
    spawn: {
      roomId: "19-dvor-i-oranzhevye-lavochki",
      entryId: "default",
    },
    finaleRoomId: "01-otel-goticheskii-holl",
    figures: allFigures(),
    content: {
      characters: allCharacters(),
      clues: CLUES,
      mnemonic: MNEMONIC,
    },
    cycle: CYCLE,
    heartbeat: HEARTBEAT,
    atlas: "atlas.json",
    authoredAt: "2026-08-17T00:00:00.000Z",
  });
  return cached;
}

export const sonPack: DreamPack = {
  artifact: sonArtifact,
  scripts: SCRIPTS,
  npcs: NPCS,
};
