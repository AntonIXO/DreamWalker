import {
  cellAt,
  isSolidCell,
  isWalkableCell,
  rectBlocks,
} from "../../shared/roomGrid";
import { makeRng } from "../../shared/rng";
import {
  isEdgeOpening,
  isStreetWorld,
  originX,
  originY,
  pickRoomAtTile,
} from "../../shared/street";
import { applyPatch } from "./patch";
import { WALK_SPEED } from "../../shared/roomWalk";
import { whoIsLed } from "./fates";
import type { FigureState, RoomState, WorldState } from "./world";

function phaseAt(progress: number): FigureState["agendaPhase"] {
  if (progress < 1 / 3) return "early";
  if (progress < 2 / 3) return "middle";
  return "late";
}

function scheduleFigure(
  world: WorldState,
  figure: FigureState,
  phase: FigureState["agendaPhase"],
  visibleRoomId: string,
): void {
  if (figure.agendaPhase === phase) return;
  const stop = figure.agenda.find((candidate) => candidate.phase === phase);
  if (!stop) {
    figure.agendaPhase = phase;
    return;
  }
  if (stop.roomId !== figure.roomId) {
    // A schedule is seen as an absence and a later arrival, never teleportation. With
    // discrete rooms that is simply "not the room the sanitar is standing in".
    if (figure.roomId === visibleRoomId || stop.roomId === visibleRoomId)
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

function stepCandidates(world: WorldState, figure: FigureState) {
  const x = Math.round(figure.x);
  const y = Math.round(figure.y);
  return [
    { x: x + 1, y, facing: "e" as const },
    { x: x - 1, y, facing: "w" as const },
    { x, y: y + 1, facing: "s" as const },
    { x, y: y - 1, facing: "n" as const },
  ].filter((candidate) => {
    const room = world.roomById.get(figure.roomId);
    if (!room) return false;
    if (isSolidCell(cellAt(room, candidate.x, candidate.y))) return false;
    if (rectBlocks(room.props, candidate.x, candidate.y)) return false;
    return !world.interests.some(
      (interest) =>
        interest.roomId === room.id &&
        Math.round(interest.x) === candidate.x &&
        Math.round(interest.y) === candidate.y,
    );
  });
}

function beginStep(world: WorldState, figure: FigureState): void {
  const rng = makeRng(
    `figure-walk:${figure.id}:${figure.revision}:${Math.floor(figure.walkTime * 10)}`,
  );
  const target = rng.maybePick(stepCandidates(world, figure));
  if (!target) {
    figure.walkWait = 2;
    return;
  }
  figure.targetX = target.x;
  figure.targetY = target.y;
  figure.facing = target.facing;
  figure.walking = true;
}

/** Keep this far back, in tiles, so following does not read as shoving. */
const FOLLOW_GAP = 1.2;

/**
 * Tiles a second while following. `WALK_SPEED` is 62 px/s against a 16px tile, so the
 * sanitar covers about 3.9 tiles a second — a follower at the ambient 0.85 would be
 * abandoned before the first doorway.
 */
const FOLLOW_SPEED = (WALK_SPEED / 16) * 0.95;

/**
 * A led figure steps toward the sanitar instead of wandering.
 *
 * Same walkability filter as `beginStep` — it just stops choosing at random. There is no
 * pathfinder here and there should not be: greedy is enough in a room, and a person who
 * gets stuck behind furniture and has to be come back for is in register.
 */
function beginFollowStep(
  world: WorldState,
  figure: FigureState,
  toward: { x: number; y: number },
): void {
  if (isStreetWorld(world.rooms)) {
    beginFollowStepWorld(world, figure, toward);
    return;
  }
  const away = Math.hypot(toward.x - figure.x, toward.y - figure.y);
  if (away <= FOLLOW_GAP) {
    figure.walking = false;
    figure.walkWait = 0.2;
    return;
  }
  let best: { x: number; y: number; facing: FigureState["facing"] } | null =
    null;
  let bestAway = away;
  for (const candidate of stepCandidates(world, figure)) {
    const distance = Math.hypot(toward.x - candidate.x, toward.y - candidate.y);
    if (distance < bestAway) {
      bestAway = distance;
      best = candidate;
    }
  }
  if (!best) {
    figure.walkWait = 0.4;
    return;
  }
  figure.targetX = best.x;
  figure.targetY = best.y;
  figure.facing = best.facing;
  figure.walking = true;
}

function figureWorld(
  world: WorldState,
  figure: FigureState,
): { x: number; y: number } {
  const room = world.roomById.get(figure.roomId);
  if (!room) return { x: figure.x, y: figure.y };
  return { x: originX(room) + figure.x, y: originY(room) + figure.y };
}

function seatFigure(
  _world: WorldState,
  figure: FigureState,
  room: RoomState,
  x: number,
  y: number,
): void {
  if (figure.roomId !== room.id) {
    figure.roomId = room.id;
    figure.revision++;
  }
  figure.x = x;
  figure.y = y;
}

function worldStepOpen(
  world: WorldState,
  figure: FigureState,
  tx: number,
  ty: number,
): RoomState | null {
  const placed = pickRoomAtTile(world.rooms, tx, ty, figure.roomId);
  if (!placed) return null;
  const room = world.roomById.get(placed.id);
  if (!room) return null;
  const lx = tx - originX(room);
  const ly = ty - originY(room);
  if (
    !isWalkableCell(cellAt(room, lx, ly)) &&
    !isEdgeOpening(world.rooms, room, lx, ly)
  ) {
    return null;
  }
  if (rectBlocks(room.props, lx, ly)) return null;
  if (
    world.interests.some(
      (interest) =>
        interest.roomId === room.id &&
        Math.round(interest.x) === lx &&
        Math.round(interest.y) === ly,
    )
  ) {
    return null;
  }
  return room;
}

/**
 * Follow in world tiles so a doorway onto a street is just another step, not a wall.
 */
function beginFollowStepWorld(
  world: WorldState,
  figure: FigureState,
  toward: { x: number; y: number },
): void {
  const pos = figureWorld(world, figure);
  const away = Math.hypot(toward.x - pos.x, toward.y - pos.y);
  if (away <= FOLLOW_GAP) {
    figure.walking = false;
    figure.walkWait = 0.2;
    return;
  }
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  const options = [
    { x: x + 1, y, facing: "e" as const },
    { x: x - 1, y, facing: "w" as const },
    { x, y: y + 1, facing: "s" as const },
    { x, y: y - 1, facing: "n" as const },
  ];
  let best: (typeof options)[number] | null = null;
  let bestRoom: RoomState | null = null;
  let bestAway = away;
  for (const candidate of options) {
    const room = worldStepOpen(world, figure, candidate.x, candidate.y);
    if (!room) continue;
    const distance = Math.hypot(toward.x - candidate.x, toward.y - candidate.y);
    if (distance < bestAway) {
      bestAway = distance;
      best = candidate;
      bestRoom = room;
    }
  }
  if (!best || !bestRoom) {
    figure.walkWait = 0.4;
    return;
  }
  const localX = best.x - originX(bestRoom);
  const localY = best.y - originY(bestRoom);
  figure.facing = best.facing;
  if (bestRoom.id !== figure.roomId) {
    seatFigure(world, figure, bestRoom, localX, localY);
    figure.targetX = null;
    figure.targetY = null;
    figure.walking = false;
    figure.walkWait = 0;
    return;
  }
  figure.targetX = localX;
  figure.targetY = localY;
  figure.walking = true;
}

function standIn(
  room: RoomState,
  prefer: { x: number; y: number },
): { x: number; y: number } | null {
  const ok = (x: number, y: number): boolean => {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return false;
    if (!isWalkableCell(cellAt(room, tx, ty))) return false;
    if (rectBlocks(room.props, tx, ty)) return false;
    return true;
  };
  if (ok(prefer.x, prefer.y)) return prefer;
  for (let radius = 1; radius <= 4; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = prefer.x + dx;
        const y = prefer.y + dy;
        if (ok(x, y)) return { x, y };
      }
    }
  }
  for (let y = 1; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      if (ok(x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Take a led figure through a threshold. Routes have no slots, so this does not
 * ask `moveFigure` — that patch is for the sleeper seating someone, not for a walk.
 */
export function escortFigure(
  world: WorldState,
  figureId: string,
  toRoomId: string,
  at: { x: number; y: number },
): boolean {
  const figure = world.figures.find((entry) => entry.id === figureId);
  const room = world.roomById.get(toRoomId);
  if (!figure || !room) return false;
  if (figure.roomId === toRoomId) return true;
  const stand = standIn(room, at);
  if (!stand) return false;
  seatFigure(world, figure, room, stand.x, stand.y);
  figure.targetX = null;
  figure.targetY = null;
  figure.walking = false;
  return true;
}

function walkFigure(
  figure: FigureState,
  deltaSeconds: number,
  tilesPerSecond = 0.85,
): void {
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
  const step = tilesPerSecond * deltaSeconds;
  if (distance <= step) {
    figure.x = figure.targetX;
    figure.y = figure.targetY;
    figure.targetX = null;
    figure.targetY = null;
    figure.walking = false;
    const rng = makeRng(
      `figure-wait:${figure.id}:${Math.floor(figure.walkTime)}`,
    );
    figure.walkWait = tilesPerSecond > 1 ? 0 : 1.5 + rng.next() * 3;
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
  visibleRoomId: string,
  /**
   * Where the sanitar is, in tiles, for whoever is being led. On a street map
   * these are world tiles so a doorway onto a route is just another step.
   */
  follower: { x: number; y: number } | null = null,
): void {
  const phase = phaseAt(cycleProgress);
  const led = whoIsLed(world);
  for (const figure of world.figures) {
    const following = figure.id === led && follower !== null;
    // An agenda is a life. Being led is not one, so a led figure has no schedule.
    if (!following) scheduleFigure(world, figure, phase, visibleRoomId);
    if (figure.id === frozenFigureId || figure.id === "glaz") {
      figure.walking = false;
      figure.targetX = null;
      figure.targetY = null;
      continue;
    }
    // Slightly under the sanitar's own speed, or they fall behind on the first corner
    // and the whole thing reads as broken rather than reluctant.
    walkFigure(figure, deltaSeconds, following ? FOLLOW_SPEED : 0.85);
    if (
      !figure.walking &&
      figure.targetX === null &&
      figure.targetY === null &&
      figure.walkWait <= 0
    ) {
      if (following) beginFollowStep(world, figure, follower);
      else beginStep(world, figure);
    }
  }
}
