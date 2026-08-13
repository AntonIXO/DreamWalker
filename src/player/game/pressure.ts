/**
 * How badly it is going, as one readable number per axis.
 *
 * This replaces тонус — the Upper/Downer × Static/Dynamic chart lifted from LSD: Dream
 * Emulator, complete with its signed-byte overflow. That mechanic was beautiful and it
 * was also unreadable: every room and every object carried an authored delta, the counter
 * was hidden by design (§3, no meters), and the only way it ever surfaced was a shader
 * grade nobody could connect to anything they had done.
 *
 * What is left is the part that was doing the work — the picture souring as the dream
 * turns against you — driven by things the player already understands:
 *
 *   - `dread`  — somebody has noticed. Rises with the worst suspicion in the dream and
 *                with how late in the run it is.
 *   - `unrest` — the place will not hold still. Rises with how often the sleeper has
 *                rearranged this cycle and with how many times you have been back here.
 *
 * Both are 0..1. There is no wrap, no clamp against a floor, and nothing accumulates
 * invisibly: hand it the same world twice and it says the same thing.
 */

import { PORTRAIT_STATES, type PortraitState } from "../../shared/content";

export interface DreamPressure {
  /** 0..1 — how close the dream is to naming you. */
  dread: number;
  /** 0..1 — how much of it is moving behind your back. */
  unrest: number;
}

export const CALM: DreamPressure = { dread: 0, unrest: 0 };

/** How many beats in one cycle read as "this place will not hold still". */
const BEATS_FOR_FULL_UNREST = 3;
/** How many returns to one room before it is as bad as it gets (§4.3). */
const VISITS_FOR_FULL_UNREST = 4;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function suspicionRank(state: PortraitState): number {
  const index = PORTRAIT_STATES.indexOf(state);
  return index < 0 ? 0 : index / (PORTRAIT_STATES.length - 1);
}

export interface PressureInput {
  /** Everyone currently in the dream. Only their portrait state matters here. */
  figures: readonly { readonly portraitState: PortraitState }[];
  /** 1-based, as the HUD counts them. */
  cycleNumber: number;
  /** Null when the run is untimed, which makes lateness contribute nothing. */
  maxCycles: number | null;
  /** Heartbeats spent this cycle. */
  beats: number;
  /** How many times the sanitar has stood in this room, across cycles. */
  visitsHere: number;
}

export function computePressure(input: PressureInput): DreamPressure {
  // The worst thing anybody knows, not the average: one figure at `knows` is the whole
  // problem, and nine calm ones do not dilute it.
  const worst = input.figures.reduce(
    (high, figure) => Math.max(high, suspicionRank(figure.portraitState)),
    0,
  );
  const late =
    input.maxCycles === null || input.maxCycles <= 1
      ? 0
      : clamp01((input.cycleNumber - 1) / (input.maxCycles - 1));

  const churn = clamp01(input.beats / BEATS_FOR_FULL_UNREST);
  const worn = clamp01((input.visitsHere - 1) / (VISITS_FOR_FULL_UNREST - 1));

  return {
    // Lateness raises the floor rather than adding: a calm dream on the last cycle is
    // still tense, but nothing is as loud as somebody who has worked you out.
    dread: clamp01(Math.max(worst, late * 0.55)),
    unrest: clamp01(Math.max(churn, worn * 0.8)),
  };
}
