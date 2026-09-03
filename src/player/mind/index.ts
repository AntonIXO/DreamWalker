/**
 * Which mind is playing the sleeper.
 *
 * One function, so the game only ever holds a `DreamMind` and never learns whether there
 * is a model behind it. Heartbeat, examine and the finale may fall back to
 * `ScriptedMind` when inference drops. Dialogue does not: a figure's voice is its
 * soul.md through the model, not a canned line standing in for a missing reply.
 *
 * The concept assumes BYOK either way (§ "ключ приносит игрок") — the key belongs to
 * whoever is playing, and a dream costs its Lord nothing to run.
 */

import type { WorldState } from "../game/world";
import { MindMemory } from "./memory";
import { RemoteMind, type RemoteMindContext } from "./remote";
import { ScriptedMind } from "./scripted";
import type { DreamMind } from "./types";

export function createMind(
  world: WorldState,
  context: RemoteMindContext,
  memory = new MindMemory(world.artifact.slug),
): DreamMind {
  const scripted = new ScriptedMind(world, memory);
  return new RemoteMind(world, memory, context, scripted);
}

/** A cycle reset clears figure transcripts; the sleeper's summary survives (§5). */
export function forgetCycle(mind: DreamMind): void {
  mind.forgetFigures();
}

export type { DreamMind } from "./types";
