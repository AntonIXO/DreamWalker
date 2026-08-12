/**
 * Which mind is playing the sleeper.
 *
 * One function, so the game only ever holds a `DreamMind` and never learns whether there
 * is a model behind it. `ScriptedMind` is not a placeholder to be replaced: with a key
 * configured it becomes the fallback the model falls back *to*, per call, so a dropped
 * connection costs a duller answer rather than a broken dream.
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
): DreamMind {
  const scripted = new ScriptedMind(world);
  return new RemoteMind(
    world,
    new MindMemory(world.artifact.slug),
    context,
    scripted,
  );
}

/** A cycle reset clears figure transcripts; the sleeper's summary survives (§5). */
export function forgetCycle(mind: DreamMind): void {
  mind.forgetFigures();
}

export type { DreamMind } from "./types";
