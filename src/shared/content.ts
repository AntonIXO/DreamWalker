/**
 * Author-editable content for one dream.
 *
 * Geometry still comes from DreamMap; these records say what a room means and which
 * prepared visual/personality assets are allowed to inhabit it. Keeping them separate
 * lets a Lord add final writing and PNGs without touching the engine.
 */

export type PortraitState = "neutral" | "interested" | "wary" | "knows";

export interface PortraitFrames {
  neutral: string;
  interested: string;
  wary: string;
  knows: string;
}

export interface CharacterDefinition {
  /** Must match one authored FigurePlacement. */
  id: string;
  name: string;
  archetypeId: string;
  personality: string;
  role: string;
  voice: string;
  desire: string;
  fear: string;
  taboo: string;
  initialActivity: string;
  portraits: PortraitFrames;
}

export interface ChamberGraphics {
  /** Existing atlas role used as the dominant floor texture. */
  floorRole: string;
  /** Existing atlas role used for the room boundary. */
  wallRole: string;
  /** Existing atlas role used by safe interactive props. */
  propRole: string;
  /** Optional large authored illustration. Loaded when a future content atlas supplies it. */
  backdropFrame: string | null;
  /** Optional authored PNG relative to the published dream. */
  backdropImage?: string | null;
  glitchPreset: "none" | "split" | "double-edge" | "wrong-palette";
}

export interface ChamberAnchor {
  id: string;
  kind: "figure" | "object" | "clue";
  /** Normalised position inside the room, 0..1. */
  x: number;
  y: number;
}

export interface ChamberDefinition {
  id: string;
  name: string;
  description: string;
  atmosphere: string;
  personality: string;
  tags: string[];
  /** Existing map rooms this chamber may occupy. Empty means any room-shaped slot. */
  eligibleRoomIds: string[];
  unique: boolean;
  graphics: ChamberGraphics;
  anchors: ChamberAnchor[];
}

/** Public half of the sealed mnemonic. Nulls are the six positions the player fills. */
export interface MnemonicCommitment {
  hash: string;
  wordlist: "english";
  knownSlots: Array<string | null>;
}

export interface ClueDefinition {
  id: string;
  /** Deliberately not a noun naming the answer. */
  sensorySeed: string;
  placementTags: string[];
  worldFrame: string;
  detailFrame: string;
  /** RD outputs relative to the published dream; frames remain deliberate placeholders. */
  worldImage?: string | null;
  detailImage?: string | null;
  marker: string;
}

export interface DreamContent {
  characters: CharacterDefinition[];
  chambers: ChamberDefinition[];
  clues: ClueDefinition[];
  mnemonic: MnemonicCommitment;
  /** Number selected from the catalog at once. Must be smaller than the catalog. */
  activeChamberCount: number;
}

export function fallbackPortraits(archetypeId: string): PortraitFrames {
  const frame = `figure_${archetypeId}_s_0`;
  return { neutral: frame, interested: frame, wary: frame, knows: frame };
}
