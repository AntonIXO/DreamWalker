/**
 * Author-editable content for one dream.
 *
 * Rooms carry their own geometry and prose from format 4 on (`shared/room.ts`); what is
 * left here is everything about the *people* — who they are, how they look at four
 * levels of suspicion, and the sealed half of the phrase they are guarding.
 *
 * Keeping it separate from the engine is the point: a Lord adds final writing and PNGs
 * by editing `dreams/<slug>/content/**`, and never touches code.
 */

/**
 * The four portrait states, which are also the four rungs of the suspicion ladder in
 * `dream-walker-new/characters/README.md`:
 *
 *   0 занят собой · 1 заинтересовался · 2 насторожился · 3 знает
 *
 * The model returns the level, the UI shows the face. Level 3 never rolls back, and it
 * is the most important asset in the game — «не злой, а вежливый и не моргающий».
 */
export type PortraitState = "neutral" | "interested" | "wary" | "knows";

export const PORTRAIT_STATES: readonly PortraitState[] = [
  "neutral",
  "interested",
  "wary",
  "knows",
];

/** Atlas frame names. Always present, because they are the fallback that cannot fail. */
export interface PortraitFrames {
  neutral: string;
  interested: string;
  wary: string;
  knows: string;
}

/**
 * Loose 128×128 PNGs under `assets/`, once the art exists.
 *
 * They cannot live in the atlas: every atlas frame is 16×16 and the sheet is an indexed
 * 16-colour PNG (`tools/lord/art/atlas.ts`). A face at 16×16 is the placeholder these
 * are replacing, so portraits ride the same loose-PNG path as clue art and are drawn as
 * a DOM background rather than through Pixi.
 */
export type PortraitImages = Partial<Record<PortraitState, string | null>>;

/**
 * A generated walk sheet: one PNG, `dirs.length` rows by `frames` columns.
 *
 * Retro Diffusion's four-angle walk comes back 48×48 in a 4×4 grid, which is both too
 * big for the atlas and a different direction order from ours — so the sheet ships whole
 * and the renderer slices it. `dirs` records the order that was *measured* from the
 * sheet, never assumed.
 */
export interface SpriteSheetRef {
  /** Relative to the published dream, e.g. `assets/sprites/kirill.png`. */
  path: string;
  frameW: number;
  frameH: number;
  /** Row order, top to bottom. */
  dirs: string[];
  /** Columns per row. Two are used; more are kept so the choice can be revisited. */
  frames: number;
  /** Where the feet sit in the frame, 0..1. A 48px sprite does not anchor like a 16px one. */
  anchorY: number;
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
  portraitImages?: PortraitImages | null;
  spriteSheet?: SpriteSheetRef | null;
  /**
   * Path to this figure's `SOUL.md`, relative to `dreams/<slug>/content/`.
   *
   * The soul itself is **never published**. `dream.json` is served at
   * `/dream/dream.json`, and a soul carries the figure's ПАЛЕВО section — exactly what
   * gives the sanitar away. Shipping it would hand the player a cheat sheet. The server
   * reads it from disk, the way it already reads `secret.local.txt`.
   */
  soulPath?: string | null;
  /**
   * What can be held over this figure, as an opaque key.
   *
   * Only the key ships. `dream.json` is served to the browser, and the *content* of
   * somebody's leverage is an answer to a puzzle exactly the way ПАЛЕВО is — so the
   * prose lives in the soul, which the server reads from disk and never publishes.
   * Null for anybody with nothing to hold: the killer's «ВРЁТ ПРО» is «ничего», so
   * `press` is simply never offered on him, which is the right kind of exception —
   * it falls out of the material rather than being written down as a special case.
   */
  leverageId?: string | null;
  /**
   * Whether suspicion is one-way. True everywhere except the Eye, whose scale is
   * replaced by «сколько правды санитар сказал».
   */
  suspicionMonotone?: boolean;
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
  clues: ClueDefinition[];
  mnemonic: MnemonicCommitment;
}

export function fallbackPortraits(archetypeId: string): PortraitFrames {
  const frame = `figure_${archetypeId}_s_0`;
  return { neutral: frame, interested: frame, wary: frame, knows: frame };
}

/** The rung a state sits on, so a rise can be compared and never walked back. */
export function portraitRank(state: PortraitState): number {
  return PORTRAIT_STATES.indexOf(state);
}

/** Suspicion is a ratchet: «уровень 3 не откатывается». */
export function highestPortraitState(
  a: PortraitState,
  b: PortraitState,
): PortraitState {
  return portraitRank(b) > portraitRank(a) ? b : a;
}
