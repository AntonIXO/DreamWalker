/**
 * First-class world objects. Shared by player, server sandbox, scripts, and heartbeat.
 *
 * Must stay free of DOM and node APIs.
 *
 * Authored rooms still carry RoomProp + RoomHotspot. At inhabit, those (plus live
 * interests) are migrated into WorldObjectState. Inventory is not a second array:
 * a carried thing is location.kind === "held".
 */

import { rectContainsPoint } from "./rect";

export type ActorRef = { kind: "player" } | { kind: "figure"; id: string };

export type SystemActor = { kind: "sleeper" } | { kind: "script"; id: string };

export type AnyActor = ActorRef | SystemActor;

export type ObjectLocation =
  | { kind: "room"; roomId: string; x: number; y: number }
  | { kind: "held"; actor: ActorRef }
  | { kind: "inside"; objectId: string }
  | { kind: "removed" };

export const OBJECT_MOBILITIES = ["fixed", "movable", "carryable"] as const;
export type ObjectMobility = (typeof OBJECT_MOBILITIES)[number];

/**
 * Physical verbs an object can participate in. "examine" is narrative (look/clue) and
 * does not itself mutate WorldState. "talk"/"press"/"lead"/"kill" stay on figures
 * via shared/verbs.ts — they are not object affordances.
 */
export const OBJECT_AFFORDANCES = [
  "examine",
  "take",
  "drop",
  "give",
  "put",
  "open",
  "close",
  "activate",
  "use",
  "traverse",
] as const;
export type ObjectAffordance = (typeof OBJECT_AFFORDANCES)[number];

export interface WorldObjectState {
  id: string;
  name: string;
  location: ObjectLocation;
  mobility: ObjectMobility;
  affordances: ObjectAffordance[];
  body: { w: number; h: number; solid: boolean } | null;
  visual: { role: string | null; image: string | null };
  interaction: {
    reach: number;
    prompt: string;
    refusal: string | null;
  } | null;
  state: {
    open?: boolean;
    active?: boolean;
    broken?: boolean;
    locked?: boolean;
  };
  tags: string[];
  /** Preserved across take/drop so a clue does not become a nameless prop. */
  clueId: string | null;
  holdsShardId: string | null;
  sensorySeed: string | null;
  once: boolean;
  dwellMs: number | null;
  /** Door key id when this object is a key. Null for everything else. */
  keyId: string | null;
  /** Authored hotspot kind, when this object was migrated from one. */
  hotspotKind: "look" | "clue" | "figure" | "ui" | null;
  /** Lobby/UI panel name, when hotspot.action was a panel id. */
  uiAction: string | null;
}

export interface ActorPose {
  roomId: string;
  x: number;
  y: number;
}

export interface WorldDoorView {
  id: string;
  type: string;
  fromRoomId: string;
  toRoomId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  keyId: string | null;
  threshold: string;
  /** Arrival tile in the destination room. */
  toX: number;
  toY: number;
}

/**
 * Narrow mutable surface the action engine writes. Player WorldState and the
 * server sandbox both adapt to this. Do not import WorldState here.
 */
export interface WorldMutator {
  revision: number;
  objects: WorldObjectState[];
  objectById: Map<string, WorldObjectState>;
  keysHeld: Set<string>;
  /** Live figure poses. cloneWorldMutator copies this map. */
  figurePoses: Map<string, ActorPose>;
  doorById: Map<string, WorldDoorView>;
  getPlayerPose(): ActorPose | null;
  setPlayerPose(pose: ActorPose): void;
  getFigurePose(figureId: string): ActorPose | null;
  setFigurePose(figureId: string, pose: ActorPose): void;
  getDoor(doorId: string): WorldDoorView | null;
  setDoorType(doorId: string, type: string): void;
  /** Authored walk mask only (no objects). */
  isWalkableTile(roomId: string, x: number, y: number): boolean;
  /**
   * Same policy as world.ts `canPassDoor` (open / key / lever / puzzle / sealed).
   * Key-lock also succeeds when this mutator's keysHeld has the key.
   */
  canPassDoor(doorId: string): boolean;
  /** Authored walk mask + live solid objects (not including the acting body). */
  canWalk(roomId: string, x: number, y: number, ignoreObjectId?: string): boolean;
  /** Chebyshev / grid path exists between two tiles in the same room. */
  hasPath(
    roomId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    ignoreObjectId?: string,
  ): boolean;
  bumpRevision(): void;
}

export function cloneObject(object: WorldObjectState): WorldObjectState {
  return {
    ...object,
    location: { ...object.location },
    affordances: [...object.affordances],
    body: object.body ? { ...object.body } : null,
    visual: { ...object.visual },
    interaction: object.interaction ? { ...object.interaction } : null,
    state: { ...object.state },
    tags: [...object.tags],
  };
}

export function isHeldBy(object: WorldObjectState, actor: ActorRef): boolean {
  return (
    object.location.kind === "held" &&
    ((actor.kind === "player" && object.location.actor.kind === "player") ||
      (actor.kind === "figure" &&
        object.location.actor.kind === "figure" &&
        object.location.actor.id === actor.id))
  );
}

export function actorKey(actor: ActorRef): string {
  return actor.kind === "player" ? "player" : `figure:${actor.id}`;
}

export function actorsEqual(a: ActorRef, b: ActorRef): boolean {
  if (a.kind === "player" && b.kind === "player") return true;
  return a.kind === "figure" && b.kind === "figure" && a.id === b.id;
}

export function isActorRef(actor: AnyActor): actor is ActorRef {
  return actor.kind === "player" || actor.kind === "figure";
}

/** Integer tile rect a solid body occupies, or null. */
export function objectBodyRect(
  object: WorldObjectState,
): { x: number; y: number; w: number; h: number } | null {
  if (object.location.kind !== "room" || !object.body) return null;
  return {
    x: Math.floor(object.location.x),
    y: Math.floor(object.location.y),
    w: object.body.w,
    h: object.body.h,
  };
}

export function solidObjectCovers(
  objects: readonly WorldObjectState[],
  roomId: string,
  x: number,
  y: number,
  ignoreObjectId?: string,
): boolean {
  for (const object of objects) {
    if (ignoreObjectId && object.id === ignoreObjectId) continue;
    if (object.location.kind !== "room" || object.location.roomId !== roomId) {
      continue;
    }
    if (!object.body?.solid) continue;
    const rect = objectBodyRect(object);
    if (rect && rectContainsPoint(rect, x, y)) return true;
  }
  return false;
}

const CHEBYSHEV_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/**
 * Deterministic 8-connected path. Returns steps after `from`, including `to`.
 * Empty array if already there. Null if no path.
 */
export function findChebyshevPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  walkable: (x: number, y: number) => boolean,
): { x: number; y: number }[] | null {
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  const gx = Math.round(to.x);
  const gy = Math.round(to.y);
  if (sx === gx && sy === gy) return [];
  if (!walkable(gx, gy)) return null;

  const keyOf = (x: number, y: number) => `${x},${y}`;
  const visited = new Set<string>([keyOf(sx, sy)]);
  const parent = new Map<string, { x: number; y: number }>();
  const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];

  while (queue.length > 0) {
    if (visited.size > 4096) return null;
    const cur = queue.shift()!;
    for (const [dx, dy] of CHEBYSHEV_NEIGHBORS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const k = keyOf(nx, ny);
      if (visited.has(k)) continue;
      if (!walkable(nx, ny)) continue;
      visited.add(k);
      parent.set(k, cur);
      if (nx === gx && ny === gy) {
        const steps: { x: number; y: number }[] = [{ x: nx, y: ny }];
        let at = cur;
        while (!(at.x === sx && at.y === sy)) {
          steps.push(at);
          const prev = parent.get(keyOf(at.x, at.y));
          if (!prev) break;
          at = prev;
        }
        steps.reverse();
        return steps;
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}
