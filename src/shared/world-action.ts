/**
 * Embodied world actions. Player, NPC, pack scripts, and Heartbeat share this envelope.
 *
 * Must stay free of DOM and node APIs.
 */

import type { ActorRef, AnyActor, ObjectAffordance } from "./world-object";

export type WorldActionSource = "player" | "npc" | "script" | "sleeper";

export type WorldAction =
  | { type: "moveTo"; x: number; y: number; roomId?: string }
  | { type: "take"; objectId: string }
  | { type: "drop"; objectId: string; x?: number; y?: number }
  | { type: "give"; objectId: string; to: ActorRef }
  | { type: "put"; objectId: string; intoObjectId: string }
  | { type: "open"; targetId: string }
  | { type: "close"; targetId: string }
  | { type: "activate"; objectId: string }
  | { type: "use"; objectId: string; targetId?: string }
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
  | {
      type: "object.taken";
      objectId: string;
      actor: ActorRef;
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
  action: WorldAction;
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
]);

export const MAX_WORLD_ACTIONS_PER_TURN = 8;
