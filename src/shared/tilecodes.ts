/**
 * Tile vocabulary. Shared by the Lord's generator and the player's renderer.
 *
 * This is an *outdoor* vocabulary now. The dungeon set it replaced described a building —
 * floor, wall, door — and a building is the wrong shape for what §6 asks for: a world the
 * sleeper rearranges around you reads far better as a place you cross than as rooms you
 * clear. So the codes below name terrain, in the Pokémon sense: grass you walk on, water
 * you cannot, a tree line that is scenery and barrier at once, a ledge you can drop off
 * but not climb.
 *
 * Two things about how they are used matter more than the list itself:
 *
 *   - **The grid stays semantic.** A tile says `GRASS`, never "grass with a corner cut out
 *     of the top-left". Which of a terrain's forty-seven edge shapes gets drawn is worked
 *     out from the neighbours at draw time (`autotile.ts`). Baking the shape in would mean
 *     every heartbeat patch left wrong edges around whatever it changed.
 *   - **Solidity is not always a property of the tile.** Doors already depended on what the
 *     player carries; water and ledges do too. See `game/collision.ts`.
 *
 * The interior codes are kept and still used: buildings you walk into are rooms, and a
 * room is exactly what the old vocabulary was good at describing.
 */

export const Tile = {
  /** Outside the world. Never drawn, never entered. */
  VOID: 0,

  // --- outdoors ----------------------------------------------------------
  /** Ordinary ground. The default surface of the world. */
  GRASS: 1,
  /** Waist-high. Walkable, slower to read through, where things hide. */
  GRASS_TALL: 2,
  /** Worn dirt. Marks the way everyone goes, which is what makes a route legible. */
  PATH: 3,
  SAND: 4,
  WATER: 5,
  /** Deeper water. Same rule, different look, so a lake has a middle. */
  WATER_DEEP: 6,
  /** The top surface of a rise. Walkable; the drop off it is what you cannot climb. */
  CLIFF: 7,
  /** The exposed face below a rise. Solid. */
  CLIFF_FACE: 8,
  /** A one-way drop. The direction is the way you may go. */
  LEDGE_S: 9,
  LEDGE_E: 10,
  LEDGE_W: 11,
  /** Tree trunks. Solid, and the border that tells you where the world ends. */
  TREE: 12,
  /** Canopy above a trunk. Solid, drawn a row higher, purely for depth. */
  TREE_CANOPY: 13,
  FLOWERS: 14,

  // --- built -------------------------------------------------------------
  BUILDING_WALL: 15,
  BUILDING_ROOF: 16,
  /** Steps into a building or a cave. Passable, and moves you somewhere else entirely. */
  WARP: 17,
  SIGN: 18,

  // --- interiors ---------------------------------------------------------
  FLOOR: 19,
  /** Same collision as FLOOR, different look. Breaks up large rooms. */
  FLOOR_ALT: 20,
  /** Threshold floor. Reads differently so a doorway feels like passage, not place. */
  THRESHOLD: 21,
  WALL: 22,
  /** The visible face of a wall, one tile below WALL. Still solid. */
  WALL_FACE: 23,

  // --- gates -------------------------------------------------------------
  DOOR_OPEN: 24,
  DOOR_KEY: 25,
  DOOR_LEVER: 26,
  DOOR_PUZZLE: 27,
  /** The sleeper shut this one while you were elsewhere. Nothing opens it but the mind. */
  DOOR_SEALED: 28,

  // --- dressing ----------------------------------------------------------
  /** Dressing you can walk over. */
  PROP: 29,
  /** Dressing you cannot. */
  PROP_SOLID: 30,
} as const;

export type TileCode = (typeof Tile)[keyof typeof Tile];

export const TILE_COUNT = 31;

/** Door kinds as the mission graph names them. */
export const DoorType = {
  OPEN: "open",
  KEY_LOCK: "keyLock",
  LEVER_LOCK: "leverLock",
  PUZZLE_LOCK: "puzzleLock",
  /**
   * A drop you can take one way. The overworld's characteristic gate: it costs nothing to
   * use and cannot be undone, so it shapes a route without ever refusing the player
   * anything — which is why Pokémon leans on it and a dungeon does not.
   */
  LEDGE: "ledge",
  /** Not a generator output — only the heartbeat produces these. */
  SEALED: "sealed",
} as const;

export type DoorTypeName = (typeof DoorType)[keyof typeof DoorType];

export const DOOR_TYPES: readonly DoorTypeName[] = [
  DoorType.OPEN,
  DoorType.KEY_LOCK,
  DoorType.LEVER_LOCK,
  DoorType.PUZZLE_LOCK,
  DoorType.LEDGE,
  DoorType.SEALED,
];

const DOOR_TILE_BY_TYPE: Record<DoorTypeName, TileCode> = {
  [DoorType.OPEN]: Tile.DOOR_OPEN,
  [DoorType.KEY_LOCK]: Tile.DOOR_KEY,
  [DoorType.LEVER_LOCK]: Tile.DOOR_LEVER,
  [DoorType.PUZZLE_LOCK]: Tile.DOOR_PUZZLE,
  [DoorType.LEDGE]: Tile.LEDGE_S,
  [DoorType.SEALED]: Tile.DOOR_SEALED,
};

const TYPE_BY_DOOR_TILE = new Map<number, DoorTypeName>([
  [Tile.DOOR_OPEN, DoorType.OPEN],
  [Tile.DOOR_KEY, DoorType.KEY_LOCK],
  [Tile.DOOR_LEVER, DoorType.LEVER_LOCK],
  [Tile.DOOR_PUZZLE, DoorType.PUZZLE_LOCK],
  [Tile.DOOR_SEALED, DoorType.SEALED],
]);

export function doorTile(type: DoorTypeName): TileCode {
  return DOOR_TILE_BY_TYPE[type];
}

export function doorTypeOfTile(tile: number): DoorTypeName | null {
  return TYPE_BY_DOOR_TILE.get(tile) ?? null;
}

export function isDoorTile(tile: number): boolean {
  return TYPE_BY_DOOR_TILE.has(tile);
}

/** The three ledge tiles, and which way each lets you go. */
export const LEDGE_DIRECTION: Record<number, { dx: number; dy: number }> = {
  [Tile.LEDGE_S]: { dx: 0, dy: 1 },
  [Tile.LEDGE_E]: { dx: 1, dy: 0 },
  [Tile.LEDGE_W]: { dx: -1, dy: 0 },
};

export function isLedgeTile(tile: number): boolean {
  return tile in LEDGE_DIRECTION;
}

/**
 * Solidity that does not depend on runtime state.
 *
 * Doors, water and ledges are deliberately absent: whether you can cross one is a question
 * about what you are carrying or which way you are walking, and the tile grid does not
 * know either. See `game/collision.ts`.
 */
export function isSolidTile(tile: number): boolean {
  return (
    tile === Tile.VOID ||
    tile === Tile.TREE ||
    tile === Tile.TREE_CANOPY ||
    tile === Tile.CLIFF_FACE ||
    tile === Tile.BUILDING_WALL ||
    tile === Tile.BUILDING_ROOF ||
    tile === Tile.SIGN ||
    tile === Tile.WALL ||
    tile === Tile.WALL_FACE ||
    tile === Tile.PROP_SOLID
  );
}

/** Ground you can stand on, ignoring doors, water and ledges. */
export function isFloorTile(tile: number): boolean {
  return (
    tile === Tile.GRASS ||
    tile === Tile.GRASS_TALL ||
    tile === Tile.PATH ||
    tile === Tile.SAND ||
    tile === Tile.CLIFF ||
    tile === Tile.FLOWERS ||
    tile === Tile.WARP ||
    tile === Tile.FLOOR ||
    tile === Tile.FLOOR_ALT ||
    tile === Tile.THRESHOLD ||
    tile === Tile.PROP
  );
}

export function isWaterTile(tile: number): boolean {
  return tile === Tile.WATER || tile === Tile.WATER_DEEP;
}

/** Inside a building. Interiors get a different camera and no weather. */
export function isInteriorTile(tile: number): boolean {
  return (
    tile === Tile.FLOOR ||
    tile === Tile.FLOOR_ALT ||
    tile === Tile.THRESHOLD ||
    tile === Tile.WALL ||
    tile === Tile.WALL_FACE
  );
}

// ---------------------------------------------------------------------------
// Atlas roles
// ---------------------------------------------------------------------------

/**
 * Atlas frame roles. Every tile code resolves to one role.
 *
 * How many frames a role owns is not uniform any more, and `autotile.ts` decides which one
 * is drawn: a `blob` role carries 47 and picks by its eight neighbours, an `edge` role
 * carries 16 and picks by its four, and a `plain` role carries one or a handful and picks
 * by position hash the way the whole grid used to.
 */
export const TILE_ROLE: Record<number, string> = {
  [Tile.VOID]: "void",
  [Tile.GRASS]: "grass",
  [Tile.GRASS_TALL]: "grassTall",
  [Tile.PATH]: "path",
  [Tile.SAND]: "sand",
  [Tile.WATER]: "water",
  [Tile.WATER_DEEP]: "waterDeep",
  [Tile.CLIFF]: "cliff",
  [Tile.CLIFF_FACE]: "cliffFace",
  [Tile.LEDGE_S]: "ledgeS",
  [Tile.LEDGE_E]: "ledgeE",
  [Tile.LEDGE_W]: "ledgeW",
  [Tile.TREE]: "tree",
  [Tile.TREE_CANOPY]: "treeCanopy",
  [Tile.FLOWERS]: "flowers",
  [Tile.BUILDING_WALL]: "buildingWall",
  [Tile.BUILDING_ROOF]: "buildingRoof",
  [Tile.WARP]: "warp",
  [Tile.SIGN]: "sign",
  [Tile.FLOOR]: "floor",
  [Tile.FLOOR_ALT]: "floorAlt",
  [Tile.THRESHOLD]: "threshold",
  [Tile.WALL]: "wall",
  [Tile.WALL_FACE]: "wallFace",
  [Tile.DOOR_OPEN]: "doorOpen",
  [Tile.DOOR_KEY]: "doorKey",
  [Tile.DOOR_LEVER]: "doorLever",
  [Tile.DOOR_PUZZLE]: "doorPuzzle",
  [Tile.DOOR_SEALED]: "doorSealed",
  [Tile.PROP]: "prop",
  [Tile.PROP_SOLID]: "propSolid",
};

/** Roles the art pipeline must produce at least one frame for. */
export const REQUIRED_TILE_ROLES: readonly string[] = Object.values(
  TILE_ROLE,
).filter((role) => role !== "void");

/**
 * Which palette entry stands in for a tile when it is drawn as a single flat colour —
 * the terminal map preview and the in-game minimap. Deliberately coarser than
 * `TILE_ROLE`: at one pixel per tile, three kinds of locked door are one idea.
 *
 * Keyed by name rather than the `PaletteRole` type to keep this module free of any
 * import from `dream.ts`, which imports this one.
 *
 * **Both maps must gain an entry whenever a tile code is added.** A tile missing from
 * `TILE_ROLE` is invisible; one missing from here is a hole in the minimap.
 */
export const TILE_PALETTE_ROLE: Record<number, string> = {
  [Tile.VOID]: "background",
  [Tile.GRASS]: "floor",
  [Tile.GRASS_TALL]: "floorAlt",
  [Tile.PATH]: "threshold",
  [Tile.SAND]: "floorAlt",
  [Tile.WATER]: "doorOpen",
  [Tile.WATER_DEEP]: "wallEdge",
  [Tile.CLIFF]: "wall",
  [Tile.CLIFF_FACE]: "wallFace",
  [Tile.LEDGE_S]: "wallFace",
  [Tile.LEDGE_E]: "wallFace",
  [Tile.LEDGE_W]: "wallFace",
  [Tile.TREE]: "floorShadow",
  [Tile.TREE_CANOPY]: "floorShadow",
  [Tile.FLOWERS]: "accent",
  [Tile.BUILDING_WALL]: "wall",
  [Tile.BUILDING_ROOF]: "doorLocked",
  [Tile.WARP]: "highlight",
  [Tile.SIGN]: "prop",
  [Tile.FLOOR]: "floor",
  [Tile.FLOOR_ALT]: "floorAlt",
  [Tile.THRESHOLD]: "threshold",
  [Tile.WALL]: "wall",
  [Tile.WALL_FACE]: "wallFace",
  [Tile.DOOR_OPEN]: "doorOpen",
  [Tile.DOOR_KEY]: "doorLocked",
  [Tile.DOOR_LEVER]: "doorLocked",
  [Tile.DOOR_PUZZLE]: "doorLocked",
  [Tile.DOOR_SEALED]: "doorSealed",
  [Tile.PROP]: "prop",
  [Tile.PROP_SOLID]: "prop",
};
