/**
 * What the sanitar did to people, and what survives a cycle of it.
 *
 * `resetWorld` rebuilds `world.figures` from `baseFigures`, which resurrects everybody —
 * that is the point of it, since figures are supposed to forget the conversation (§5).
 * A fate must not be forgotten, so it cannot live on `FigureState`. It lives beside
 * `visitCounts`, the other thing on `WorldState` that is deliberately never cleared,
 * for the same reason: the dream repeats and the sanitar is what remembers.
 *
 * `fateHistory` is not bookkeeping. `glaz/SOUL.md` says under ПАМЯТЬ, in as many words,
 * «Помнит, кого санитар убил и сколько раз.» The Eye is the one who reads this.
 */

import { RETURNS_WHOLE, type FigureFate, type Verb } from "../../shared/verbs";
import type { InterestState, WorldState } from "./world";

export interface FateRecord {
  figureId: string;
  fate: FigureFate;
  /** 1-based, as the HUD counts them. */
  cycle: number;
  roomId: string;
  by: Verb;
  /**
   * What they were carrying, and where it ended up.
   *
   * `resetWorld` rebuilds `world.interests` from the population snapshot, so remains
   * dropped mid-cycle are wiped by the next reset — and then the hook is gone from the
   * world entirely, which is the exact brick «судьба не стирает слово» exists to
   * prevent. Keeping the interest on the record lets the ledger put it back *where it
   * fell*, rather than re-deriving a position that would not match.
   */
  remains: InterestState | null;
  /**
   * The sanitar's own words, when there were any.
   *
   * §3 already quotes the player back at themselves for a tell; a figure reacting to
   * what was done to somebody else should be able to do the same. Null for a kill,
   * which is the one act in this game with no words at all.
   */
  quoted: string | null;
}

export function fateOf(world: WorldState, figureId: string): FigureFate {
  return world.fates.get(figureId)?.fate ?? "present";
}

export function isPresent(world: WorldState, figureId: string): boolean {
  const fate = fateOf(world, figureId);
  return fate !== "dead" && fate !== "gone";
}

/** Who is following right now, if anyone. At most one, by `availableVerbs`. */
export function whoIsLed(world: WorldState): string | null {
  for (const [figureId, record] of world.fates) {
    if (record.fate === "led") return figureId;
  }
  return null;
}

export function setFate(world: WorldState, record: FateRecord): void {
  world.fates.set(record.figureId, record);
  world.fateHistory.push(record);
}

export function leverageOn(
  world: WorldState,
  figureId: string,
): readonly string[] {
  return [...(world.leverage.get(figureId) ?? [])];
}

export function learnLeverage(
  world: WorldState,
  figureId: string,
  leverageId: string,
): boolean {
  const held = world.leverage.get(figureId) ?? new Set<string>();
  if (held.has(leverageId)) return false;
  held.add(leverageId);
  world.leverage.set(figureId, held);
  return true;
}

/**
 * Lay the ledger back over a freshly reset world.
 *
 * Called from `resetWorld` immediately after the figures are rebuilt, and it is the
 * whole of what makes a fate outlive a cycle. Four things, in order:
 *
 *   1. Кирилл comes back. «Вернётся в следующей комнате целым и не помнящим» — so the
 *      *record* is dropped and the history entry is kept. Nothing about him shows it,
 *      which is exactly why saying it out loud gives the sanitar away instantly.
 *   2. The dead and the abandoned are spliced out. `walkerView` destroys sprites for ids
 *      that leave the list, so the despawn is free.
 *   3. Anyone being led is downgraded to `gone`. You cannot still be walking somebody
 *      across a reset; they are wherever you left them.
 *   4. Whatever a dead or broken figure was carrying stays findable — see `patch.ts`.
 */
export function applyFateLedger(world: WorldState, cycle: number): void {
  for (const [figureId, record] of [...world.fates]) {
    if (record.fate === "dead" && RETURNS_WHOLE.has(figureId)) {
      world.fates.delete(figureId);
      continue;
    }
    if (record.fate === "led") {
      world.fates.set(figureId, { ...record, fate: "gone", cycle });
    }
  }

  for (let i = world.figures.length - 1; i >= 0; i--) {
    if (!isPresent(world, world.figures[i]!.id)) world.figures.splice(i, 1);
  }

  // 4. Put back what the dead and the broken were carrying. Without this the reset
  //    quietly deletes a word, which is the one thing a fate is not allowed to do.
  for (const record of world.fates.values()) {
    if (!record.remains) continue;
    if (
      world.interests.some((interest) => interest.id === record.remains!.id)
    ) {
      continue;
    }
    world.interests.push({ ...record.remains });
  }
}
