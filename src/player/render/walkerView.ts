/**
 * Sprites for anyone who walks: the sanitar and the figures of the dream.
 *
 * Frames come out of the atlas by name, in the spelling `tools/lord/art/silhouettes.ts`
 * writes them. Sprites are anchored at the feet so that sorting by Y puts whoever is
 * lower in the room in front, which is the whole of depth in a top-down view.
 */

import { Container, Sprite, type Texture } from "pixi.js";

import type { Direction } from "../../shared/roomGrid";
import type { AtlasTextures } from "./atlasTextures";
import { originX, originY } from "../../shared/street";
import type { FigureState, InterestState, WorldState } from "../game/world";

export type { Direction };

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

  constructor(
    private readonly atlas: AtlasTextures,
    private readonly prefix: string,
  ) {
    const first = this.textureFor("s", 0);
    this.sprite = new Sprite({
      texture: first,
      // Feet at the position, not the middle of the body.
      anchor: { x: 0.5, y: 0.9 },
      roundPixels: true,
      eventMode: "none",
    });
  }

  private textureFor(dir: Direction, frame: number): Texture {
    const name = frameName(this.prefix, dir, frame);
    const texture = this.atlas.frames.get(name);
    if (!texture) throw new Error(`atlas has no frame "${name}"`);
    return texture;
  }

  update(x: number, y: number, dir: Direction, frame: number): void {
    if (
      x === this.lastX &&
      y === this.lastY &&
      dir === this.lastDir &&
      frame === this.lastFrame
    ) {
      return;
    }
    this.lastX = x;
    this.lastY = y;
    this.lastDir = dir;
    this.lastFrame = frame;

    this.sprite.x = Math.round(x);
    this.sprite.y = Math.round(y);
    // Sorting key: whoever stands lower draws in front.
    this.sprite.zIndex = Math.round(y);

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
 * Authored paintings keep their source pixels. The camera zooms the stage, so the
 * sprite is scaled by `1/zoom` and lands on screen at the PNG's own size — not
 * downscaled into mud and not blown up with the tiles.
 */

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
    zoom = 1,
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
        sprite.scale.set(1 / Math.max(1, zoom));
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
