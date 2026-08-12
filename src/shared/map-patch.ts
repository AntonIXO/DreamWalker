import { Tile, type DoorTypeName } from "./tilecodes";

/**
 * Terrains the sleeper is allowed to conjure.
 *
 * Closed, like everything else here, and named in the sleeper's terms rather than the tile
 * grid's — a model asked for `water` gets it right far more often than one asked for
 * `WATER_DEEP`, and the translation is this table's job, not the model's.
 */
export const TERRAINS = {
  water: Tile.WATER,
  tallGrass: Tile.GRASS_TALL,
  sand: Tile.SAND,
  wood: Tile.TREE,
  flowers: Tile.FLOWERS,
} as const;

export type TerrainName = keyof typeof TERRAINS;

export const TERRAIN_NAMES = Object.keys(TERRAINS) as TerrainName[];

/**
 * Closed vocabulary of structural changes the sleeper may ask the player runtime to
 * apply. The model only produces these intents; `game/patch.ts` remains the sole writer.
 */
export type MapPatch =
  | { kind: "sealDoor"; doorId: string; reason: string }
  | { kind: "openDoor"; doorId: string; reason: string }
  | { kind: "retypeDoor"; doorId: string; to: DoorTypeName; reason: string }
  | { kind: "moveFigure"; figureId: string; toRoomId: string; reason: string }
  | {
      kind: "relocateShard";
      shardId: string;
      toFigureId: string;
      reason: string;
    }
  | { kind: "retileRoom"; roomId: string; reason: string }
  | { kind: "swapRooms"; aRoomId: string; bRoomId: string; reason: string }
  /**
   * A patch of ground becomes something it was not: water where there was grass, a wood
   * closing over a field. §6 — "сгенерировалось то, чего не было: разум подкинул, он тут
   * хозяин".
   *
   * The only patch that can call for art the Lord never baked, which is what
   * `player/render/foundry.ts` exists for. Runtime structural checks keep it inside a
   * known room; reachability remains the sleeper's concern, not a solver's.
   */
  | {
      kind: "growTerrain";
      roomId: string;
      terrain: TerrainName;
      reason: string;
    };
