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
 *   2  props    — authored rects, either atlas roles or their own loose PNG
 *   3  actors   — the walker and the figures, y-sorted
 *
 * A meta-space sets `backdropFit: "screen"`: its picture is parented outside the camera
 * and stretched to the whole frame, because it has no edges to speak of.
 */

import { Container, Graphics, Sprite, type Texture } from "pixi.js";

import { cellAt } from "../../shared/roomGrid";
import type { DreamArtifact } from "../../shared/dream";
import { lobbyColors, type LobbyColors } from "../lobby/palette";
import type { RoomState } from "../game/world";
import { variantFor, type AtlasTextures } from "./atlasTextures";

const ROLE_BY_CELL: Record<string, string> = {
  wall: "wall",
  wallFace: "wallFace",
  threshold: "threshold",
  floorAlt: "floorAlt",
  floor: "floor",
};

interface BuiltRoom {
  container: Container;
  actors: Container;
  /** The mask this was built from, so a `shiftWalls` patch can be detected. */
  cells: string[];
}

export class RoomScene {
  /** Goes inside the camera. Holds whichever room is current. */
  readonly root: Container;
  /** Goes outside the camera. Holds a meta-space's full-frame picture. */
  readonly overlay: Container;

  private readonly built = new Map<string, BuiltRoom>();
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
    this.paintOverlay(room);
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

    const doors = this.drawDoors(room);
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

  private drawTiles(room: RoomState): Container {
    const layer = new Container({
      label: `room-tiles:${room.id}`,
      eventMode: "none",
    });
    const size = room.tileSize;

    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        const cell = cellAt(room, x, y);
        if (cell === "void") continue;
        const role = this.roleFor(room, cell);
        const textures = this.atlas.roles.get(role);
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

    layer.cacheAsTexture({
      scaleMode: "nearest",
      resolution: 1,
      antialias: false,
    });
    return layer;
  }

  /**
   * Thresholds sit above the backdrop so a painted courtyard still shows its south
   * door. Atlas roles `doorOpen` / `doorLocked` / `doorSealed` already exist.
   */
  private drawDoors(room: RoomState): Container {
    const layer = new Container({
      label: `room-doors:${room.id}`,
      eventMode: "none",
    });
    const size = room.tileSize;
    for (const door of room.doors) {
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
    if (cell === "floor" || cell === "floorAlt") return room.graphics.floorRole;
    if (cell === "wall" || cell === "wallFace") return room.graphics.wallRole;
    return ROLE_BY_CELL[cell] ?? "floor";
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

    for (const prop of room.props) {
      const role = prop.role ?? room.graphics.propRole;
      const textures = this.atlas.roles.get(role);
      const node = new Container({ eventMode: "none" });
      if (textures && textures.length > 0) {
        for (let y = 0; y < prop.h; y++) {
          for (let x = 0; x < prop.w; x++) {
            node.addChild(
              new Sprite({
                texture: variantFor(textures, prop.x + x, prop.y + y),
                x: x * size,
                y: y * size,
                roundPixels: true,
                eventMode: "none",
              }),
            );
          }
        }
      } else if (this.objects.has(`${room.id}:${prop.id}`)) {
        // Generated object art. It arrives on a 64px sheet cell against a 16px tile, so
        // it is fitted to the prop's own rect rather than to a constant — a 3x2 bench
        // with square art reads as a square thing on a wide footprint, not a stretched
        // one — and anchored on the bottom edge so the art stands on its own base.
        const texture = this.objects.get(`${room.id}:${prop.id}`)!;
        const box = Math.min(prop.w, prop.h) * size;
        const sprite = new Sprite({
          texture,
          roundPixels: true,
          eventMode: "none",
          anchor: { x: 0.5, y: 1 },
          x: (prop.w * size) / 2,
          y: prop.h * size,
        });
        sprite.setSize(box, box);
        node.addChild(sprite);
      } else {
        node.addChild(
          new Graphics({ eventMode: "none", roundPixels: true })
            .rect(0, 0, prop.w * size, prop.h * size)
            .fill(prop.solid ? this.colors.metal : this.colors.floor),
        );
      }
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
