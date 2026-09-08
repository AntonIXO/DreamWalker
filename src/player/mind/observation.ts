/**
 * What the dream noticed.
 *
 * §5: on the way out of a cycle the sleeper "spends a few calls working out what you
 * found and what gave you away, and moves its defences". This is the input to that. It
 * is deliberately behavioural — where you went, what you kept trying, who you kept
 * going back to — because that is what a mind inside its own dream would actually have
 * access to, and because it costs nothing to collect.
 *
 * It is also the whole reason the heartbeat can be interesting before any model exists:
 * `ScriptedMind` reads these numbers and gets recognisably pointed behaviour out of them.
 */

import type { Verb } from "../../shared/verbs";
import type { WorldState } from "../game/world";

export interface Observation {
  /** Seconds since the cycle began. */
  elapsedSeconds: number;
  /** Room the player is in right now. Never patched — that is the rule. */
  currentRoomId: string | null;
  /** Every room stood in this cycle. */
  visitedRoomIds: string[];
  /** Room id -> seconds spent there. Lingering is the loudest signal there is. */
  dwell: Record<string, number>;
  /** Door id -> how many times the player was refused by it. */
  refusedDoors: Record<string, number>;
  /** Figure id -> how many times the player came close enough to talk. */
  approachedFigures: Record<string, number>;
  /** Shards the player has actually been given. */
  learnedShardIds: string[];
  /** How many beats have already run this cycle, for pacing. */
  beatsThisCycle: number;
  /**
   * Figure id -> what the sanitar did to them this cycle.
   *
   * Cycle-exit reads it and answers with the deal: remove the one he keeps visiting,
   * put somebody who remembers on his road. Cleared with everything else — the *ledger*
   * on `WorldState` is what outlives a cycle, not this.
   */
  fatesThisCycle: Record<string, Verb>;
}

/**
 * Accumulates the observation as the player plays. One instance per cycle: a reset
 * throws it away, which is exactly right — the *dream* forgets between cycles, and only
 * the player's notebook does not (§5).
 */
export class ObservationLog {
  private readonly dwell = new Map<string, number>();
  private readonly refusals = new Map<string, number>();
  private readonly approaches = new Map<string, number>();
  private readonly learned = new Set<string>();
  private readonly fates = new Map<string, Verb>();
  private elapsed = 0;
  private beats = 0;
  private currentRoomId: string | null = null;

  tick(deltaSeconds: number, roomId: string | null): void {
    this.elapsed += deltaSeconds;
    this.currentRoomId = roomId;
    if (!roomId) return;
    this.dwell.set(roomId, (this.dwell.get(roomId) ?? 0) + deltaSeconds);
  }

  noteRefusal(doorId: string): void {
    this.refusals.set(doorId, (this.refusals.get(doorId) ?? 0) + 1);
  }

  noteApproach(figureId: string): void {
    this.approaches.set(figureId, (this.approaches.get(figureId) ?? 0) + 1);
  }

  noteLearned(shardId: string): void {
    this.learned.add(shardId);
  }

  noteFate(figureId: string, verb: Verb): void {
    this.fates.set(figureId, verb);
  }

  noteBeat(): void {
    this.beats++;
  }

  /** A new cycle. The dream forgets what it worked out about you; you do not (§5). */
  reset(): void {
    this.dwell.clear();
    this.refusals.clear();
    this.approaches.clear();
    this.learned.clear();
    this.fates.clear();
    this.elapsed = 0;
    this.beats = 0;
    this.currentRoomId = null;
  }

  restore(state: Observation): void {
    this.reset();
    this.elapsed = state.elapsedSeconds;
    this.beats = state.beatsThisCycle;
    this.currentRoomId = state.currentRoomId;
    for (const [id, value] of Object.entries(state.dwell))
      this.dwell.set(id, value);
    for (const [id, value] of Object.entries(state.refusedDoors))
      this.refusals.set(id, value);
    for (const [id, value] of Object.entries(state.approachedFigures))
      this.approaches.set(id, value);
    for (const [id, value] of Object.entries(state.fatesThisCycle))
      this.fates.set(id, value);
    for (const id of state.learnedShardIds) this.learned.add(id);
  }

  get learnedCount(): number {
    return this.learned.size;
  }

  snapshot(world: WorldState): Observation {
    return {
      elapsedSeconds: this.elapsed,
      currentRoomId: this.currentRoomId,
      visitedRoomIds: [...world.visited],
      dwell: Object.fromEntries(this.dwell),
      refusedDoors: Object.fromEntries(this.refusals),
      approachedFigures: Object.fromEntries(this.approaches),
      learnedShardIds: [...this.learned],
      beatsThisCycle: this.beats,
      fatesThisCycle: Object.fromEntries(this.fates),
    };
  }
}
