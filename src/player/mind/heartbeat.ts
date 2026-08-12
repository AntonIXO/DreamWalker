/**
 * The sleeper thinks only when a cycle ends (§5). It produces a plan from the outgoing
 * cycle; the caller restores the artifact and then applies that plan to the next cycle.
 * `B` keeps a live forced beat for debugging, but there is no wall-clock model timer.
 */

import type { CycleExitResult } from "../../shared/ai";
import type { HeartbeatConfig } from "../../shared/dream";
import {
  applyPatch,
  patchTouches,
  type MapPatch,
  type PatchResult,
} from "../game/patch";
import type { WorldState } from "../game/world";
import type { ObservationLog } from "./observation";
import type { DreamMind } from "./types";

/**
 * The room the sanitar is standing in.
 *
 * §6's rule is that the dream never rearranges what the player can see. Format 3
 * approximated that with the camera's visible tile rectangle, because rooms were
 * rectangles inside one grid. With discrete rooms the rule is literal: never patch the
 * room they are in. Read *after* the model's await — a turn takes seconds and the
 * sanitar keeps walking.
 */
export type ViewportSource = () => string;

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
  readonly log: BeatEntry[] = [];
  private readonly listeners: BeatListener[] = [];

  constructor(
    private readonly world: WorldState,
    private readonly mind: DreamMind,
    private readonly observations: ObservationLog,
    private readonly config: HeartbeatConfig,
    private readonly viewport: ViewportSource,
  ) {}

  onBeat(listener: BeatListener): void {
    this.listeners.push(listener);
  }

  get budgetRemaining(): number {
    return Math.max(0, this.config.callBudgetPerCycle - this.callsThisCycle);
  }

  /** Ask the sleeper what the freshly reset next cycle should look like. */
  async planCycleExit(): Promise<CycleExitResult> {
    if (this.running || this.budgetRemaining <= 0) return EMPTY_PLAN;
    this.running = true;
    this.callsThisCycle++;
    this.observations.noteBeat();
    try {
      return await this.mind.mutate(this.observations.snapshot(this.world));
    } finally {
      this.running = false;
    }
  }

  /** Apply an exit plan after `resetWorld`, when nothing is visible yet. */
  applyCyclePlan(plan: CycleExitResult): BeatOutcome {
    return this.apply(plan.patches, false);
  }

  /** Debug-only live beat. It still refuses patches touching the visible viewport. */
  async force(): Promise<BeatOutcome> {
    if (this.running || this.budgetRemaining <= 0) {
      return { entries: [], affectedRooms: [], notes: [] };
    }
    this.running = true;
    this.callsThisCycle++;
    this.observations.noteBeat();
    try {
      const plan = await this.mind.mutate(
        this.observations.snapshot(this.world),
      );
      return this.apply(plan.patches, true);
    } finally {
      this.running = false;
    }
  }

  resetCycle(): void {
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
      if (protectViewport && touched.includes(view)) {
        entries.push({
          at: observation.elapsedSeconds,
          patch,
          result: { ok: false, affectedRooms: [] },
          withheld: "the player can see that",
        });
        continue;
      }

      const result = applyPatch(this.world, patch);
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
