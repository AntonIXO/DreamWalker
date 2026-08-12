import type { DreamArtifact, PaletteRole } from "../../shared/dream";

export interface LobbyColors {
  ink: number;
  paper: number;
  floor: number;
  floorAlt: number;
  wall: number;
  wallFace: number;
  metal: number;
  rust: number;
  linen: number;
  skin: number;
  screen: number;
  screenDim: number;
  blood: number;
  accent: number;
}

function parseHex(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}

function color(
  artifact: DreamArtifact,
  role: PaletteRole,
  fallback: number,
): number {
  const index = artifact.palette.roles[role];
  const hex = artifact.palette.colors[index];
  return hex ? parseHex(hex) : fallback;
}

/** Pulls lobby furniture colours from the dream palette so the room matches the tiles. */
export function lobbyColors(artifact: DreamArtifact): LobbyColors {
  return {
    ink: color(artifact, "wallEdge", 0x050331),
    paper: color(artifact, "highlight", 0xf3f6f6),
    floor: color(artifact, "highlight", 0xf3f6f6),
    floorAlt: color(artifact, "doorOpen", 0x93a2c3),
    wall: color(artifact, "figure", 0xc79d70),
    wallFace: color(artifact, "player", 0x9dd2f2),
    metal: color(artifact, "wall", 0x756948),
    rust: color(artifact, "floorShadow", 0x461503),
    linen: color(artifact, "figure", 0xc79d70),
    skin: color(artifact, "highlight", 0xf3f6f6),
    screen: color(artifact, "wallFace", 0x3492d7),
    screenDim: color(artifact, "doorSealed", 0x27326b),
    blood: color(artifact, "floorAlt", 0xa32a65),
    accent: color(artifact, "accent", 0xa32a65),
  };
}
