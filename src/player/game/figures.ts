import type { Rect } from "../../shared/dream";
import { makeRng } from "../../shared/rng";
import { isFloorTile } from "../../shared/tilecodes";
import { applyPatch } from "./patch";
import type { FigureState, WorldState } from "./world";

function phaseAt(progress: number): FigureState["agendaPhase"] {
  if (progress < 1 / 3) return "early";
  if (progress < 2 / 3) return "middle";
  return "late";
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function scheduleFigure(
  world: WorldState,
  figure: FigureState,
  phase: FigureState["agendaPhase"],
  visible: Rect,
): void {
  if (figure.agendaPhase === phase) return;
  const stop = figure.agenda.find((candidate) => candidate.phase === phase);
  if (!stop) {
    figure.agendaPhase = phase;
    return;
  }
  if (stop.roomId !== figure.roomId) {
    const from = world.roomById.get(figure.roomId);
    const to = world.roomById.get(stop.roomId);
    // A schedule is seen as an absence and a later arrival, never teleportation.
    if (
      !from ||
      !to ||
      overlaps(from.rect, visible) ||
      overlaps(to.rect, visible)
    )
      return;
    const moved = applyPatch(world, {
      kind: "moveFigure",
      figureId: figure.id,
      toRoomId: stop.roomId,
      reason: `schedule:${phase}`,
    });
    if (!moved.ok) return;
  }
  figure.agendaPhase = phase;
  figure.activity = stop.activity;
  figure.targetX = null;
  figure.targetY = null;
  figure.walking = false;
}

function beginStep(world: WorldState, figure: FigureState): void {
  const x = Math.round(figure.x);
  const y = Math.round(figure.y);
  const candidates = [
    { x: x + 1, y, facing: "e" as const },
    { x: x - 1, y, facing: "w" as const },
    { x, y: y + 1, facing: "s" as const },
    { x, y: y - 1, facing: "n" as const },
  ].filter((candidate) => {
    const roomIndex = world.roomIndex[candidate.y * world.width + candidate.x];
    const room = roomIndex === undefined ? undefined : world.rooms[roomIndex];
    return (
      room?.id === figure.roomId &&
      isFloorTile(world.tiles[candidate.y * world.width + candidate.x] ?? 0) &&
      !world.interests.some(
        (interest) => interest.x === candidate.x && interest.y === candidate.y,
      )
    );
  });
  const rng = makeRng(
    `figure-walk:${figure.id}:${figure.revision}:${Math.floor(figure.walkTime * 10)}`,
  );
  const target = rng.maybePick(candidates);
  if (!target) {
    figure.walkWait = 2;
    return;
  }
  figure.targetX = target.x;
  figure.targetY = target.y;
  figure.facing = target.facing;
  figure.walking = true;
}

function walkFigure(figure: FigureState, deltaSeconds: number): void {
  figure.walkTime += deltaSeconds;
  if (figure.targetX === null || figure.targetY === null) {
    figure.walking = false;
    figure.walkWait -= deltaSeconds;
    if (figure.walkWait <= 0) figure.walkWait = 0;
    return;
  }
  const dx = figure.targetX - figure.x;
  const dy = figure.targetY - figure.y;
  const distance = Math.hypot(dx, dy);
  const step = 0.85 * deltaSeconds;
  if (distance <= step) {
    figure.x = figure.targetX;
    figure.y = figure.targetY;
    figure.targetX = null;
    figure.targetY = null;
    figure.walking = false;
    const rng = makeRng(
      `figure-wait:${figure.id}:${Math.floor(figure.walkTime)}`,
    );
    figure.walkWait = 1.5 + rng.next() * 3;
    return;
  }
  figure.x += (dx / distance) * step;
  figure.y += (dy / distance) * step;
  figure.walking = true;
}

/** Advance schedules and tiny local routines on Pixi's existing ticker. */
export function updateFigures(
  world: WorldState,
  cycleProgress: number,
  deltaSeconds: number,
  frozenFigureId: string | null,
  visible: Rect,
): void {
  const phase = phaseAt(cycleProgress);
  for (const figure of world.figures) {
    scheduleFigure(world, figure, phase, visible);
    if (figure.id === frozenFigureId) {
      figure.walking = false;
      continue;
    }
    walkFigure(figure, deltaSeconds);
    if (
      !figure.walking &&
      figure.targetX === null &&
      figure.targetY === null &&
      figure.walkWait <= 0
    ) {
      beginStep(world, figure);
    }
  }
}
