/**
 * Sprites for anyone who walks: the sanitar and the figures of the dream.
 *
 * Frames come out of the atlas by name, in the spelling `tools/lord/art/silhouettes.ts`
 * writes them. Sprites are anchored at the feet so that sorting by Y puts whoever is
 * lower in the room in front, which is the whole of depth in a top-down view.
 */

import { Container, Sprite, type Texture } from "pixi.js";

import type { Direction } from "../../shared/roomGrid";
import { WALK_STRIDE } from "../../shared/roomWalk";
import type { AtlasTextures } from "./atlasTextures";
import { originX, originY } from "../../shared/street";
import type { FigureState, InterestState, WorldState } from "../game/world";

export type { Direction };

/** Cut-out walk cycle that replaces the atlas silhouette for one character. */
export interface AuthoredWalk {
  /** Front idle at [0], then front walk frames. */
  south: readonly Texture[];
  /** Profile walk, facing east. West is this set flipped. */
  east: readonly Texture[];
  /** Back idle at [0], then back walk frames. */
  north?: readonly Texture[];
  /** Sprite height in world pixels. Texture is scaled to this. */
  worldHeight: number;
}

function frameName(prefix: string, dir: Direction, frame: number): string {
  return `${prefix}_${dir}_${frame % 2}`;
}

export class WalkerSprite {
  readonly sprite: Sprite;
  private currentName = "";
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastDir: Direction | "" = "";
  private lastFrame = -1;
  private lastMoving = false;
  private lastTravelled = -1;

  constructor(
    private readonly atlas: AtlasTextures,
    private readonly prefix: string,
    private readonly authored: AuthoredWalk | null = null,
  ) {
    const first = this.authored?.south[0] ?? this.textureFor("s", 0);
    this.sprite = new Sprite({
      texture: first,
      // Feet at the position, not the middle of the body.
      anchor: { x: 0.5, y: 0.9 },
      roundPixels: true,
      eventMode: "none",
    });
    if (this.authored) this.applyAuthoredScale(false);
  }

  private textureFor(dir: Direction, frame: number): Texture {
    const name = frameName(this.prefix, dir, frame);
    const texture = this.atlas.frames.get(name);
    if (!texture) throw new Error(`atlas has no frame "${name}"`);
    return texture;
  }

  private applyAuthoredScale(flip: boolean): void {
    const walk = this.authored;
    if (!walk) return;
    const height = Math.max(1, this.sprite.texture.height);
    const scale = walk.worldHeight / height;
    this.sprite.scale.set(flip ? -scale : scale, scale);
  }

  private authoredTexture(
    dir: Direction,
    moving: boolean,
    travelled: number,
  ): Texture {
    const walk = this.authored;
    if (!walk) return this.textureFor(dir, 0);
    const front = walk.south[0];
    const back = walk.north?.[0];
    if (!front) return this.textureFor(dir, 0);
    const idle = dir === "n" && back ? back : front;
    if (!moving) return idle;
    const north = walk.north ?? [];
    const sheet =
      dir === "e" || dir === "w"
        ? walk.east.length > 0
          ? walk.east
          : walk.south
        : dir === "n" && north.length > 0
          ? north
          : walk.south;
    if (sheet.length === 0) return idle;
    const index = Math.floor(travelled / WALK_STRIDE) % sheet.length;
    return sheet[index] ?? idle;
  }

  update(
    x: number,
    y: number,
    dir: Direction,
    frame: number,
    moving = false,
    travelled = 0,
  ): void {
    if (
      x === this.lastX &&
      y === this.lastY &&
      dir === this.lastDir &&
      frame === this.lastFrame &&
      moving === this.lastMoving &&
      travelled === this.lastTravelled
    ) {
      return;
    }

    this.lastX = x;
    this.lastY = y;
    this.lastDir = dir;
    this.lastFrame = frame;
    this.lastMoving = moving;
    this.lastTravelled = travelled;

    this.sprite.x = Math.round(x);
    this.sprite.y = Math.round(y);
    // Sorting key: whoever stands lower draws in front.
    this.sprite.zIndex = Math.round(y);

    if (this.authored) {
      const texture = this.authoredTexture(dir, moving, travelled);
      if (this.sprite.texture !== texture) this.sprite.texture = texture;
      this.applyAuthoredScale(moving && dir === "w");
      return;
    }

    const name = frameName(this.prefix, dir, frame);
    if (name !== this.currentName) {
      this.currentName = name;
      this.sprite.texture = this.textureFor(dir, frame);
    }
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

/**
 * Everyone who can be occluded by everyone else lives in one container with
 * `sortableChildren`, so the ordering is decided by position rather than by the order
 * things happened to be created in.
 *
 * Authored paintings are the same kind of actor as a walker: a few tiles tall,
 * nearest-scaled, zoomed with the camera. Native PNG size on screen ate the room.
 */

/** World-pixel cap for cut-out figure art. Three tiles tall, four wide. */
const FIGURE_ART_HEIGHT = 48;
const FIGURE_ART_WIDTH = 64;

export class ActorLayer {
  readonly root = new Container({
    label: "actors",
    sortableChildren: true,
    eventMode: "none",
    interactiveChildren: false,
    cullableChildren: false,
  });
  private readonly figures = new Map<string, WalkerSprite>();
  private readonly paintings = new Map<string, Sprite>();
  private readonly clues = new Map<string, Sprite>();

  constructor(
    private readonly atlas: AtlasTextures,
    private readonly clueTextures: ReadonlyMap<string, Texture> = new Map(),
    private readonly figureTextures: ReadonlyMap<string, Texture> = new Map(),
  ) {}

  add(walker: WalkerSprite): void {
    this.root.addChild(walker.sprite);
  }

  /** Figures are keyed by id so the heartbeat can move them without rebuilding anything. */
  syncFigures(
    figures: readonly FigureState[],
    tileSize: number,
    world?: WorldState,
  ): void {
    const seen = new Set<string>();

    for (const figure of figures) {
      seen.add(figure.id);
      const room = world?.roomById.get(figure.roomId);
      const ox = room ? originX(room) : 0;
      const oy = room ? originY(room) : 0;
      const x = (ox + figure.x) * tileSize + tileSize / 2;
      const y = (oy + figure.y) * tileSize + tileSize;
      const painting = this.figureTextures.get(figure.id);
      if (painting) {
        const walker = this.figures.get(figure.id);
        if (walker) {
          walker.destroy();
          this.figures.delete(figure.id);
        }
        let sprite = this.paintings.get(figure.id);
        if (!sprite) {
          sprite = new Sprite({
            texture: painting,
            anchor: { x: 0.5, y: 0.9 },
            roundPixels: true,
            eventMode: "none",
            label: `figure-art:${figure.id}`,
          });
          this.paintings.set(figure.id, sprite);
          this.root.addChild(sprite);
        }
        const scale = Math.min(
          FIGURE_ART_HEIGHT / Math.max(1, painting.height),
          FIGURE_ART_WIDTH / Math.max(1, painting.width),
        );
        sprite.scale.set(scale);
        sprite.x = Math.round(x);
        sprite.y = Math.round(y);
        sprite.zIndex = Math.round(y);
        continue;
      }
      let walker = this.figures.get(figure.id);
      if (!walker) {
        walker = new WalkerSprite(this.atlas, `figure_${figure.archetypeId}`);
        this.figures.set(figure.id, walker);
        this.root.addChild(walker.sprite);
      }
      walker.update(
        x,
        y,
        figure.facing,
        figure.walking ? Math.floor(figure.walkTime * 5) : 0,
      );
    }

    for (const [id, walker] of this.figures) {
      if (seen.has(id)) continue;
      walker.destroy();
      this.figures.delete(id);
    }
    for (const [id, sprite] of this.paintings) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.paintings.delete(id);
    }
  }

  /** RD clue PNGs sit above the generic prop tile and move with heartbeat patches. */
  syncInterests(
    interests: readonly InterestState[],
    tileSize: number,
    world?: WorldState,
  ): void {
    const seen = new Set<string>();
    for (const interest of interests) {
      if (!interest.clueId) continue;
      const texture = this.clueTextures.get(interest.clueId);
      if (!texture) continue;
      seen.add(interest.id);
      let sprite = this.clues.get(interest.id);
      if (!sprite) {
        sprite = new Sprite({
          texture,
          anchor: { x: 0.5, y: 0.82 },
          roundPixels: true,
          eventMode: "none",
        });
        this.clues.set(interest.id, sprite);
        this.root.addChild(sprite);
      }
      const room = world?.roomById.get(interest.roomId);
      const ox = room ? originX(room) : 0;
      const oy = room ? originY(room) : 0;
      sprite.x = (ox + interest.x) * tileSize + tileSize / 2;
      sprite.y = (oy + interest.y) * tileSize + tileSize;
      sprite.zIndex = sprite.y - 1;
    }
    for (const [id, sprite] of this.clues) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.clues.delete(id);
    }
  }

  destroy(): void {
    for (const walker of this.figures.values()) walker.destroy();
    this.figures.clear();
    for (const sprite of this.paintings.values()) sprite.destroy();
    this.paintings.clear();
    for (const sprite of this.clues.values()) sprite.destroy();
    this.clues.clear();
    this.root.destroy({ children: true });
  }
}
