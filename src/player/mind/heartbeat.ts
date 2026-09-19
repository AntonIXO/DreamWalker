/**
 * The sleeper thinks only when a cycle ends (§5). It produces a plan from the outgoing
 * cycle; the caller restores the artifact and then applies that plan to the next cycle.
 * `B` keeps a live forced beat for debugging, but there is no wall-clock model timer.
 */

import type { CycleExitResult } from "../../shared/ai";
import type { HeartbeatConfig } from "../../shared/dream";
import { rectsOverlap, type TileRect } from "../../shared/rect";
import { isStreetWorld, originX, originY } from "../../shared/street";
import { executeWorldAction } from "../../shared/world-action-engine";
import type { ExecuteWorldAction } from "../../shared/world-reaction";
import {
  applyPatch,
  patchTouches,
  type MapPatch,
  type PatchResult,
  type PatchScope,
} from "../game/patch";
import type { WorldState } from "../game/world";
import type { ObservationLog } from "./observation";
import type { DreamMind } from "./types";

/**
 * What the sanitar can actually see: the room they stand in, and the tiles on screen.
 *
 * §6's rule is that the dream never rearranges what the player is looking at. Naming only
 * the room was right while a room was exactly one screen, and wrong the moment a floor is
 * six screens across — it would forbid the sleeper from touching anything on the floor
 * you are standing on, which is nearly the whole dream.
 *
 * Read *after* the model's await — a turn takes seconds and the sanitar keeps walking.
 */
export type ViewportSource = () => { roomId: string; rect: TileRect };

export interface BeatEntry {
  at: number;
  patch: MapPatch;
  result: PatchResult;
  withheld?: string;
}

export interface BeatOutcome {
  entries: BeatEntry[];
  affectedRooms: string[];
  notes: string[];
}

export type BeatListener = (outcome: BeatOutcome) => void;

const EMPTY_PLAN: CycleExitResult = { patches: [], sleeperSummary: "" };

export class Heartbeat {
  private callsThisCycle = 0;
  private running = false;
  private generation = 0;
  readonly log: BeatEntry[] = [];
  private readonly listeners: BeatListener[] = [];

  constructor(
    private readonly world: WorldState,
    private readonly mind: DreamMind,
    private readonly observations: ObservationLog,
    private readonly config: HeartbeatConfig,
    private readonly viewport: ViewportSource,
    private readonly execute: ExecuteWorldAction = executeWorldAction,
  ) {}

  onBeat(listener: BeatListener): void {
    this.listeners.push(listener);
  }

  get budgetRemaining(): number {
    return Math.max(0, this.config.callBudgetPerCycle - this.callsThisCycle);
  }

  /** Background direction shares the existing budget, reserving the final call for exit. */
  trySpendBackgroundCall(): boolean {
    if (this.running || this.budgetRemaining <= 1) return false;
    this.callsThisCycle++;
    return true;
  }

  /** Ask the sleeper what the freshly reset next cycle should look like. */
  async planCycleExit(): Promise<CycleExitResult> {
    if (this.running || this.budgetRemaining <= 0) return EMPTY_PLAN;
    this.running = true;
    const generation = this.generation;
    this.callsThisCycle++;
    this.observations.noteBeat();
    try {
      const plan = await this.mind.mutate(
        this.observations.snapshot(this.world),
      );
      return generation === this.generation ? plan : EMPTY_PLAN;
    } finally {
      if (generation === this.generation) this.running = false;
    }
  }

  /** Apply an exit plan after `resetWorld`, when nothing is visible yet. */
  applyCyclePlan(plan: CycleExitResult): BeatOutcome {
    return this.apply(plan.patches, false);
  }

  /** Debug-only live beat. It still refuses patches touching the visible viewport. */
  async force(): Promise<BeatOutcome> {
    if (this.running || this.budgetRemaining <= 1) {
      return { entries: [], affectedRooms: [], notes: [] };
    }
    this.running = true;
    const generation = this.generation;
    this.callsThisCycle++;
    this.observations.noteBeat();
    try {
      const plan = await this.mind.mutate(
        this.observations.snapshot(this.world),
      );
      if (generation !== this.generation)
        return { entries: [], affectedRooms: [], notes: [] };
      return this.apply(plan.patches, true);
    } finally {
      if (generation === this.generation) this.running = false;
    }
  }

  snapshot(): number {
    return this.callsThisCycle;
  }

  restore(calls: number): void {
    this.callsThisCycle = calls;
  }

  resetCycle(): void {
    this.generation++;
    this.running = false;
    this.callsThisCycle = 0;
  }

  private apply(
    patches: readonly MapPatch[],
    protectViewport: boolean,
  ): BeatOutcome {
    const observation = this.observations.snapshot(this.world);
    const view = this.viewport();
    const entries: BeatEntry[] = [];
    const affected = new Set<string>();
    const notes: string[] = [];
    let applied = 0;

    for (const patch of patches) {
      if (applied >= this.config.maxPatchesPerBeat) {
        entries.push({
          at: observation.elapsedSeconds,
          patch,
          result: { ok: false, affectedRooms: [] },
          withheld: "over the cycle-exit patch limit",
        });
        continue;
      }

      const touched = patchTouches(patch, this.world);
      const seen = touched.some((scope) =>
        scopeIsOnScreen(scope, view, this.world),
      );
      // Viewport/patchTouches is a pre-dispatch guard. Do not weaken it.
      if (protectViewport && seen) {
        entries.push({
          at: observation.elapsedSeconds,
          patch,
          result: { ok: false, affectedRooms: [] },
          withheld: "the player can see that",
        });
        continue;
      }

      const result = applyPatch(this.world, patch, 1, {
        source: "sleeper",
        execute: this.execute,
      });
      entries.push({ at: observation.elapsedSeconds, patch, result });
      if (!result.ok) continue;
      applied++;
      for (const roomId of result.affectedRooms) affected.add(roomId);
      if (result.note) notes.push(result.note);
    }

    this.log.push(...entries);
    const outcome = { entries, affectedRooms: [...affected], notes };
    if (applied > 0) {
      for (const listener of this.listeners) listener(outcome);
    }
    return outcome;
  }
}

export function scopeIsOnScreen(
  scope: PatchScope,
  view: { roomId: string; rect: TileRect },
  world: WorldState,
): boolean {
  const room = world.roomById.get(scope.roomId);
  if (!room) return false;
  if (!isStreetWorld(world.rooms)) {
    return (
      scope.roomId === view.roomId &&
      (scope.rect === null || rectsOverlap(scope.rect, view.rect))
    );
  }
  const ox = originX(room);
  const oy = originY(room);
  const rect =
    scope.rect === null
      ? { x: ox, y: oy, w: room.width, h: room.height }
      : {
          x: scope.rect.x + ox,
          y: scope.rect.y + oy,
          w: scope.rect.w,
          h: scope.rect.h,
        };
  return rectsOverlap(rect, view.rect);
}
