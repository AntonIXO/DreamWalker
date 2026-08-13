import type { DoorTypeName } from "./tilecodes";

/**
 * Closed vocabulary of structural changes the sleeper may ask the player runtime to
 * apply. The model only produces these intents; `game/patch.ts` remains the sole writer.
 *
 * ## What changed in format 4
 *
 * The terrain patches are gone. `retileRoom` and `growTerrain` existed because the world
 * was a tile grid the generator had painted, so the most natural thing a sleeper could do
 * to it was repaint some. With authored rooms the equivalent gestures are better ones,
 * and both come straight out of `dream-walker-new/rooms.md`:
 *
 *   - **`relink`** — the sleeper rewires where an object throws you. §4.1: «комнаты
 *     соединяются без логики, но переход всегда через порог». The door still exists; it
 *     just goes somewhere else now.
 *   - **`shiftWalls`** — a room swaps to another of its authored walk masks. §13's
 *     underground halls rebuild «как камеры в Portal 2», §17's shower shrinks 3% a pass.
 *     Authored, so it costs no art and can never produce an unwalkable room by accident.
 *
 * `swapRooms` is gone with the card-dealing it served: a room is where it is now.
 */
export type MapPatch =
  | { kind: "sealDoor"; doorId: string; reason: string }
  | { kind: "openDoor"; doorId: string; reason: string }
  | { kind: "retypeDoor"; doorId: string; to: DoorTypeName; reason: string }
  | { kind: "moveFigure"; figureId: string; toRoomId: string; reason: string }
  | {
      kind: "moveInterest";
      interestId: string;
      toRoomId: string;
      reason: string;
    }
  | { kind: "removeInterest"; interestId: string; reason: string }
  | {
      kind: "placeInterest";
      interest: {
        id: string;
        roomId: string;
        name: string;
        sensorySeed: string;
        solid: boolean;
        holdsShardId: string | null;
        clueId: string | null;
      };
      reason: string;
    }
  | {
      kind: "relocateShard";
      shardId: string;
      toFigureId: string;
      reason: string;
    }
  /**
   * Point a rift somewhere else. The most in-genre thing a heartbeat can do: the archway
   * is still where it was, and this time it puts you in the morgue.
   *
   * **Rifts only.** Rewiring a staircase so the third floor comes out in the forest is
   * exactly the «телепорт на ровном месте» §4.1 forbids, and the whole reason to keep
   * stairs is that they are the part of the map that does not lie. Enforced in
   * `patch.ts`, not merely intended here.
   */
  | {
      kind: "retargetDoor";
      doorId: string;
      toRoomId: string;
      reason: string;
    }
  /** Swap a room's walk mask for one of its authored `cellVariants`. */
  | {
      kind: "shiftWalls";
      roomId: string;
      variantId: string;
      reason: string;
    }
  /** Take an object away once it has been used, or give one back. */
  | {
      kind: "closeHotspot";
      roomId: string;
      hotspotId: string;
      reason: string;
    }
  | {
      kind: "openHotspot";
      roomId: string;
      hotspotId: string;
      reason: string;
    };

export const PATCH_KINDS = [
  "sealDoor",
  "openDoor",
  "retypeDoor",
  "moveFigure",
  "moveInterest",
  "removeInterest",
  "placeInterest",
  "relocateShard",
  "retargetDoor",
  "shiftWalls",
  "closeHotspot",
  "openHotspot",
] as const;

export type PatchKind = (typeof PATCH_KINDS)[number];
