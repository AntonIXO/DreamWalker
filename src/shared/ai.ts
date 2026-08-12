import type { MapPatch } from "./map-patch";

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

export interface WorldSnapshot {
  rooms: Array<{ id: string; name: string; kind: "room" | "connector" }>;
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
  }>;
}

export interface DialogueRequestPayload {
  slug: string;
  cycleNumber: number;
  figureId: string;
  utterance: string;
  offeredMemory: DreamMemory | null;
  history: FigureTranscriptLine[];
  knownShardIds: string[];
  sleeper: SleeperMemory;
  world: WorldSnapshot;
}

export interface Tell {
  quoted: string;
  voiced: string;
}

export interface DialogueResult {
  reply: string;
  tell: Tell | null;
  yieldedShardId: string | null;
  residueDelta: string[];
  memoryEffect: {
    memoryId: string;
    accepted: boolean;
    voiced: string;
  } | null;
  resonance: { declaration: string } | null;
}

export interface ExamineRequestPayload {
  slug: string;
  cycleNumber: number;
  roomId: string | null;
  x: number;
  y: number;
  knownShardIds: string[];
  world: WorldSnapshot;
}

export interface ExamineResult {
  reply: string;
  yieldedShardId: string | null;
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
  diagnosis: string;
  knownShardIds: string[];
  journal: string[];
}

export interface FinaleResult {
  verdict: "match" | "near" | "miss";
  reply: string;
  reveal?: string;
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
