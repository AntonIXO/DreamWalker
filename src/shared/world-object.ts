/**
 * First-class world objects. Shared by player, server sandbox, scripts, and heartbeat.
 *
 * Must stay free of DOM and node APIs.
 *
 * Authored rooms still carry RoomProp + RoomHotspot. At inhabit, those (plus live
 * interests) are migrated into WorldObjectState. Inventory is not a second array:
 * a carried thing is location.kind === "held".
 */

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
  keyId: string | null;
  threshold: string;
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
  getPlayerPose(): ActorPose | null;
  setPlayerPose(pose: ActorPose): void;
  getFigurePose(figureId: string): ActorPose | null;
  setFigurePose(figureId: string, pose: ActorPose): void;
  getDoor(doorId: string): WorldDoorView | null;
  setDoorType(doorId: string, type: string): void;
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
