/**
 * The seam where the sleeping mind will go.
 *
 * §1 of the concept: the antagonist is not a director of the world, it is the patient
 * whose dream this is — awake enough to feel a stranger in it and to defend itself. Two
 * things follow, and they are the two halves of this interface:
 *
 *   turn()   — a figure of the dream answers you, and lets slip that it noticed
 *              something specific about how you asked (§3).
 *   mutate() — between conversations, the dream rearranges itself around what you have
 *              been doing (§5, §6).
 *
 * Nothing here mentions a model. `ScriptedMind` satisfies the whole contract offline,
 * which is what lets the heartbeat be tuned before a single call is ever made.
 */

import type {
  CycleExitResult,
  DialogueResult,
  DreamMemory,
  ExamineResult,
  FinaleResult,
} from "../../shared/ai";
import type { Observation } from "./observation";

/**
 * §2 — the one immutable line, written by the Lord before play. The player never gets
 * the plaintext and neither does the runtime: only the hash ships, so a finale judge can
 * check an answer without the answer having been sitting in the browser all along.
 */
export interface SealedSecret {
  hash: string;
}

/**
 * What gave you away, quoted back.
 *
 * §3 is emphatic that suspicion must be *legible*, not fair: the worst failure this game
 * can have is a player who gets caught and never learns what caught them. So a tell is
 * never a number and never a meter — it is the figure reacting to a specific thing you
 * said, with the thing you said attached.
 */
export type { Tell } from "../../shared/ai";

export interface TurnRequest {
  figureId: string;
  utterance: string;
  offeredMemoryId?: string | null;
}

export type TurnResponse = DialogueResult;

export interface ExamineRequest {
  x: number;
  y: number;
  roomId: string | null;
}

export interface MindContext {
  /** Rooms the player has been in, doors they leaned on — see `observation.ts`. */
  observe(): Observation;
}

export interface DreamMind {
  readonly name: string;
  readonly waiting: boolean;

  /** A figure of the dream answers. */
  turn(
    request: TurnRequest,
    onPartial?: (reply: string) => void,
  ): Promise<TurnResponse>;

  /** The safe information channel: things cannot suspect the sanitar. */
  examine(request: ExamineRequest): Promise<ExamineResult>;

  /**
   * The heartbeat. Returns what the dream would like to change about itself; the caller
   * decides what is allowed and applies it through `game/patch.ts`.
   */
  mutate(observation: Observation): Promise<CycleExitResult>;

  judge(diagnosis: string): Promise<FinaleResult>;
  availableMemories(): readonly DreamMemory[];
  forgetFigures(): void;
  abort(): void;
}
