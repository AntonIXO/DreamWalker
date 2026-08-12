/**
 * Drawing the world.
 *
 * Two things decide the shape of this file, and they pull in opposite directions.
 *
 * **Chunks, not regions.** It used to be one container per room, which worked when a room
 * was fifteen tiles across and the camera showed exactly one. A region is now most of a
 * screen and routes are bigger still, so grouping by region gives containers of wildly
 * different sizes and makes culling useless. Fixed chunks are the standard answer: uniform,
 * cheap to index, and a patch redraws the handful it touched.
 *
 * **Frames come from neighbours.** A tile knows it is grass; which of the forty-seven
 * pieces of grass it is depends on what is next to it (`shared/autotile.ts`). That is what
 * turns a grid of stamps into a shoreline. The consequence is that changing one tile can
 * change the picture of the eight around it, so `refreshRect` always grows its rectangle by
 * one before redrawing — a patch that repainted only what it wrote would leave a seam.
 */

import { Container, Rectangle, Sprite, type Texture } from "pixi.js";

import {
  blobIndex,
  autotileOf,
  edgeIndex,
  frameName,
} from "../../shared/autotile";
import { TILE_ROLE, Tile } from "../../shared/tilecodes";
import type { Rect } from "../../shared/dream";
import { roomAt, tileAt, type WorldState } from "../game/world";
import { variantFor, type AtlasTextures } from "./atlasTextures";

/** Tiles per chunk. 16 keeps a chunk near a screen quarter at the usual zoom. */
const CHUNK = 16;

const CACHE = {
  scaleMode: "nearest" as const,
  resolution: 1,
  antialias: false,
};

interface ChunkRecord {
  container: Container;
  sprites: Sprite[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function overlaps(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clip: Rect,
): boolean {
  return (
    x0 < clip.x + clip.w && x1 > clip.x && y0 < clip.y + clip.h && y1 > clip.y
  );
}

export class TilemapView {
  readonly root = new Container({
    label: "tilemap",
    eventMode: "none",
    interactiveChildren: false,
    cullableChildren: false,
  });
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly chunksWide: number;
  private readonly chunksHigh: number;
  private clip: Rect | null = null;

  constructor(
    private readonly world: WorldState,
    private readonly atlas: AtlasTextures,
  ) {
    this.chunksWide = Math.ceil(world.width / CHUNK);
    this.chunksHigh = Math.ceil(world.height / CHUNK);
    this.refreshAll();
  }

  /**
   * The texture for one tile: role from the code, frame from the neighbours.
   *
   * Returns null for anything the atlas has no art for, which is not an error — it is the
   * seam the runtime foundry fills (`render/foundry.ts`) when the sleeper invents a terrain
   * the Lord never baked.
   */
  private textureFor(x: number, y: number, tile: number): Texture | null {
    let role = TILE_ROLE[tile];
    if (!role) return null;

    const room = roomAt(this.world, x, y);
    const graphics = room
      ? this.world.chamberByRoomId.get(room.id)?.graphics
      : undefined;
    if (graphics) {
      if (["floor", "floorAlt", "grass", "sand"].includes(role)) {
        role = graphics.floorRole;
      } else if (["wall", "wallFace", "tree"].includes(role)) {
        role = graphics.wallRole;
      } else if (["prop", "propSolid"].includes(role)) {
        role = graphics.propRole;
      }
    }

    const frames = this.atlas.roles.get(role);
    if (!frames || frames.length === 0) return null;

    const kind = autotileOf(role);
    if (kind === "plain") return variantFor(frames, x, y);

    const sample = (dx: number, dy: number): number | null => {
      const nx = x + dx;
      const ny = y + dy;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= this.world.width ||
        ny >= this.world.height
      ) {
        return null;
      }
      return tileAt(this.world, nx, ny);
    };

    const index =
      kind === "blob" ? blobIndex(tile, sample) : edgeIndex(tile, sample);
    return (
      this.atlas.frames.get(frameName(role, index)) ??
      frames[index] ??
      frames[0] ??
      null
    );
  }

  /**
   * Hide chunks that do not overlap a tile rectangle. Used indoors so a neighbour
   * living room does not sit in the same cached chunk as the one you are standing in.
   * Pass null to show everything again.
   */
  clipTo(rect: Rect | null): void {
    this.clip = rect;
    for (const record of this.chunks.values()) {
      record.container.visible = this.chunkShown(record);
    }
  }

  private chunkShown(record: ChunkRecord): boolean {
    return (
      this.clip === null ||
      overlaps(record.x0, record.y0, record.x1, record.y1, this.clip)
    );
  }

  private releaseChunk(record: ChunkRecord): void {
    // Disable the cache first so the RenderGroup goes back to the pool; destroy()
    // returns the texture but not the group.
    record.container.cacheAsTexture(false);
    record.container.removeFromParent();
    record.container.destroy({ children: true });
  }

  private buildChunk(chunkX: number, chunkY: number): void {
    const key = `${chunkX},${chunkY}`;
    const size = this.world.tileSize;
    const x0 = chunkX * CHUNK;
    const y0 = chunkY * CHUNK;
    const x1 = Math.min(this.world.width, x0 + CHUNK);
    const y1 = Math.min(this.world.height, y0 + CHUNK);

    const painted: Array<{ lx: number; ly: number; texture: Texture }> = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const tile = tileAt(this.world, x, y);
        if (tile === Tile.VOID) continue;
        const texture = this.textureFor(x, y, tile);
        if (!texture) continue;
        painted.push({
          lx: (x - x0) * size,
          ly: (y - y0) * size,
          texture,
        });
      }
    }

    let record = this.chunks.get(key);
    if (painted.length === 0) {
      if (record) {
        this.releaseChunk(record);
        this.chunks.delete(key);
      }
      return;
    }

    if (!record) {
      const container = new Container({
        label: `chunk:${key}`,
        x: x0 * size,
        y: y0 * size,
        eventMode: "none",
        interactiveChildren: false,
      });
      record = { container, sprites: [], x0, y0, x1, y1 };
      this.chunks.set(key, record);
      this.root.addChild(container);
    } else {
      record.x0 = x0;
      record.y0 = y0;
      record.x1 = x1;
      record.y1 = y1;
    }

    const { container, sprites } = record;
    const width = (x1 - x0) * size;
    const height = (y1 - y0) * size;
    container.boundsArea = new Rectangle(0, 0, width, height);
    container.cullable = true;
    container.cullArea = new Rectangle(0, 0, width, height);
    container.visible = this.chunkShown(record);

    for (let i = 0; i < painted.length; i++) {
      const cell = painted[i]!;
      let sprite = sprites[i];
      if (!sprite) {
        sprite = new Sprite({
          texture: cell.texture,
          roundPixels: true,
          eventMode: "none",
        });
        sprites[i] = sprite;
        container.addChild(sprite);
      }
      sprite.texture = cell.texture;
      sprite.x = cell.lx;
      sprite.y = cell.ly;
      sprite.visible = true;
    }
    for (let i = painted.length; i < sprites.length; i++) {
      const spare = sprites[i]!;
      spare.visible = false;
      spare.x = 0;
      spare.y = 0;
    }

    if (container.isCachedAsTexture) {
      container.updateCacheTexture();
    } else {
      // Nearest is load-bearing: the default cache is linear, and worldRoot scales 3×.
      container.cacheAsTexture(CACHE);
    }
  }

  /**
   * Redraw everything overlapping a tile rectangle.
   *
   * Grown by one tile first: a tile's picture depends on its neighbours, so writing to the
   * edge of a rectangle changes how the tiles just outside it should be drawn.
   */
  refreshRect(rect: Rect): void {
    const x0 = Math.max(0, Math.floor((rect.x - 1) / CHUNK));
    const y0 = Math.max(0, Math.floor((rect.y - 1) / CHUNK));
    const x1 = Math.min(
      this.chunksWide - 1,
      Math.floor((rect.x + rect.w) / CHUNK),
    );
    const y1 = Math.min(
      this.chunksHigh - 1,
      Math.floor((rect.y + rect.h) / CHUNK),
    );

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) this.buildChunk(cx, cy);
    }
  }

  /** Called by the heartbeat after it has written to the tile grid. */
  refreshRooms(roomIds: Iterable<string>): void {
    for (const id of roomIds) {
      const room = this.world.roomById.get(id);
      if (room) this.refreshRect(room.rect);
    }
  }

  /** After a cycle reset, when the world is back to how the Lord left it. */
  refreshAll(): void {
    for (let cy = 0; cy < this.chunksHigh; cy++) {
      for (let cx = 0; cx < this.chunksWide; cx++) this.buildChunk(cx, cy);
    }
  }

  destroy(): void {
    for (const record of this.chunks.values()) this.releaseChunk(record);
    this.chunks.clear();
    this.root.destroy({ children: true });
  }
}
