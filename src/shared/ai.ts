import type { MapPatch } from "./map-patch";
import type { PortraitState } from "./content";

/** The one Codex configuration this game is designed and tuned against. */
export const DREAM_MODEL = "gpt-5.6-luna";
export const DREAM_REASONING_EFFORT = "xhigh" as const;

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexAccountStatus {
  provider: "codex" | "anthropic";
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

export interface DreamPopulation {
  figures: FigureProfile[];
  interests: InterestSeed[];
  roomMoods: Record<string, string>;
  source: "ai" | "fallback";
}

export interface InhabitRequestPayload {
  slug: string;
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
  }>;
  interests: Array<{
    id: string;
    name: string;
    roomId: string;
    sensorySeed: string;
    holdsShardId: string | null;
    clueId: string | null;
  }>;
  /** Which corner of the chart the sanitar is currently in. Sets the register, not the plot. */
  mood: "upper-dynamic" | "upper-static" | "downer-dynamic" | "downer-static";
}

export interface DialogueRequestPayload {
  slug: string;
  cycleNumber: number;
  figureId: string;
  utterance: string;
  offeredMemory: DreamMemory | null;
  figureMemory: FigureMemory;
  knownShardIds: string[];
  sleeper: SleeperMemory;
  world: WorldSnapshot;
}

export interface Tell {
  quoted: string;
}

export interface DialogueResult {
  reply: string;
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
}

export interface ExamineRequestPayload {
  slug: string;
  cycleNumber: number;
  roomId: string | null;
  interestId: string | null;
  x: number;
  y: number;
  knownShardIds: string[];
  world: WorldSnapshot;
}

export interface ExamineResult {
  reply: string;
  yieldedShardId: string | null;
  clueObservedId: string | null;
}

export interface CycleExitRequestPayload {
  slug: string;
  cycleNumber: number;
  observation: AiObservation;
  knownShardIds: string[];
  sleeper: SleeperMemory;
  transcripts: Record<string, FigureTranscriptLine[]>;
  world: WorldSnapshot;
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
}

export interface CycleExitResult {
  patches: MapPatch[];
  sleeperSummary: string;
}

export interface FinaleRequestPayload {
  slug: string;
  words: string[];
}

export interface FinaleResult {
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
