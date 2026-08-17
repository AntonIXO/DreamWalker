/**
 * One axis. Each spent memory, and some rooms, raise it. High exhaustion is
 * camouflage that costs the ability to use it — figures stop reading you as
 * someone with a plan, and you have almost nothing left to pay with.
 *
 * Never a HUD bar (§3). The readout is how people look at you, and how often
 * a rift drops you into a meta-space.
 */

import {
  portraitRank,
  PORTRAIT_STATES,
  type PortraitState,
} from "../../shared/content";

/** Each of the three memories is a quarter of the bar. */
export const MEMORY_EXHAUSTION = 0.25;

/** Kurt appears at this and above. */
export const KURT_THRESHOLD = 0.7;

export const ROOM_EXHAUSTION: Readonly<Record<string, number>> = {
  "m6-krugi-vokrug-pruda": 0,
  "m7-rm-rf": 0.2,
  "m8-5854": 0.05,
  "m9-shkaf": 0.12,
  "m10-zamorozhennaia-morkovka": 0.16,
  "m11-zamok-po-vremeni": 0.08,
  "m12-nedoliudi": 0.12,
};

export const POND_FAIL_COST = 0.1;
export const RAISA_RELIEF = -0.15;

export function clampExhaustion(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function exhaustionBand(
  value: number,
): "low" | "medium" | "high" | "spent" {
  if (value >= 0.99) return "spent";
  if (value >= KURT_THRESHOLD) return "high";
  if (value >= 0.35) return "medium";
  return "low";
}

/**
 * High exhaustion clamps how far a tell may raise a face. Low exhaustion lets
 * a direct question jump. The engine — not the model — decides.
 */
export function clampPortraitByExhaustion(
  exhaustion: number,
  proposed: PortraitState,
  previous: PortraitState,
): PortraitState {
  const band = exhaustionBand(exhaustion);
  const cap: PortraitState =
    band === "high" || band === "spent"
      ? "interested"
      : band === "medium"
        ? "wary"
        : "knows";
  const next = portraitRank(proposed);
  const prev = portraitRank(previous);
  const ceiling = portraitRank(cap);
  const rank = Math.min(Math.max(next, prev), Math.max(prev, ceiling));
  return PORTRAIT_STATES[rank] ?? previous;
}

/** How often a rift should be stolen by a late meta-space. 0..1. */
export const META_IDS = [
  "m5-odinochestvo",
  "m6-krugi-vokrug-pruda",
  "m7-rm-rf",
  "m8-5854",
  "m12-nedoliudi",
] as const;

export function metaInjectionChance(exhaustion: number): number {
  return clampExhaustion(exhaustion) * 0.65;
}
