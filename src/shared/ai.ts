import type { MapPatch } from "./map-patch";
import type { PortraitState } from "./content";
import type { FigureFate, Verb } from "./verbs";
import type { SupportedLocale } from "./i18n";

/** The one Codex configuration this game is designed and tuned against. */
export const DREAM_MODEL = "gpt-5.6-luna";
export const DREAM_REASONING_EFFORT = "xhigh" as const;

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexAccountStatus {
  provider: "codex" | "anthropic" | "openai";
  state:
    "disconnected" | "authorizing" | "connected" | "incompatible" | "error";
  email: string | null;
  planType: string | null;
  model: string;
  effort: string;
  modelAvailable: boolean;
  effortAvailable: boolean;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  message: string | null;
}

export interface DeviceLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface DreamMemory {
  id: string;
  text: string;
  origin: "self" | "foreign";
  spent: boolean;
  signature: string | null;
}

export interface SleeperMemory {
  summary: string;
  tells: Array<{
    cycle: number;
    figureId: string;
    quoted: string;
  }>;
}

export interface FigureTranscriptLine {
  speaker: "sanitar" | "figure";
  text: string;
}

export type AgendaPhase = "early" | "middle" | "late";

export interface FigureAgenda {
  phase: AgendaPhase;
  roomId: string;
  activity: string;
}

/** Model-authored character notes. They describe the fiction, never game rules. */
export interface FigureProfile {
  id: string;
  name: string;
  archetypeId: string;
  homeRoomId: string;
  role: string;
  personality: string;
  voice: string;
  desire: string;
  fear: string;
  taboo: string;
  holdsShardId: string | null;
  agenda: FigureAgenda[];
}

/** A safe, slow source of information placed into the generated world. */
export interface InterestSeed {
  id: string;
  roomId: string;
  name: string;
  sensorySeed: string;
  solid: boolean;
  holdsShardId: string | null;
  /** A semantic picture puzzle. The target word is never part of the artifact. */
  clueId: string | null;
}

export interface PopulationRetarget {
  doorId: string;
  toRoomId: string;
}

/**
 * Which place is behind which door this run.
 *
 * The dream is 29 authored rooms and no generator (§3), but «жёсткий рез без перехода»
 * is the corpus's own grammar and the sleeper is supposed to deal the catalogue anew
 * each time. This is that deal, and it is deliberately the *content* that moves, never
 * the geometry: walls, doors, stairs and slots stay exactly where a person drew them, so
 * a reshuffle cannot make the dream uncrossable no matter what the model returns. That
 * is what buys generativity without a solvability solver §6 refuses to have.
 */
export interface RoomAssignment {
  /** The physical room — its mask, doors and slots. */
  roomId: string;
  /** Whose place it is this time: the id of the room whose writing and things it wears. */
  cardId: string;
}

export interface DreamPopulation {
  figures: FigureProfile[];
  interests: InterestSeed[];
  roomMoods: Record<string, string>;
  /**
   * How this run rewires the rifts. Empty means the authored bindings stand. The sleeper
   * composes a new deal each inhabit; cycle-exit may add more later.
   */
  retargets: PopulationRetarget[];
  /**
   * How the places were dealt onto the rooms. Empty means everything is where it was
   * authored, which is what a training run and a failed inhabit both give you.
   */
  assignments: RoomAssignment[];
  source: "ai" | "fallback";
}

export interface InhabitRequestPayload {
  slug: string;
  /** Skip the model and return a shuffled catalog deal immediately. */
  fallback?: boolean;
  locale?: SupportedLocale;
}

export interface FigureMemory {
  summary: string;
  lines: FigureTranscriptLine[];
}

export interface WorldSnapshot {
  rooms: Array<{
    id: string;
    name: string;
    kind: "place" | "meta";
    personality: string | null;
    /**
     * How often the sanitar has been here, across cycles. §4.3 — «второй визит хуже
     * первого». Handing the count to the sleeper lets it write its own escalation
     * instead of the engine hard-coding one.
     */
    visitCount: number;
    tags: string[];
  }>;
  doors: Array<{
    id: string;
    type: string;
    fromRoomId: string;
    toRoomId: string;
  }>;
  figures: Array<{
    id: string;
    name: string;
    roomId: string;
    holdsShardId: string | null;
    role: string;
    personality: string;
    activity: string;
    /**
     * What the sanitar did to them, if anything.
     *
     * This list holds people who are **not in the world any more**, which is the whole
     * point: a dead figure is spliced out of `world.figures`, so without this nobody
     * could mention that they are gone — and «его нет там, где он был» is the line every
     * other figure has to be able to say.
     */
    fate: FigureFate;
    fateCycle: number | null;
    fateRoomId: string | null;
    /** The sanitar's own words at the time, for a figure to quote back. */
    fateQuoted: string | null;
  }>;
  interests: Array<{
    id: string;
    name: string;
    roomId: string;
    sensorySeed: string;
    holdsShardId: string | null;
    clueId: string | null;
  }>;
  /**
   * Everything the sanitar has ever done here, oldest first.
   *
   * Filtered per recipient before it is sent — see `remote.ts`. Кирилл never appears in
   * it for anybody but the Eye.
   */
  fateHistory: Array<{
    figureId: string;
    figureName: string;
    fate: FigureFate;
    cycle: number;
    roomId: string;
  }>;
  /** Which corner of the chart the sanitar is currently in. Sets the register, not the plot. */
  mood: "upper-dynamic" | "upper-static" | "downer-dynamic" | "downer-static";
}

export interface DialogueRequestPayload {
  slug: string;
  cycleNumber: number;
  figureId: string;
  utterance: string;
  /** What the sanitar is holding over this person, when he chose to use it. */
  leverageOffered: string | null;
  offeredMemory: DreamMemory | null;
  figureMemory: FigureMemory;
  knownShardIds: string[];
  sleeper: SleeperMemory;
  world: WorldSnapshot;
  /** 0..1. High exhaustion is camouflage. The engine also clamps the face. */
  exhaustion: number;
  locale?: SupportedLocale;
}

export interface Tell {
  quoted: string;
}

export interface DialogueResult {
  reply: string;
  /** Stage direction. Shown smaller than the spoken line. */
  action?: string | null;
  tell: Tell | null;
  yieldedShardId: string | null;
  residueDelta: string[];
  memoryEffect: {
    memoryId: string;
    accepted: boolean;
  } | null;
  resonance: { declaration: string } | null;
  figureMemorySummary: string;
  journalEntry: string | null;
  portraitState: PortraitState;
  /**
   * Something said about **somebody else** that can be held over them.
   *
   * §2's economy is «осмотр мира — медленный и безопасный канал, а люди — быстрый и
   * рискованный», and this is where it is protected: the main source of leverage is
   * `examine`, so the heaviest verb in the game is paid for by *looking at things*
   * rather than by aggression. A figure never hands over its own noose — the server
   * clamps that next to the `yieldedShardId` clamp.
   */
  leverageLearned: { aboutFigureId: string; leverageId: string } | null;
  /**
   * What being pressed did to them, when they were.
   *
   * `leveraged` — gave up what they had and talks differently after. `broken` — «уходит
   * в обиду и замолкает», and never speaks again. Null when nothing was pressed.
   */
  pressed: "leveraged" | "broken" | null;
}

export interface ExamineRequestPayload {
  slug: string;
  cycleNumber: number;
  roomId: string | null;
  interestId: string | null;
  /** Authored hotspot id, when the sanitar is looking at a bible object. */
  hotspotId: string | null;
  x: number;
  y: number;
  knownShardIds: string[];
  world: WorldSnapshot;
  locale?: SupportedLocale;
}

export interface ExamineResult {
  reply: string;
  yieldedShardId: string | null;
  clueObservedId: string | null;
  /**
   * Something the thing gives away about a person.
   *
   * This is the important half of leverage, not a convenience. §2 makes looking at the
   * world the slow, safe channel and talking to people the fast, dangerous one; putting
   * the main source of blackmail material on the *safe* channel means the heaviest verb
   * in the game is paid for by patience rather than by pressure, and the concept's
   * central trade survives a feature that could easily have destroyed it.
   */
  leverageLearned: { aboutFigureId: string; leverageId: string } | null;
}

export interface CycleExitRequestPayload {
  slug: string;
  cycleNumber: number;
  observation: AiObservation;
  knownShardIds: string[];
  sleeper: SleeperMemory;
  transcripts: Record<string, FigureTranscriptLine[]>;
  world: WorldSnapshot;
  locale?: SupportedLocale;
}

export interface AiObservation {
  elapsedSeconds: number;
  currentRoomId: string | null;
  visitedRoomIds: string[];
  dwell: Record<string, number>;
  refusedDoors: Record<string, number>;
  approachedFigures: Record<string, number>;
  learnedShardIds: string[];
  beatsThisCycle: number;
  /**
   * Figure id -> what the sanitar did to them this cycle.
   *
   * Cycle-exit answers this with the deal: move somebody who remembers onto his road,
   * take the witness out of the room. It is what makes killing cost something beyond
   * the person.
   */
  fatesThisCycle: Record<string, Verb>;
}

export interface CycleExitResult {
  patches: MapPatch[];
  sleeperSummary: string;
}

export interface FinaleRequestPayload {
  slug: string;
  words: string[];
  locale?: SupportedLocale;
}

export interface FinaleResult {
  /**
   * Whether there was anything in it. Only ever set on a match, and decided when the
   * dream was made — never rolled at the finale, or the loss reads as the game cheating
   * rather than as the risk it was.
   */
  wallet?: "full" | "dry";
  /** Layer 2: the phrase is right and the lock has not opened yet. */
  locked?: boolean;
  /** Fake prize. Never sent on walk-away. */
  amount?: string;
  verdict: "match" | "miss";
  reply: string;
}

export type AiErrorCode =
  | "not_authenticated"
  | "model_unavailable"
  | "busy"
  | "rate_limited"
  | "invalid_request"
  | "model_contract"
  | "aborted"
  | "internal";

export type AiStreamEvent<T> =
  | { type: "partial"; reply: string }
  | { type: "result"; value: T }
  | {
      type: "error";
      code: AiErrorCode;
      message: string;
      retryable: boolean;
    };
