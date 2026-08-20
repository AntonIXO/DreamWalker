/**
 * Draws one authored room at a time.
 *
 * Format 3 drew a single 249×209 tile grid in cached 16×16 chunks, because the whole
 * dream was one array and the camera roamed it. Rooms are discrete now, so the renderer
 * is discrete too: build a container per room, cache it, and swap which one is visible.
 * A room is small enough that this is cheaper than chunking ever was, and it means
 * entering a room costs one `visible = true` rather than a re-tile.
 *
 * Three layers, in the order a top-down room reads:
 *
 *   0  backdrop — the authored PNG, when there is one
 *   1  tiles    — atlas floor/wall art from the ASCII mask, drawn *under* the backdrop
 *                 so a room with art shows the art and a room without still walks
 *   2  props    — authored rects: the prop's own PNG if it has one, else atlas tiles.
 *                 Skipped when a cells mural is loaded: the painting is the furniture.
 *   3  actors   — the walker and the figures, y-sorted
 *
 * A meta-space sets `backdropFit: "screen"`: its picture is parented outside the camera
 * and stretched to the whole frame, because it has no edges to speak of.
 */

import { Container, Graphics, Sprite, type Texture } from "pixi.js";

import { cellAt, type RoomCell } from "../../shared/roomGrid";
import type { DreamArtifact } from "../../shared/dream";
import { hidePropSprites, muralShowsTheRoom } from "../../shared/room";
import { originX, originY } from "../../shared/street";
import { Tile } from "../../shared/tilecodes";
import {
  autotileOf,
  blobIndex,
  edgeIndex,
  type Sampler,
} from "../../shared/autotile";
import { lobbyColors, type LobbyColors } from "../lobby/palette";
import type { RoomState } from "../game/world";
import { variantFor, type AtlasTextures } from "./atlasTextures";

const ROLE_BY_CELL: Record<string, string> = {
  wall: "wall",
  wallFace: "wallFace",
  threshold: "threshold",
  floorAlt: "floorAlt",
  floor: "floor",
  grass: "grass",
  grassTall: "grassTall",
  path: "path",
  tree: "tree",
};

const TILE_BY_CELL: Record<string, number> = {
  void: Tile.VOID,
  wall: Tile.WALL,
  wallFace: Tile.WALL_FACE,
  threshold: Tile.THRESHOLD,
  floorAlt: Tile.FLOOR_ALT,
  floor: Tile.FLOOR,
  grass: Tile.GRASS,
  grassTall: Tile.GRASS_TALL,
  path: Tile.PATH,
  tree: Tile.TREE,
};

const WALKABLE: ReadonlySet<string> = new Set([
  "grass",
  "grassTall",
  "path",
  "floor",
  "floorAlt",
  "threshold",
  "void",
]);

/**
 * A route still has a floor. Punching the path out left you walking on the sky
 * photograph — космос underfoot. Interior tree fill is the only hole: the weather
 * sits beside the road, not in it.
 */
export function routeOpensOntoSky(
  tags: readonly string[],
  cell: string,
  room?: { width: number; height: number; cells: readonly string[] },
  x = 0,
  y = 0,
): boolean {
  if (!tags.includes("route")) return false;
  if (cell !== "tree" || !room) return false;
  return !treeTouchesWalkable(room, x, y);
}

function treeTouchesWalkable(
  room: { width: number; height: number; cells: readonly string[] },
  x: number,
  y: number,
): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= room.width || ny >= room.height) continue;
    if (WALKABLE.has(cellAt(room, nx, ny))) return true;
  }
  return false;
}

interface BuiltRoom {
  container: Container;
  actors: Container;
  /** The mask this was built from, so a `shiftWalls` patch can be detected. */
  cells: string[];
}

/**
 * How many built rooms to keep. A street view shows the block around you.
 */
const KEEP_BUILT = 28;

/** Guaranteed floor for `GL_MAX_TEXTURE_SIZE`. */
const MAX_CACHE_PX = 2048;

export class RoomScene {
  /** Goes inside the camera. Holds whichever room is current. */
  readonly root: Container;
  /** Goes outside the camera. Holds a meta-space's full-frame picture. */
  readonly overlay: Container;

  private readonly built = new Map<string, BuiltRoom>();
  /** Least-recently-shown first. See `evictBeyond`. */
  private readonly recent: string[] = [];
  private readonly colors: LobbyColors;
  private current: BuiltRoom | null = null;
  private currentRoomId: string | null = null;
  private overlaySprite: Sprite | null = null;

  constructor(
    artifact: DreamArtifact,
    private readonly atlas: AtlasTextures,
    private readonly backdrops: ReadonlyMap<string, Texture>,
    /** Per-hotspot object art, keyed `<roomId>:<hotspotId>`. */
    private readonly objects: ReadonlyMap<string, Texture> = new Map(),
  ) {
    this.colors = lobbyColors(artifact);
    this.root = new Container({
      label: "rooms",
      isRenderGroup: true,
      eventMode: "none",
      interactiveChildren: false,
      sortableChildren: true,
    });
    this.overlay = new Container({
      label: "room-overlay",
      eventMode: "none",
      interactiveChildren: false,
    });
  }

  /** The layer walkers are added to. Changes with the room, so ask each time. */
  get actorLayer(): Container {
    if (!this.current) throw new Error("no room is being shown");
    return this.current.actors;
  }

  get shownRoomId(): string | null {
    return this.currentRoomId;
  }

  get shown(): Set<string> {
    const ids = new Set<string>();
    for (const [id, entry] of this.built) {
      if (entry.container.visible) ids.add(id);
    }
    return ids;
  }

  show(room: RoomState): void {
    const existing = this.built.get(room.id);
    // A shifted wall mask invalidates the cache — §13's halls rebuild behind your back.
    if (existing && !sameCells(existing.cells, room.cells)) {
      this.destroyRoom(room.id);
    }

    let entry = this.built.get(room.id);
    if (!entry) {
      entry = this.build(room);
      this.built.set(room.id, entry);
      this.root.addChild(entry.container);
    }

    if (this.current && this.current !== entry)
      this.current.container.visible = false;
    entry.container.visible = true;
    this.current = entry;
    this.currentRoomId = room.id;
    // `splice(-1, 1)` on a miss removes the *last* entry, which is the opposite of what
    // this line is for and quietly stops the cache ever being evicted.
    const seen = this.recent.indexOf(room.id);
    if (seen >= 0) this.recent.splice(seen, 1);
    this.recent.push(room.id);
    this.evictBeyond(KEEP_BUILT);
    this.placeRoom(entry, room);
    this.paintOverlay(room);
  }

  /**
   * Draw a neighbourhood: each room sits at its origin so walking east is walking
   * east, not a cut to a new (0, 0).
   */
  showStreet(rooms: readonly RoomState[], current: RoomState): void {
    const wanted = new Set(rooms.map((room) => room.id));
    for (const room of rooms) {
      const existing = this.built.get(room.id);
      if (existing && !sameCells(existing.cells, room.cells)) {
        this.destroyRoom(room.id);
      }
      let entry = this.built.get(room.id);
      if (!entry) {
        entry = this.build(room);
        this.built.set(room.id, entry);
        this.root.addChild(entry.container);
      }
      entry.container.visible = true;
      this.placeRoom(entry, room);
      const seen = this.recent.indexOf(room.id);
      if (seen >= 0) this.recent.splice(seen, 1);
      this.recent.push(room.id);
    }
    for (const [id, entry] of this.built) {
      if (!wanted.has(id)) entry.container.visible = false;
    }
    const currentEntry = this.built.get(current.id);
    this.current = currentEntry ?? null;
    this.currentRoomId = current.id;
    this.evictBeyond(KEEP_BUILT);
    this.paintOverlay(current);
  }

  private placeRoom(entry: BuiltRoom, room: RoomState): void {
    const size = room.tileSize;
    entry.container.x = originX(room) * size;
    entry.container.y = originY(room) * size;
  }

  /** Force a rebuild, after anything that changed what the room is made of. */
  invalidate(roomId: string): void {
    if (this.built.has(roomId)) this.destroyRoom(roomId);
    if (this.currentRoomId === roomId) {
      this.current = null;
      this.currentRoomId = null;
    }
  }

  destroy(): void {
    for (const id of [...this.built.keys()]) this.destroyRoom(id);
    this.overlaySprite?.destroy();
    this.overlaySprite = null;
    this.root.destroy({ children: true });
    this.overlay.destroy({ children: true });
  }

  /** Resize the meta-space picture when the window changes. */
  resizeOverlay(width: number, height: number): void {
    if (!this.overlaySprite) return;
    this.overlaySprite.width = width;
    this.overlaySprite.height = height;
  }

  private destroyRoom(roomId: string): void {
    const entry = this.built.get(roomId);
    if (!entry) return;
    entry.container.destroy({ children: true });
    this.built.delete(roomId);
    if (this.current === entry) this.current = null;
  }

  private paintOverlay(room: RoomState): void {
    const wanted =
      room.graphics.backdropFit === "screen"
        ? (this.backdrops.get(room.id) ?? null)
        : null;
    if (!wanted) {
      this.overlay.visible = false;
      return;
    }
    if (!this.overlaySprite) {
      this.overlaySprite = new Sprite({ eventMode: "none", roundPixels: true });
      this.overlay.addChild(this.overlaySprite);
    }
    this.overlaySprite.texture = wanted;
    this.overlay.visible = true;
  }

  private build(room: RoomState): BuiltRoom {
    const container = new Container({
      label: `room:${room.id}`,
      eventMode: "none",
      interactiveChildren: false,
      sortableChildren: true,
      visible: false,
    });

    const tiles = this.drawTiles(room);
    tiles.zIndex = 0;
    container.addChild(tiles);

    // "cells" backdrops sit over the tiles: the art is the room, the tiles are the
    // fallback that keeps a not-yet-drawn room walkable rather than invisible.
    const backdrop = this.backdrops.get(room.id);
    if (backdrop && room.graphics.backdropFit === "cells") {
      const sprite = new Sprite({
        texture: backdrop,
        roundPixels: true,
        eventMode: "none",
        width: room.width * room.tileSize,
        height: room.height * room.tileSize,
      });
      sprite.zIndex = 1;
      container.addChild(sprite);
    }

    // A loaded cells mural is the furniture and the architecture. Drawing atlas
    // `doorOpen` / `prop` tiles over it is how a painted apartment grew a row of brown
    // triangles and a beige strip across its north wall.
    const mural =
      muralShowsTheRoom(room.graphics) && this.backdrops.has(room.id);

    const doors = this.drawDoors(room, mural);
    doors.zIndex = 1.5;
    container.addChild(doors);

    // One layer for everything standing in the room. Objects used to be a second layer
    // at the same z, drawn after — so an object always covered a prop regardless of who
    // was in front. They are the same kind of thing and now they sort against each other.
    const props = this.drawProps(room);
    props.zIndex = 2;
    container.addChild(props);

    const actors = new Container({
      label: `room-actors:${room.id}`,
      sortableChildren: true,
      eventMode: "none",
      interactiveChildren: false,
    });
    actors.zIndex = 3;
    container.addChild(actors);

    return { container, actors, cells: [...room.cells] };
  }

  /**
   * Keep only the last few built rooms.
   *
   * `built` never evicted, which was free at 20×11 — a 320×176 render texture is 220 kB
   * and there are 29 of them. A floor larger than the screen changes the arithmetic
   * rather than the design: at 48×32 the same cache is 1.5 MB a room, and holding all of
   * them is 45 MB of GPU memory for rooms nobody is standing in.
   */
  private evictBeyond(keep: number): void {
    while (this.recent.length > keep) {
      const id = this.recent.shift();
      if (
        id &&
        id !== this.currentRoomId &&
        !this.built.get(id)?.container.visible
      ) {
        this.destroyRoom(id);
      } else if (id) {
        this.recent.push(id);
        break;
      }
    }
  }

  private drawTiles(room: RoomState): Container {
    const layer = new Container({
      label: `room-tiles:${room.id}`,
      eventMode: "none",
    });
    const size = room.tileSize;

    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        const cell = cellAt(room, x, y);
        if (cell === "void" || routeOpensOntoSky(room.tags, cell, room, x, y))
          continue;
        const role = this.roleFor(room, cell);
        const textures = this.atlas.roles.get(role);
        if (textures && textures.length > 0) {
          layer.addChild(
            new Sprite({
              texture: this.tileTexture(room, role, cell, x, y, textures),
              x: x * size,
              y: y * size,
              roundPixels: true,
              eventMode: "none",
            }),
          );
          continue;
        }
        // No art for that role yet: a flat block still says wall or floor, which is all
        // the player needs while a room is being authored.
        const fill =
          cell === "wall" || cell === "wallFace"
            ? this.colors.wall
            : cell === "threshold"
              ? this.colors.metal
              : this.colors.floor;
        layer.addChild(
          new Graphics({ eventMode: "none", roundPixels: true })
            .rect(x * size, y * size, size, size)
            .fill(fill),
        );
      }
    }

    // `cacheAsTexture` flattens the whole mask to one draw call, which is worth more on
    // a big floor than a small one — but it allocates a texture the size of the room, and
    // `GL_MAX_TEXTURE_SIZE` is only guaranteed to be 2048. Past that the cache silently
    // fails, so do not ask for it; the sprites still draw, just unflattened.
    const pixels = Math.max(room.width, room.height) * room.tileSize;
    if (pixels <= MAX_CACHE_PX) {
      layer.cacheAsTexture({
        scaleMode: "nearest",
        resolution: 1,
        antialias: false,
      });
    }
    return layer;
  }

  /**
   * Thresholds sit above the tiles so a room without a mural still shows its south
   * door. Atlas roles `doorOpen` / `doorLocked` / `doorSealed` already exist.
   *
   * A cells mural already painted the architecture; stamping those roles on top of
   * it covers the picture with beige blocks, including across a painted archway.
   */
  private drawDoors(room: RoomState, mural: boolean): Container {
    const layer = new Container({
      label: `room-doors:${room.id}`,
      eventMode: "none",
    });
    const size = room.tileSize;
    if (mural || room.tags.includes("route")) return layer;
    for (const door of room.doors) {
      // Open street doorways are holes in the wall, not beige tiles pasted on the
      // painting. Locked and lift doors still need a mark.
      if (door.threshold === "door" && door.type === "open") continue;
      const role =
        door.type === "sealed"
          ? "doorSealed"
          : door.type === "open" || door.type === "ledge"
            ? "doorOpen"
            : "doorLocked";
      const textures = this.atlas.roles.get(role);
      for (let y = door.y; y < door.y + door.h; y++) {
        for (let x = door.x; x < door.x + door.w; x++) {
          if (textures && textures.length > 0) {
            layer.addChild(
              new Sprite({
                texture: variantFor(textures, x, y),
                x: x * size,
                y: y * size,
                roundPixels: true,
                eventMode: "none",
              }),
            );
            continue;
          }
          layer.addChild(
            new Graphics({ eventMode: "none", roundPixels: true })
              .rect(x * size, y * size, size, size)
              .fill(this.colors.metal),
          );
        }
      }
    }
    return layer;
  }

  /** The room's own floor/wall/prop art overrides the generic role, per §7.1. */
  private roleFor(room: RoomState, cell: string): string {
    if (
      cell === "grass" ||
      cell === "grassTall" ||
      cell === "path" ||
      cell === "tree"
    ) {
      return ROLE_BY_CELL[cell] ?? cell;
    }
    if (cell === "threshold" && room.tags.includes("route")) return "path";
    if (cell === "floor" || cell === "floorAlt") return room.graphics.floorRole;
    if (cell === "wall" || cell === "wallFace") return room.graphics.wallRole;
    return ROLE_BY_CELL[cell] ?? "floor";
  }

  private tileTexture(
    room: RoomState,
    role: string,
    cell: RoomCell,
    x: number,
    y: number,
    textures: Texture[],
  ): Texture {
    const kind = autotileOf(role);
    if (kind === "plain" || textures.length < 16) {
      return variantFor(textures, x, y);
    }
    const self = TILE_BY_CELL[cell] ?? Tile.FLOOR;
    const sample: Sampler = (dx, dy) => {
      const neighbour = cellAt(room, x + dx, y + dy);
      if (neighbour === "void") return null;
      return TILE_BY_CELL[neighbour] ?? Tile.FLOOR;
    };
    const index =
      kind === "blob" ? blobIndex(self, sample) : edgeIndex(self, sample);
    return textures[index] ?? textures[0]!;
  }

  /**
   * The things the room's prose says are in it.
   *
   * Hotspots are where the game's writing actually lives — a rope to the vault, a shelf
   * you can sleep on — so once they have art it is drawn at the hotspot's own position,
   * anchored at its foot so a walker standing below it draws in front.
   */
  private drawProps(room: RoomState): Container {
    const layer = new Container({
      label: `room-props:${room.id}`,
      eventMode: "none",
      sortableChildren: true,
    });
    const size = room.tileSize;
    // Atlas `prop` is a brown 16×16 block. Object sheets are the same colour with a
    // silhouette stamped on. Neither belongs on a painted room or a generated street.
    if (hidePropSprites(room)) return layer;

    for (const prop of room.props) {
      const objectTexture = this.objects.get(`${room.id}:${prop.id}`);
      if (!objectTexture) continue;
      const node = new Container({ eventMode: "none" });
      // Generated object art. It arrives on a 64px sheet cell against a 16px tile, so
      // it is fitted to the prop's own rect rather than to a constant — a 3x2 bench
      // with square art reads as a square thing on a wide footprint, not a stretched
      // one — and anchored on the bottom edge so the art stands on its own base.
      const box = Math.min(prop.w, prop.h) * size;
      const sprite = new Sprite({
        texture: objectTexture,
        roundPixels: true,
        eventMode: "none",
        anchor: { x: 0.5, y: 1 },
        x: (prop.w * size) / 2,
        y: prop.h * size,
      });
      sprite.setSize(box, box);
      node.addChild(sprite);
      node.x = prop.x * size;
      node.y = prop.y * size;
      // Sort by the prop's foot, so a walker standing below it draws in front. The old
      // object layer sorted by the *hotspot* — which is now the approach tile, a row
      // lower — so objects and walkers disagreed about depth by most of a tile.
      node.zIndex = (prop.y + prop.h) * size;
      layer.addChild(node);
    }

    return layer;
  }
}

function sameCells(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row === b[i]);
}
