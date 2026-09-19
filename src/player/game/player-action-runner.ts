/** Play validated approach paths before committing their ordinary action receipt. */
import type { NpcExecutionFeedback } from "../../shared/ai";
import { BODY_HEIGHT, BODY_WIDTH, blockedInRoom } from "../../shared/roomGrid";
import { WALK_SPEED } from "../../shared/roomWalk";
import {
  MAX_WORLD_ACTIONS_PER_TURN,
  PLAYER_ACTION_TYPES,
  type WorldActionEnvelope,
  type WorldActionResult,
} from "../../shared/world-action";
import { planApproach } from "../../shared/world-action-engine";
import { getActorOccupancy, type ActorPose } from "../../shared/world-object";
import { replayPlayerActions } from "../mind/action-feedback";
import { solidRectsFor } from "./object-collision";
import type { ReplayOutcome } from "./npc-action-queue";
import type { WorldState } from "./world";
import { bindWorldMutator } from "./world-mutator";

const PLAYER = { kind: "player" } as const;
const EPSILON = 0.00001;

export interface PlayerActionRunOutcome extends ReplayOutcome {
  execution: NpcExecutionFeedback[];
}

export interface PlayerActionRunnerHost {
  /** Continuous local tile coordinates, not playerTile's rounded cell. */
  playerPose(): ActorPose | null;
  /** deltaDistance is in pixels, for the normal walk-cycle travel counter. */
  move(pose: ActorPose, moving: boolean, deltaDistance: number): void;
  execute(envelope: WorldActionEnvelope): WorldActionResult;
  revision(): number;
}

interface ApproachWork {
  roomId: string;
  target: { id: string; x: number; y: number };
  path: ActorPose[];
  waypoint: number;
  lastPose: ActorPose;
}

interface Run {
  envelopes: WorldActionEnvelope[];
  index: number;
  executed: number;
  execution: NpcExecutionFeedback[];
  valid: () => boolean;
  resolve(outcome: PlayerActionRunOutcome): void;
  reject(error: Error): void;
  approach: ApproachWork | null;
}

export class PlayerActionRunner {
  private active: Run | null = null;

  constructor(
    private readonly world: WorldState,
    private readonly host: PlayerActionRunnerHost,
  ) {}

  get waiting(): boolean {
    return this.active !== null;
  }

  run(
    envelopes: readonly WorldActionEnvelope[],
    valid: () => boolean = () => true,
  ): Promise<PlayerActionRunOutcome> {
    this.cancel();
    // Validate the entire envelope list before any prefix is allowed to happen.
    if (
      envelopes.length > MAX_WORLD_ACTIONS_PER_TURN ||
      envelopes.some(
        (entry) =>
          entry.actor.kind !== "player" ||
          entry.source !== "player" ||
          !PLAYER_ACTION_TYPES.has(entry.action.type),
      )
    ) {
      return Promise.resolve({
        ok: false,
        executed: 0,
        refusal: "invalid player action plan",
        execution: [],
      });
    }
    const promise = new Promise<PlayerActionRunOutcome>((resolve, reject) => {
      this.active = {
        envelopes: structuredClone(envelopes) as WorldActionEnvelope[],
        index: 0,
        executed: 0,
        execution: [],
        valid,
        resolve,
        reject,
        approach: null,
      };
    });
    this.advance();
    return promise;
  }

  /** Cancellation keeps the body at its last validated position and drops the suffix. */
  cancel(): void {
    const run = this.active;
    if (!run) return;
    this.active = null;
    this.stopMoving();
    run.reject(new DOMException("Cancelled", "AbortError"));
  }

  /** Called even while the command panel awaits run(); no timers or extra action slots. */
  tick(deltaSeconds: number): void {
    const run = this.active;
    if (!run || !this.checkValid(run)) return;
    const approach = run.approach;
    if (!approach || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0)
      return;
    const room = this.world.roomById.get(approach.roomId);
    const pose = this.host.playerPose();
    const target = this.world.objectById.get(approach.target.id);
    if (
      !room ||
      !pose ||
      pose.roomId !== approach.roomId ||
      this.world.currentRoomId !== approach.roomId ||
      getActorOccupancy(this.world.objects, PLAYER)
    ) {
      this.refuseCurrent("world changed during approach");
      return;
    }
    if (
      Math.hypot(pose.x - approach.lastPose.x, pose.y - approach.lastPose.y) >
      EPSILON
    ) {
      this.refuseCurrent("player moved during approach");
      return;
    }
    if (
      target?.location.kind !== "room" ||
      target.location.roomId !== approach.roomId ||
      target.location.x !== approach.target.x ||
      target.location.y !== approach.target.y
    ) {
      this.refuseCurrent("approach target changed");
      return;
    }
    // A resumed background tab cannot consume seconds of motion in one jump.
    let remaining = (WALK_SPEED / room.tileSize) * Math.min(deltaSeconds, 0.1);
    try {
      while (remaining > EPSILON && approach.waypoint < approach.path.length) {
        if (!this.checkValid(run)) return;
        const at = approach.lastPose;
        const goal = approach.path[approach.waypoint]!;
        const distance = Math.hypot(goal.x - at.x, goal.y - at.y);
        if (distance <= EPSILON) {
          approach.waypoint++;
          continue;
        }
        // Check the whole body frequently enough that a solid tile cannot be skipped.
        const step = Math.min(remaining, distance, 0.25);
        const next = {
          roomId: approach.roomId,
          x: at.x + ((goal.x - at.x) * step) / distance,
          y: at.y + ((goal.y - at.y) * step) / distance,
        };
        if (!this.canStand(next)) {
          this.refuseCurrent("path became blocked");
          return;
        }
        this.host.move(next, true, step * room.tileSize);
        approach.lastPose = next;
        remaining -= step;
        if (distance - step <= EPSILON) approach.waypoint++;
      }
    } catch (error) {
      this.refuseCurrent(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (approach.waypoint < approach.path.length) return;
    run.approach = null;
    this.stopMoving();
    // executeWorldAction now sees the reached pose. Its one receipt is authoritative.
    if (this.executeCurrent(run)) this.advance();
  }

  private canStand(pose: ActorPose): boolean {
    const room = this.world.roomById.get(pose.roomId);
    return (
      !!room &&
      !blockedInRoom(
        room,
        solidRectsFor(this.world, room.id),
        {
          x: pose.x * room.tileSize,
          y: pose.y * room.tileSize,
          width: BODY_WIDTH,
          height: BODY_HEIGHT,
        },
        room.tileSize,
      )
    );
  }

  private advance(): void {
    const run = this.active;
    if (!run) return;
    while (this.active === run && this.checkValid(run)) {
      const envelope = run.envelopes[run.index];
      if (!envelope) {
        this.finish(true, null);
        return;
      }
      if (envelope.action.type === "approach") {
        const pose = this.host.playerPose();
        if (!pose || this.world.currentRoomId !== pose.roomId) {
          this.refuseCurrent("player is not in this room");
          return;
        }
        const mutator = bindWorldMutator(this.world, {
          get: () => this.host.playerPose(),
          set: () => undefined,
        });
        const tileWalkable = mutator.canWalk;
        mutator.canWalk = (roomId, x, y, ignoreObjectId) =>
          tileWalkable(roomId, x, y, ignoreObjectId) &&
          this.canStand({ roomId, x, y });
        const plan = planApproach(mutator, PLAYER, envelope.action.objectId);
        if (plan.refusal) {
          this.refuseCurrent(plan.refusal);
          return;
        }
        if (plan.path.length) {
          const target = this.world.objectById.get(envelope.action.objectId);
          if (target?.location.kind !== "room") {
            this.refuseCurrent("approach target changed");
            return;
          }
          run.approach = {
            roomId: pose.roomId,
            target: {
              id: target.id,
              x: target.location.x,
              y: target.location.y,
            },
            path: plan.path,
            waypoint: 0,
            lastPose: { ...pose },
          };
          return;
        }
      }
      if (!this.executeCurrent(run)) return;
    }
  }

  private executeCurrent(run: Run): boolean {
    if (this.active !== run || !this.checkValid(run)) return false;
    const envelope = run.envelopes[run.index]!;
    const outcome = replayPlayerActions(
      [envelope],
      (entry) => this.host.execute(entry),
      () => this.host.revision(),
    );
    run.execution.push(...outcome.execution);
    run.executed += outcome.executed;
    run.index++;
    if (!outcome.ok) {
      this.finish(false, outcome.refusal);
      return false;
    }
    return true;
  }

  private checkValid(run: Run): boolean {
    if (this.active !== run) return false;
    try {
      if (run.valid()) return true;
    } catch {
      /* Invalidated work cancels identically. */
    }
    this.cancel();
    return false;
  }

  private refuseCurrent(refusal: string): void {
    const run = this.active;
    if (!run) return;
    const action = run.envelopes[run.index]?.action;
    if (action) {
      run.execution.push({
        action,
        ok: false,
        refusal,
        events: [],
        worldRevision: this.host.revision(),
      });
      run.executed++;
    }
    this.finish(false, refusal);
  }

  private finish(ok: boolean, refusal: string | null): void {
    const run = this.active;
    if (!run) return;
    this.active = null;
    this.stopMoving();
    run.resolve({
      ok,
      refusal,
      executed: run.executed,
      execution: run.execution,
    });
  }

  private stopMoving(): void {
    const pose = this.host.playerPose();
    if (pose) this.host.move(pose, false, 0);
  }
}
