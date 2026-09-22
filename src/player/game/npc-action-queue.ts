/**
 * NPC command movement: walk a real path, then take/open/use.
 *
 * Ambient and follow walking in figures.ts stay as they are. This queue is for
 * confirmed WorldAction lists (dialogue replay feeds executeWorldAction directly;
 * a caller that wants visible walk-then-act enqueues here).
 *
 * path-search.ts is not in the tree yet — local BFS.
 */

import { cellAt, isSolidCell } from "../../shared/roomGrid";
import type {
  WorldAction,
  WorldActionEnvelope,
  WorldActionResult,
  WorldActionSource,
} from "../../shared/world-action";
import type { ActorRef } from "../../shared/world-object";
import { getActorOccupancy } from "../../shared/world-object";
import { planApproach } from "../../shared/world-action-engine";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { tileBlockedBySolids } from "./object-collision";
import { canPassDoor, doorDestination, type WorldState } from "./world";

export interface GridPoint {
  x: number;
  y: number;
}

const STEPS: readonly GridPoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function keyOf(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function walkable(
  world: WorldState,
  roomId: string,
  x: number,
  y: number,
  goal: GridPoint,
): boolean {
  const room = world.roomById.get(roomId);
  if (!room) return false;
  if (x === goal.x && y === goal.y) {
    return !isSolidCell(cellAt(room, x, y));
  }
  if (isSolidCell(cellAt(room, x, y))) return false;
  return !tileBlockedBySolids(world, roomId, x, y);
}

/** Four-connected BFS. The goal tile may be occupied by the thing being walked to. */
export function findGridPath(
  world: WorldState,
  roomId: string,
  from: GridPoint,
  to: GridPoint,
): GridPoint[] | null {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  const goal = { x: Math.round(to.x), y: Math.round(to.y) };
  if (start.x === goal.x && start.y === goal.y) return [start];
  if (!walkable(world, roomId, goal.x, goal.y, goal)) return null;

  const seen = new Set<string>([keyOf(start)]);
  const queue: GridPoint[] = [start];
  const cameFrom = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === goal.x && current.y === goal.y) {
      const path = [current];
      let cursor = keyOf(current);
      while (cameFrom.has(cursor)) {
        const prev = cameFrom.get(cursor)!;
        const [px, py] = prev.split(",").map(Number);
        path.push({ x: px!, y: py! });
        cursor = prev;
      }
      path.reverse();
      return path;
    }
    for (const step of STEPS) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      const id = keyOf(next);
      if (seen.has(id)) continue;
      if (!walkable(world, roomId, next.x, next.y, goal)) continue;
      seen.add(id);
      cameFrom.set(id, keyOf(current));
      queue.push(next);
    }
  }
  return null;
}

export interface ReplayOutcome {
  ok: boolean;
  executed: number;
  refusal: string | null;
}

/**
 * Apply a confirmed action log in order. First not-ok or thrown invariant stops
 * the rest — sandbox/live mismatch is not retried.
 */
export function replayWorldActions(
  execute: (envelope: WorldActionEnvelope) => WorldActionResult,
  actor: ActorRef,
  source: WorldActionSource,
  actions: readonly WorldAction[],
): ReplayOutcome {
  let executed = 0;
  for (const action of actions) {
    try {
      const result = execute({ actor, source, action });
      if (!result.ok) {
        return { ok: false, executed: executed + 1, refusal: result.refusal };
      }
      executed += 1;
    } catch {
      return { ok: false, executed, refusal: null };
    }
  }
  return { ok: true, executed, refusal: null };
}

export interface NpcActionQueueOptions {
  cause?: WorldActionEnvelope["cause"];
  beforeAction?: (envelope: WorldActionEnvelope) => boolean | string;
  afterAction?: (
    envelope: WorldActionEnvelope,
    result: WorldActionResult,
  ) => void;
}

interface FigureWork extends NpcActionQueueOptions {
  actions: WorldAction[];
  path: GridPoint[] | null;
  approachGoal?: GridPoint;
  onComplete?: (result: ReplayOutcome) => void;
  executed: number;
  waitSeconds: number;
}

export const NPC_TASK_SPEED = 3;

/** Resolve a room-to-room intention through real doors, never moveTo across rooms. */
export function planNpcRoute(
  world: WorldState,
  figureId: string,
  destination: { roomId: string; x: number; y: number },
): WorldAction[] | null {
  const figure = world.figures.find((entry) => entry.id === figureId);
  const destRoom = world.roomById.get(destination.roomId);
  if (!figure || !destRoom || destRoom.kind === "meta") return null;
  const rooms = [figure.roomId];
  const visited = new Set(rooms);
  const parents = new Map<string, { from: string; doorId: string }>();
  for (let index = 0; index < rooms.length; index++) {
    const roomId = rooms[index]!;
    if (roomId === destination.roomId) break;
    for (const door of world.roomById.get(roomId)?.doors ?? []) {
      if (door.hidden) continue;
      if (door.type === "keyLock") {
        if (
          !world.objects.some(
            (object) =>
              object.keyId === door.keyId &&
              object.location.kind === "held" &&
              object.location.actor.kind === "figure" &&
              object.location.actor.id === figureId,
          )
        )
          continue;
      } else if (!canPassDoor(world, door)) continue;
      const next = doorDestination(world, door).roomId;
      if (visited.has(next) || world.roomById.get(next)?.kind === "meta")
        continue;
      visited.add(next);
      parents.set(next, { from: roomId, doorId: door.id });
      rooms.push(next);
    }
  }
  if (!visited.has(destination.roomId)) return null;
  const doors: string[] = [];
  let cursor = destination.roomId;
  while (cursor !== figure.roomId) {
    const parent = parents.get(cursor);
    if (!parent) return null;
    doors.unshift(parent.doorId);
    cursor = parent.from;
  }
  const actions: WorldAction[] = [];
  for (const doorId of doors) {
    const door = world.doorById.get(doorId)!;
    const roomId = world.roomIdByDoorId.get(doorId)!;
    actions.push(
      { type: "moveTo", roomId, x: door.x, y: door.y },
      { type: "traverseDoor", doorId },
    );
  }
  actions.push({ type: "moveTo", ...destination });
  return actions;
}

export class NpcActionQueue {
  private readonly work = new Map<string, FigureWork>();

  enqueue(
    figureId: string,
    actions: readonly WorldAction[],
    onComplete?: (result: ReplayOutcome) => void,
    options: NpcActionQueueOptions = {},
  ): void {
    this.cancel(figureId, "replaced");
    this.work.set(figureId, {
      actions: structuredClone([...actions]),
      path: null,
      onComplete,
      executed: 0,
      waitSeconds: 0,
      ...options,
    });
  }

  get busyFigureIds(): ReadonlySet<string> {
    return new Set(this.work.keys());
  }

  remaining(figureId: string): WorldAction[] | null {
    const job = this.work.get(figureId);
    return job ? structuredClone(job.actions) : null;
  }

  cancel(figureId: string, reason = "cancelled"): void {
    const job = this.work.get(figureId);
    if (!job) return;
    this.work.delete(figureId);
    job.onComplete?.({ ok: false, executed: job.executed, refusal: reason });
  }

  clear(): void {
    for (const id of [...this.work.keys()]) this.cancel(id);
  }

  isBusy(figureId: string): boolean {
    return this.work.has(figureId);
  }

  tick(
    world: WorldState,
    execute: (envelope: WorldActionEnvelope) => WorldActionResult,
    deltaSeconds = 0.1,
  ): void {
    for (const [figureId, job] of [...this.work]) {
      if (this.work.get(figureId) !== job) continue;
      if (!world.figures.some((figure) => figure.id === figureId)) {
        this.cancel(figureId, "actor does not exist");
        continue;
      }
      if (job.actions.length === 0) {
        this.work.delete(figureId);
        job.onComplete?.({ ok: true, executed: job.executed, refusal: null });
        continue;
      }
      if (job.waitSeconds > 0) {
        job.waitSeconds -= Math.max(0, Math.min(deltaSeconds, 0.1));
        continue;
      }
      const head = job.actions[0]!;
      const envelope: WorldActionEnvelope = {
        actor: { kind: "figure", id: figureId },
        source: "npc",
        action: head,
        ...(job.cause ? { cause: job.cause } : {}),
      };
      const allowed = job.beforeAction?.(envelope) ?? true;
      if (allowed !== true) {
        this.cancel(
          figureId,
          typeof allowed === "string" ? allowed : "the situation changed",
        );
        continue;
      }
      if (this.work.get(figureId) !== job) continue;
      if (head.type === "approach") {
        const plan = planApproach(
          bindWorldMutator(world, staticPlayerPose(null)),
          { kind: "figure", id: figureId },
          head.objectId,
        );
        if (plan.refusal) {
          this.cancel(figureId, plan.refusal);
          continue;
        }
        const destination = plan.path.at(-1);
        if (destination) {
          if (
            !job.approachGoal ||
            job.approachGoal.x !== destination.x ||
            job.approachGoal.y !== destination.y
          ) {
            job.path = null;
            job.approachGoal = { x: destination.x, y: destination.y };
          }
          const done = this.stepMove(
            world,
            figureId,
            job,
            { type: "moveTo", ...destination },
            deltaSeconds,
          );
          if (this.work.get(figureId) !== job || !done) continue;
        }
      }
      if (head.type === "moveTo") {
        if (
          getActorOccupancy(world.objects, { kind: "figure", id: figureId })
        ) {
          this.cancel(figureId, "leave the occupied support first");
          continue;
        }
        const done = this.stepMove(world, figureId, job, head, deltaSeconds);
        if (this.work.get(figureId) !== job) continue;
        if (!done) continue;
      }
      const result = this.dispatch(execute, envelope);
      if (this.work.get(figureId) !== job) continue;
      job.actions.shift();
      job.path = null;
      delete job.approachGoal;
      job.executed++;
      job.waitSeconds = 0.25;
      job.afterAction?.(envelope, result);
      if (this.work.get(figureId) !== job) continue;
      if (!result.ok) this.cancel(figureId, result.refusal ?? "action refused");
      else if (job.actions.length === 0) {
        this.work.delete(figureId);
        job.onComplete?.({ ok: true, executed: job.executed, refusal: null });
      }
    }
  }

  private dispatch(
    execute: (envelope: WorldActionEnvelope) => WorldActionResult,
    envelope: WorldActionEnvelope,
  ): WorldActionResult {
    try {
      return execute(envelope);
    } catch {
      return {
        ok: false,
        refusal: null,
        affectedRooms: [],
        affectedObjects: [],
        events: [],
      };
    }
  }

  private stepMove(
    world: WorldState,
    figureId: string,
    job: FigureWork,
    action: Extract<WorldAction, { type: "moveTo" }>,
    deltaSeconds: number,
  ): boolean {
    const figure = world.figures.find((entry) => entry.id === figureId);
    if (!figure) {
      this.cancel(figureId, "actor does not exist");
      return false;
    }
    const roomId = action.roomId ?? figure.roomId;
    if (figure.roomId !== roomId) {
      this.cancel(figureId, "room changed before movement");
      return false;
    }
    const here = { x: Math.round(figure.x), y: Math.round(figure.y) };
    if (!job.path) {
      const original = { x: Math.round(action.x), y: Math.round(action.y) };
      // A threshold may be set in a solid wall, or a destination may name a solid prop.
      // Stop beside it, close enough for the following engine-validated interaction.
      const candidates = [
        original,
        ...STEPS.map((step) => ({
          x: original.x + step.x,
          y: original.y + step.y,
        })).sort(
          (a, b) =>
            Math.hypot(a.x - figure.x, a.y - figure.y) -
            Math.hypot(b.x - figure.x, b.y - figure.y),
        ),
      ];
      for (const goal of candidates) {
        const room = world.roomById.get(roomId)!;
        if (
          isSolidCell(cellAt(room, goal.x, goal.y)) ||
          tileBlockedBySolids(world, roomId, goal.x, goal.y)
        )
          continue;
        const path = findGridPath(world, roomId, here, goal);
        if (!path) continue;
        action.x = goal.x;
        action.y = goal.y;
        job.path = path.slice(1);
        break;
      }
      if (!job.path) {
        this.cancel(figureId, "no path");
        return false;
      }
    }
    if (job.path.length === 0) {
      figure.walking = false;
      figure.targetX = null;
      figure.targetY = null;
      return true;
    }
    const next = job.path[0]!;
    const room = world.roomById.get(roomId)!;
    if (
      isSolidCell(cellAt(room, next.x, next.y)) ||
      tileBlockedBySolids(world, roomId, next.x, next.y)
    ) {
      // Replan from the live position next frame. No stale path crosses a new obstacle.
      job.path = null;
      return false;
    }
    const dx = next.x - figure.x;
    const dy = next.y - figure.y;
    const distance = Math.hypot(dx, dy);
    const step = Math.min(
      distance,
      NPC_TASK_SPEED * Math.max(0, Math.min(deltaSeconds, 0.1)),
    );
    if (distance > 0) {
      figure.x += (dx / distance) * step;
      figure.y += (dy / distance) * step;
      figure.facing =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
      figure.walkTime += Math.max(0, deltaSeconds);
      figure.revision++;
      world.revision++;
    }
    figure.targetX = null;
    figure.targetY = null;
    figure.walking = step > 0;
    if (step >= distance) job.path.shift();
    return job.path.length === 0;
  }
}
