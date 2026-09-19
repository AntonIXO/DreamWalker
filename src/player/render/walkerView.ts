/**
 * Sprites for anyone who walks: the sanitar and the figures of the dream.
 *
 * Frames come out of the atlas by name, in the spelling `tools/lord/art/silhouettes.ts`
 * writes them. Sprites are anchored at the feet so that sorting by Y puts whoever is
 * lower in the room in front, which is the whole of depth in a top-down view.
 */

import { Container, Rectangle, Sprite, Texture } from "pixi.js";

import type { SpriteSheetRef } from "../../shared/content";
import type { Direction } from "../../shared/roomGrid";
import { WALK_STRIDE } from "../../shared/roomWalk";
import type { AtlasTextures } from "./atlasTextures";
import { originX, originY } from "../../shared/street";
import { actorKey, type WorldObjectState } from "../../shared/world-object";
import type { FigureState, InterestState, WorldState } from "../game/world";

export type { Direction };

/** Cut-out walk cycle that replaces the atlas silhouette for one character. */
export interface AuthoredWalk {
  /** Front idle at [0], then front walk frames. */
  south: readonly Texture[];
  /** Profile walk, facing east. West is this set flipped. */
  east: readonly Texture[];
  /** West can be authored independently; otherwise east is mirrored. */
  west?: readonly Texture[];
  /** Back idle at [0], then back walk frames. */
  north?: readonly Texture[];
  /** Sprite height in world pixels. Texture is scaled to this. */
  worldHeight: number;
  /** Normalized foot line measured from the generated sheet. */
  anchorY?: number;
}

/** Slice one generated sheet into lightweight textures sharing the same GPU source. */
export function authoredWalkFromSheet(
  sheet: Texture,
  ref: SpriteSheetRef,
  worldHeight: number,
): AuthoredWalk {
  const expectedWidth = ref.frameW * ref.frames;
  const expectedHeight = ref.frameH * ref.dirs.length;
  if (
    sheet.source.width !== expectedWidth ||
    sheet.source.height !== expectedHeight
  ) {
    throw new Error(
      `sprite sheet ${sheet.source.width}x${sheet.source.height}, expected ${expectedWidth}x${expectedHeight}`,
    );
  }
  const byDirection = new Map<Direction, Texture[]>();
  ref.dirs.forEach((rawDirection, row) => {
    if (!["n", "e", "s", "w"].includes(rawDirection)) {
      throw new Error(`sprite sheet has unknown direction ${rawDirection}`);
    }
    const direction = rawDirection as Direction;
    const frames = Array.from(
      { length: ref.frames },
      (_, column) =>
        new Texture({
          source: sheet.source,
          frame: new Rectangle(
            column * ref.frameW,
            row * ref.frameH,
            ref.frameW,
            ref.frameH,
          ),
          label: `${sheet.label ?? "figure-sheet"}:${direction}:${column}`,
        }),
    );
    byDirection.set(direction, frames);
  });

  const south = byDirection.get("s") ?? [];
  const east = byDirection.get("e") ?? [];
  if (south.length === 0 || east.length === 0) {
    throw new Error("sprite sheet needs south and east rows");
  }
  return {
    south,
    east,
    north: byDirection.get("n"),
    west: byDirection.get("w"),
    worldHeight,
    anchorY: ref.anchorY,
  };
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
      anchor: { x: 0.5, y: this.authored?.anchorY ?? 0.9 },
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
    const directional =
      dir === "n"
        ? walk.north
        : dir === "e"
          ? walk.east
          : dir === "w"
            ? (walk.west ?? walk.east)
            : walk.south;
    const idle = directional?.[0] ?? walk.south[0];
    if (!idle) return this.textureFor(dir, 0);
    if (!moving) return idle;
    const north = walk.north ?? [];
    const sheet =
      dir === "e" || dir === "w"
        ? (dir === "w" ? walk.west : walk.east)?.length
          ? (dir === "w" ? walk.west : walk.east)!
          : walk.east.length > 0
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
      this.applyAuthoredScale(dir === "w" && !this.authored.west?.length);
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

export interface HolderPose {
  roomId: string;
  x: number;
  y: number;
}

export interface LiveObjectPlacement {
  id: string;
  roomId: string;
  x: number;
  y: number;
  held: boolean;
  image: string | null;
  role: string | null;
  clueId: string | null;
}

/**
 * Carryable/movable objects on the live layer. Fixed furniture stays on the baked
 * prop layer. Held things follow the holder — drawn at their feet, not hidden.
 */
export function liveObjectPlacements(
  objects: readonly WorldObjectState[],
  holders: ReadonlyMap<string, HolderPose>,
): LiveObjectPlacement[] {
  const out: LiveObjectPlacement[] = [];
  for (const object of objects) {
    if (object.mobility === "fixed") continue;
    if (object.location.kind === "room") {
      out.push({
        id: object.id,
        roomId: object.location.roomId,
        x: object.location.x,
        y: object.location.y,
        held: false,
        image: object.visual.image,
        role: object.visual.role,
        clueId: object.clueId,
      });
      continue;
    }
    if (object.location.kind !== "held") continue;
    const pose = holders.get(actorKey(object.location.actor));
    if (!pose) continue;
    out.push({
      id: object.id,
      roomId: pose.roomId,
      x: pose.x,
      y: pose.y,
      held: true,
      image: object.visual.image,
      role: object.visual.role,
      clueId: object.clueId,
    });
  }
  return out;
}

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
  private readonly objects = new Map<string, Sprite>();
  private readonly texturesByImage = new Map<string, Texture>();

  constructor(
    private readonly atlas: AtlasTextures,
    private readonly clueTextures: ReadonlyMap<string, Texture> = new Map(),
    private readonly figureTextures: ReadonlyMap<string, Texture> = new Map(),
    private readonly objectTextures: ReadonlyMap<string, Texture> = new Map(),
    private readonly figureWalks: ReadonlyMap<string, AuthoredWalk> = new Map(),
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
      const authoredWalk = this.figureWalks.get(figure.id);
      const painting = authoredWalk
        ? undefined
        : this.figureTextures.get(figure.id);
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
        walker = new WalkerSprite(
          this.atlas,
          `figure_${figure.archetypeId}`,
          authoredWalk,
        );
        this.figures.set(figure.id, walker);
        this.root.addChild(walker.sprite);
      }
      walker.update(
        x,
        y,
        figure.facing,
        figure.walking ? Math.floor(figure.walkTime * 5) : 0,
        figure.walking,
        figure.walkTime * WALK_STRIDE * 4,
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

  /**
   * Carryable/movable sprites. Does not rebuild the room mesh — take/drop only
   * moves these nodes.
   */
  syncLiveObjects(
    placements: readonly LiveObjectPlacement[],
    tileSize: number,
    world?: WorldState,
  ): void {
    const seen = new Set<string>();
    for (const placement of placements) {
      const room = world?.roomById.get(placement.roomId);
      const texture = this.textureForObject(placement, world);
      if (!texture) continue;
      seen.add(placement.id);
      let sprite = this.objects.get(placement.id);
      if (!sprite) {
        sprite = new Sprite({
          texture,
          anchor: { x: 0.5, y: 0.9 },
          roundPixels: true,
          eventMode: "none",
          label: `live-object:${placement.id}`,
        });
        const box = tileSize;
        sprite.setSize(box, box);
        this.objects.set(placement.id, sprite);
        this.root.addChild(sprite);
      } else if (sprite.texture !== texture) {
        sprite.texture = texture;
        sprite.setSize(tileSize, tileSize);
      }
      const ox = room ? originX(room) : 0;
      const oy = room ? originY(room) : 0;
      const heldNudge = placement.held ? tileSize * 0.15 : 0;
      sprite.x = (ox + placement.x) * tileSize + tileSize / 2 + heldNudge;
      sprite.y = (oy + placement.y) * tileSize + tileSize;
      sprite.zIndex = Math.round(sprite.y);
    }
    for (const [id, sprite] of this.objects) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.objects.delete(id);
    }
  }

  private textureForObject(
    placement: LiveObjectPlacement,
    world?: WorldState,
  ): Texture | undefined {
    // Loaded PNGs are keyed by their authored room. Carrying an object elsewhere
    // changes its pose, never the source of its art.
    if (placement.image) {
      const cached = this.texturesByImage.get(placement.image);
      if (cached) return cached;
      for (const room of world?.artifact.rooms ?? []) {
        for (const prop of room.props) {
          if (prop.image !== placement.image) continue;
          const texture = this.objectTextures.get(`${room.id}:${prop.id}`);
          if (!texture) continue;
          this.texturesByImage.set(placement.image, texture);
          return texture;
        }
      }
    }
    const direct =
      this.objectTextures.get(`${placement.roomId}:${placement.id}`) ??
      this.objectTextures.get(placement.id);
    if (direct) return direct;

    const clue = placement.clueId
      ? this.clueTextures.get(placement.clueId)
      : undefined;
    if (clue) return clue;
    return (
      this.atlas.roles.get(placement.role ?? "prop")?.[0] ??
      this.atlas.roles.get("prop")?.[0]
    );
  }

  destroy(): void {
    for (const walker of this.figures.values()) walker.destroy();
    this.figures.clear();
    for (const sprite of this.paintings.values()) sprite.destroy();
    this.paintings.clear();
    for (const sprite of this.clues.values()) sprite.destroy();
    this.clues.clear();
    for (const sprite of this.objects.values()) sprite.destroy();
    this.objects.clear();
    this.root.destroy({ children: true });
  }
}
