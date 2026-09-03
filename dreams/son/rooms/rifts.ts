import { allRooms } from "./catalog";

/** Every rift that survived the street map. The sleeper may retarget these, and only these. */
export const RIFT_IDS: readonly string[] = allRooms()
  .flatMap((room) => room.doors)
  .filter((door) => door.threshold === "rift")
  .map((door) => door.id);
