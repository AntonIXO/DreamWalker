/**
 * Data contract for the prep-room lobby.
 *
 * Graphics and copy live here (and in `definition.ts`) so a later artist can replace
 * the placeholder furniture without rewriting `main.ts`. Positions are in tiles.
 */

export type LobbyHotspotKind =
  "terminal" | "patient" | "controls" | "dream-entry" | "settings";

export interface LobbyHotspot {
  id: string;
  kind: LobbyHotspotKind;
  /** Tile the sanitar must stand near. */
  x: number;
  y: number;
  /** Reach in tiles. */
  reach: number;
  prompt: string;
}

export interface LobbySpawn {
  x: number;
  y: number;
  facing: "n" | "e" | "s" | "w";
}

export type LobbyCell =
  "void" | "floor" | "floorAlt" | "wall" | "wallFace" | "threshold";

export type FurnitureKind =
  | "desk"
  | "cross"
  | "locker"
  | "terminal"
  | "ward-doors"
  | "bed"
  | "apparatus"
  | "drip"
  | "carpet"
  | "plaque"
  | "gonzo";

export interface LobbyFurniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Blocks walking when true. */
  solid: boolean;
}

export interface LobbyDefinition {
  id: string;
  tileSize: number;
  width: number;
  height: number;
  spawn: LobbySpawn;
  cells: readonly string[];
  furniture: readonly LobbyFurniture[];
  hotspots: readonly LobbyHotspot[];
  copy: Record<string, string>;
}
