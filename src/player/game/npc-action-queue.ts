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
import { tileBlockedBySolids } from "./object-collision";
import type { WorldState } from "./world";

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

interface FigureWork {
  actions: WorldAction[];
  path: GridPoint[] | null;
}

export class NpcActionQueue {
  private readonly work = new Map<string, FigureWork>();

  enqueue(figureId: string, actions: readonly WorldAction[]): void {
    this.work.set(figureId, { actions: [...actions], path: null });
  }

  isBusy(figureId: string): boolean {
    const job = this.work.get(figureId);
    return !!job && job.actions.length > 0;
  }

  tick(
    world: WorldState,
    execute: (envelope: WorldActionEnvelope) => WorldActionResult,
  ): void {
    for (const [figureId, job] of this.work) {
      if (job.actions.length === 0) {
        this.work.delete(figureId);
        continue;
      }
      const head = job.actions[0]!;
      if (head.type === "moveTo") {
        const done = this.stepMove(world, figureId, job, head);
        if (!done) continue;
        const result = this.dispatch(execute, figureId, head);
        job.actions.shift();
        job.path = null;
        if (!result.ok) this.work.delete(figureId);
        continue;
      }
      const result = this.dispatch(execute, figureId, head);
      job.actions.shift();
      if (!result.ok) this.work.delete(figureId);
    }
  }

  private dispatch(
    execute: (envelope: WorldActionEnvelope) => WorldActionResult,
    figureId: string,
    action: WorldAction,
  ): WorldActionResult {
    try {
      return execute({
        actor: { kind: "figure", id: figureId },
        source: "npc",
        action,
      });
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
  ): boolean {
    const figure = world.figures.find((entry) => entry.id === figureId);
    if (!figure) {
      job.actions.length = 0;
      return false;
    }
    const roomId = action.roomId ?? figure.roomId;
    if (figure.roomId !== roomId) {
      // A room change is traverseDoor's job. Drop this moveTo.
      return true;
    }
    const here = { x: Math.round(figure.x), y: Math.round(figure.y) };
    const goal = { x: Math.round(action.x), y: Math.round(action.y) };
    if (here.x === goal.x && here.y === goal.y) return true;

    if (!job.path || job.path.length === 0) {
      job.path = findGridPath(world, roomId, here, goal);
    }
    if (!job.path || job.path.length === 0) {
      job.actions.length = 0;
      return false;
    }
    // path[0] is the current tile; step to the next.
    if (job.path.length === 1) {
      figure.x = goal.x;
      figure.y = goal.y;
      figure.targetX = null;
      figure.targetY = null;
      figure.walking = false;
      return true;
    }
    job.path.shift();
    const next = job.path[0]!;
    figure.x = next.x;
    figure.y = next.y;
    figure.facing =
      next.x > here.x ? "e" : next.x < here.x ? "w" : next.y > here.y ? "s" : "n";
    figure.walking = true;
    figure.revision++;
    return next.x === goal.x && next.y === goal.y;
  }
}
