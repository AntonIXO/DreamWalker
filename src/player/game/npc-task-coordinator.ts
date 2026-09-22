/** One movement owner per NPC; every owner sees only its own pending suffix. */
import type {
  WorldAction,
  WorldActionEnvelope,
  WorldActionResult,
} from "../../shared/world-action";
import {
  NpcActionQueue,
  type NpcActionQueueOptions,
  type ReplayOutcome,
} from "./npc-action-queue";
import { doorDestination, type WorldState } from "./world";
import { pinnedHome } from "../../shared/population";

export interface NpcTaskOwner {
  kind: "director" | "jev" | "routine";
  id: string;
}

export interface NpcTaskOptions extends NpcActionQueueOptions {
  onComplete?: (result: ReplayOutcome) => void;
  lifetimeSeconds?: number;
}

interface OwnedTask {
  owner: NpcTaskOwner;
  remainingSeconds: number;
}

const PRIORITY: Record<NpcTaskOwner["kind"], number> = {
  routine: 0,
  jev: 1,
  director: 2,
};

function sameOwner(left: NpcTaskOwner, right: NpcTaskOwner): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export class NpcTaskCoordinator {
  private readonly queue = new NpcActionQueue();
  private readonly tasks = new Map<string, OwnedTask>();

  constructor(
    private readonly world: WorldState,
    private readonly execute: (
      envelope: WorldActionEnvelope,
    ) => WorldActionResult,
    private readonly options: { dryWallet?: () => boolean } = {},
  ) {}

  get busyFigureIds(): ReadonlySet<string> {
    return this.queue.busyFigureIds;
  }

  ownerOf(figureId: string): NpcTaskOwner | null {
    const owner = this.tasks.get(figureId)?.owner;
    return owner ? { ...owner } : null;
  }

  isBusy(figureId: string): boolean {
    return this.queue.isBusy(figureId);
  }

  tryEnqueue(
    figureId: string,
    owner: NpcTaskOwner,
    actions: readonly WorldAction[],
    options: NpcTaskOptions = {},
  ): boolean {
    const current = this.tasks.get(figureId);
    // Repeated submission by an owner must not replay an already committed prefix.
    if (current) {
      if (
        sameOwner(current.owner, owner) ||
        PRIORITY[current.owner.kind] >= PRIORITY[owner.kind]
      )
        return false;
      this.cancelFigure(figureId, `preempted by ${owner.kind}`);
      // Completion hooks may have submitted another task; never erase it silently.
      if (this.tasks.has(figureId)) return false;
    }
    const task: OwnedTask = {
      owner: { ...owner },
      remainingSeconds: Math.max(
        0,
        Math.min(
          Number.isFinite(options.lifetimeSeconds)
            ? options.lifetimeSeconds!
            : 180,
          180,
        ),
      ),
    };
    this.tasks.set(figureId, task);
    this.queue.enqueue(
      figureId,
      actions,
      (result) => {
        if (this.tasks.get(figureId) !== task) return;
        this.tasks.delete(figureId);
        const figure = this.world.figures.find(
          (entry) => entry.id === figureId,
        );
        if (figure) {
          figure.walking = false;
          figure.targetX = null;
          figure.targetY = null;
        }
        options.onComplete?.(result);
      },
      {
        cause: options.cause,
        beforeAction: (envelope) => {
          const action = envelope.action;
          if (
            figureId === "glaz" &&
            ["moveTo", "approach", "traverseDoor", "occupy", "leave"].includes(
              action.type,
            )
          )
            return "the Eye remains stationary";
          const pinned = pinnedHome(this.world.artifact, figureId, {
            dryWallet: this.options.dryWallet?.(),
          });
          if (pinned) {
            if (
              action.type === "moveTo" &&
              action.roomId &&
              action.roomId !== pinned
            )
              return "actor remains in its authored room";
            if (action.type === "traverseDoor") {
              const door = this.world.doorById.get(action.doorId);
              if (door && doorDestination(this.world, door).roomId !== pinned)
                return "actor remains in its authored room";
            }
          }
          return options.beforeAction?.(envelope) ?? true;
        },
        afterAction: options.afterAction,
      },
    );
    return true;
  }

  remaining(figureId: string, owner: NpcTaskOwner): WorldAction[] | null {
    const current = this.tasks.get(figureId);
    return current && sameOwner(current.owner, owner)
      ? this.queue.remaining(figureId)
      : null;
  }

  cancel(figureId: string, owner: NpcTaskOwner, reason = "cancelled"): boolean {
    const current = this.tasks.get(figureId);
    if (!current || !sameOwner(current.owner, owner)) return false;
    this.cancelFigure(figureId, reason);
    return true;
  }

  cancelFigure(figureId: string, reason = "cancelled"): void {
    this.queue.cancel(figureId, reason);
  }

  cancelOwner(kind: NpcTaskOwner["kind"], reason = "cancelled"): void {
    for (const [figureId, task] of [...this.tasks])
      if (task.owner.kind === kind) this.cancel(figureId, task.owner, reason);
  }

  clear(): void {
    for (const [figureId, task] of [...this.tasks])
      this.cancel(figureId, task.owner);
  }

  tick(deltaSeconds: number): void {
    const delta = Math.max(
      0,
      Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.1),
    );
    for (const [figureId, task] of [...this.tasks]) {
      task.remainingSeconds -= delta;
      if (task.remainingSeconds <= 0)
        this.cancel(figureId, task.owner, "expired");
    }
    this.queue.tick(this.world, this.execute, delta);
  }
}
