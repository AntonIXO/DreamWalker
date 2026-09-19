/**
 * Embodied world actions. Player, NPC, pack scripts, and Heartbeat share this envelope.
 *
 * Must stay free of DOM and node APIs.
 */

import type {
  ActorRef,
  AnyActor,
  ObjectAffordance,
  WorldObjectAlteration,
  WorldObjectPhysicalState,
} from "./world-object";
import type { PhysicalProfile } from "./object-profile";

export type WorldActionSource = "player" | "npc" | "script" | "sleeper";

export type WorldAction =
  | { type: "approach"; objectId: string }
  | { type: "occupy"; objectId: string }
  | { type: "leave" }
  | { type: "wear"; objectId: string }
  | { type: "removeWear"; objectId: string }
  | { type: "detach"; objectId: string }
  | { type: "empty"; objectId: string }
  | { type: "moveObject"; objectId: string; x: number; y: number }
  | { type: "refineProfile"; objectId: string; profile: PhysicalProfile }
  | {
      type: "requestRole";
      intent: "gather" | "inspect" | "helpMove";
      objectId?: string;
    }
  | { type: "moveTo"; x: number; y: number; roomId?: string }
  | { type: "take"; objectId: string }
  | { type: "drop"; objectId: string; x?: number; y?: number }
  | { type: "give"; objectId: string; to: ActorRef }
  | { type: "put"; objectId: string; intoObjectId: string }
  | { type: "open"; targetId: string }
  | { type: "close"; targetId: string }
  | { type: "activate"; objectId: string }
  | { type: "use"; objectId: string; targetId?: string }
  | {
      type: "alter";
      objectId: string;
      verb: string;
      changes: WorldObjectAlteration;
      targetId?: string;
    }
  | { type: "gesture"; objectId: string; verb: string; targetId?: string }
  | { type: "traverseDoor"; doorId: string };

/** Sleeper/admin actions NPC tools must never receive. */
export type SystemWorldAction =
  | { type: "mapPatch"; patch: unknown }
  | { type: "shiftWalls"; roomId: string; variantId: string; reason: string };

export interface WorldActionEnvelope {
  actor: AnyActor;
  source: WorldActionSource;
  action: WorldAction;
}

export type WorldEvent =
  | { type: "door.revealed"; actor: AnyActor; doorId: string }
  | { type: "actor.occupied"; actor: ActorRef; objectId: string }
  | { type: "actor.left"; actor: ActorRef; objectId: string }
  | { type: "object.worn"; actor: ActorRef; objectId: string }
  | { type: "object.unworn"; actor: ActorRef; objectId: string }
  | {
      type: "object.detached";
      actor: ActorRef;
      objectId: string;
      fromObjectId: string;
    }
  | {
      type: "object.relocated";
      actor: ActorRef;
      objectId: string;
      roomId: string;
      x: number;
      y: number;
    }
  | {
      type: "object.emptied";
      actor: ActorRef;
      objectId: string;
      objectIds: string[];
    }
  | { type: "object.profiled"; actor: ActorRef; objectId: string }
  | {
      type: "actor.requested";
      actor: ActorRef;
      intent: "gather" | "inspect" | "helpMove";
      objectId: string | null;
      roleId: string;
    }
  | {
      type: "object.taken";
      objectId: string;
      actor: AnyActor;
      fromRoomId: string | null;
    }
  | {
      type: "object.dropped";
      objectId: string;
      actor: ActorRef;
      roomId: string;
      x: number;
      y: number;
    }
  | {
      type: "object.given";
      objectId: string;
      from: ActorRef;
      to: ActorRef;
    }
  | {
      type: "object.moved";
      objectId: string;
      intoObjectId: string;
    }
  | {
      type: "object.opened";
      objectId: string;
      actor: AnyActor;
    }
  | {
      type: "object.closed";
      objectId: string;
      actor: AnyActor;
    }
  | {
      type: "object.activated";
      objectId: string;
      actor: AnyActor;
    }
  | {
      type: "object.used";
      objectId: string;
      targetId: string | null;
      actor: AnyActor;
    }
  | {
      type: "object.changed";
      objectId: string;
      targetId: string | null;
      actor: AnyActor;
      verb: string;
      before: WorldObjectPhysicalState;
      after: WorldObjectPhysicalState;
    }
  | {
      type: "object.gestured";
      objectId: string;
      targetId: string | null;
      actor: AnyActor;
      verb: string;
      /** The gesture is observable; no unsupported physical result is claimed. */
      effect: "none";
    }
  | {
      type: "door.opened";
      doorId: string;
      actor: AnyActor;
    }
  | {
      type: "door.closed";
      doorId: string;
      actor: AnyActor;
    }
  | {
      type: "door.traversed";
      doorId: string;
      actor: ActorRef;
      fromRoomId: string;
      toRoomId: string;
    }
  | {
      type: "actor.moved";
      actor: ActorRef;
      roomId: string;
      x: number;
      y: number;
    }
  | {
      type: "actor.enteredRoom";
      actor: ActorRef;
      roomId: string;
      viaDoorId: string | null;
    };

export interface WorldActionResult {
  ok: boolean;
  refusal: string | null;
  affectedRooms: string[];
  affectedObjects: string[];
  events: WorldEvent[];
}

export interface ActionOption {
  action: WorldAction | { type: "examine"; objectId: string };
  affordance: ObjectAffordance | "move";
  label: string;
  refusal: string | null;
}

export const NPC_ACTION_TYPES: ReadonlySet<WorldAction["type"]> = new Set<
  WorldAction["type"]
>([
  "moveTo",
  "take",
  "drop",
  "give",
  "put",
  "open",
  "close",
  "activate",
  "use",
  "traverseDoor",
  "approach",
  "occupy",
  "leave",
  "wear",
  "removeWear",
  "detach",
  "moveObject",
  "empty",
  "requestRole",
]);

export const MAX_WORLD_ACTIONS_PER_TURN = 8;

/** Item-command sessions never move an actor or perform map/admin mutations. */
export const PLAYER_ACTION_TYPES: ReadonlySet<WorldAction["type"]> = new Set([
  "take",
  "drop",
  "give",
  "put",
  "open",
  "close",
  "activate",
  "use",
  "alter",
  "gesture",
  "approach",
  "occupy",
  "leave",
  "wear",
  "removeWear",
  "detach",
  "moveObject",
  "empty",
  "refineProfile",
  "requestRole",
]);
