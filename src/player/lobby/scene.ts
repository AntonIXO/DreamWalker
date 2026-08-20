/**
 * Draws the procedure room with atlas floor/wall tiles and furniture.
 *
 * Layout follows the hand sketch (`room.png`): north desk / cross / locker / terminal /
 * ward doors, south bed / drip / apparatus / carpet. Furniture is Graphics so a later
 * artist can swap a piece without touching hotspot logic. `cacheAsTexture` is nearest
 * so the drawings stay as crisp as the tiles once the camera zooms them.
 */

import { Container, Graphics, Sprite } from "pixi.js";

import { variantFor, type AtlasTextures } from "../render/atlasTextures";
import { cellAt } from "./definition";
import { prefersReducedMotion } from "./motion";
import { lobbyColors, type LobbyColors } from "./palette";
import type { DreamArtifact } from "../../shared/dream";
import type { FurnitureKind, LobbyDefinition } from "./types";

export class LobbyScene {
  readonly root: Container;
  private readonly furniture: Container;
  private readonly actors: Container;
  private readonly terminalLed: Graphics;
  private readonly apparatusLed: Graphics;
  private readonly colors: LobbyColors;
  private pulse = 0;
  private mindReady = false;
  private authorizing = false;
  private reduced = prefersReducedMotion();

  constructor(
    private readonly definition: LobbyDefinition,
    artifact: DreamArtifact,
    atlas: AtlasTextures,
  ) {
    this.colors = lobbyColors(artifact);
    this.root = new Container({
      label: "lobby",
      isRenderGroup: true,
      eventMode: "none",
      interactiveChildren: false,
      sortableChildren: true,
    });

    const tiles = this.drawTiles(atlas);
    tiles.zIndex = 0;
    this.root.addChild(tiles);

    this.furniture = new Container({
      label: "lobby-furniture",
      eventMode: "none",
      sortableChildren: true,
    });
    this.furniture.zIndex = 1;
    this.root.addChild(this.furniture);

    this.terminalLed = new Graphics({ eventMode: "none", roundPixels: true });
    this.apparatusLed = new Graphics({ eventMode: "none", roundPixels: true });
    const signals = new Container({
      label: "lobby-signals",
      eventMode: "none",
    });
    signals.zIndex = 3;

    for (const piece of definition.furniture) {
      const node = this.drawFurniture(piece.kind, piece.w, piece.h);
      node.x = piece.x * definition.tileSize;
      node.y = piece.y * definition.tileSize;
      node.zIndex =
        piece.y * definition.tileSize + piece.h * definition.tileSize;
      node.eventMode = "none";
      this.furniture.addChild(node);
      if (piece.kind === "terminal") {
        this.terminalLed.x = piece.x * definition.tileSize;
        this.terminalLed.y = piece.y * definition.tileSize;
        signals.addChild(this.terminalLed);
      }
      if (piece.kind === "apparatus") {
        this.apparatusLed.x = piece.x * definition.tileSize;
        this.apparatusLed.y = piece.y * definition.tileSize;
        signals.addChild(this.apparatusLed);
      }
    }

    this.furniture.cacheAsTexture({
      scaleMode: "nearest",
      resolution: 1,
      antialias: false,
    });

    this.root.addChild(signals);

    this.actors = new Container({
      label: "lobby-actors",
      sortableChildren: true,
      eventMode: "none",
      interactiveChildren: false,
    });
    this.actors.zIndex = 2;
    this.root.addChild(this.actors);

    this.paintLeds();
  }

  get actorLayer(): Container {
    return this.actors;
  }

  setMind(ready: boolean, authorizing: boolean): void {
    this.mindReady = ready;
    this.authorizing = authorizing;
  }

  update(deltaSeconds: number): void {
    this.pulse += deltaSeconds;
    this.paintLeds();
  }

  private paintLeds(): void {
    const size = this.definition.tileSize;
    this.terminalLed.clear();
    this.apparatusLed.clear();

    const waitBlink = this.authorizing
      ? this.reduced
        ? 0.55
        : 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(this.pulse * 5))
      : this.mindReady
        ? 1
        : this.reduced
          ? 0.25
          : 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(this.pulse * 2.2));
    this.terminalLed
      .rect(size + 6, 10, 4, 3)
      .fill({ color: this.colors.screen, alpha: waitBlink });

    if (this.mindReady) {
      const beat = this.reduced
        ? 0.8
        : 0.25 + 0.75 * Math.max(0, Math.sin(this.pulse * 1.4));
      this.apparatusLed
        .rect(size - 2, 2, 3, 3)
        .fill({ color: this.colors.blood, alpha: beat });
    } else {
      this.apparatusLed.rect(size - 2, 2, 3, 3).fill({
        color: this.colors.metal,
        alpha: 0.6,
      });
    }
  }

  private drawTiles(atlas: AtlasTextures): Container {
    const layer = new Container({ label: "lobby-tiles", eventMode: "none" });
    const size = this.definition.tileSize;
    const { width, height } = this.definition;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = cellAt(this.definition, x, y);
        if (cell === "void") continue;
        const role =
          cell === "wall"
            ? "wall"
            : cell === "wallFace"
              ? "wallFace"
              : cell === "threshold"
                ? "threshold"
                : cell === "floorAlt"
                  ? "floorAlt"
                  : "floor";
        const textures = atlas.roles.get(role);
        if (textures && textures.length > 0) {
          const sprite = new Sprite({
            texture: variantFor(textures, x, y),
            x: x * size,
            y: y * size,
            roundPixels: true,
            eventMode: "none",
          });
          layer.addChild(sprite);
        } else {
          const fallback = new Graphics({
            eventMode: "none",
            roundPixels: true,
          });
          const fill =
            cell === "wall"
              ? this.colors.wall
              : cell === "wallFace"
                ? this.colors.wallFace
                : cell === "threshold"
                  ? this.colors.floorAlt
                  : cell === "floorAlt"
                    ? this.colors.floorAlt
                    : this.colors.floor;
          fallback.rect(x * size, y * size, size, size).fill(fill);
          layer.addChild(fallback);
        }
      }
    }

    return layer;
  }

  private drawFurniture(kind: FurnitureKind, w: number, h: number): Container {
    const size = this.definition.tileSize;
    const pw = w * size;
    const ph = h * size;
    const g = new Graphics({ eventMode: "none", roundPixels: true });
    const c = this.colors;

    if (kind === "desk") {
      // North bench: slab, two objects on it, APOTHEOSIS along the front.
      g.rect(0, 8, pw, ph - 8).fill(c.metal);
      g.rect(1, 9, pw - 2, 6).fill(c.paper);
      g.rect(1, ph - 4, pw - 2, 3).fill(c.ink);
      g.rect(4, 14, 10, 8).fill(c.rust);
      g.rect(5, 15, 8, 6).fill(c.screenDim);
      g.rect(18, 13, 9, 10).fill(c.linen);
      g.rect(20, 10, 5, 5).fill(c.accent);
      g.rect(36, 15, 12, 7).fill(c.paper);
      g.rect(37, 16, 10, 5).fill(c.screen);
      stamp(g, 4, ph - 11, "APOTHEOSIS", c.paper);
    } else if (kind === "cross") {
      g.rect(1, 2, pw - 2, ph - 2).fill(c.paper);
      g.rect(2, 3, pw - 4, ph - 4).fill(c.linen);
      g.rect(pw / 2 - 2, 5, 4, ph - 8).fill(c.blood);
      g.rect(5, ph / 2 - 1, pw - 10, 4).fill(c.blood);
    } else if (kind === "locker") {
      g.rect(1, 0, pw - 2, ph).fill(c.ink);
      g.rect(2, 1, pw - 4, ph - 2).fill(c.metal);
      g.rect(4, 4, pw - 8, 9).fill(c.paper);
      g.rect(4, 15, pw - 8, 12).fill(c.paper);
      g.rect(pw - 7, 10, 2, 4).fill(c.ink);
    } else if (kind === "terminal") {
      g.rect(1, 6, pw - 2, ph - 6).fill(c.ink);
      g.rect(3, 10, pw - 6, 16).fill(c.screenDim);
      g.rect(4, 11, pw - 8, 12).fill(c.screen);
      g.rect(6, ph - 6, pw - 12, 3).fill(c.metal);
      stamp(g, 6, 2, "KOH", c.paper);
    } else if (kind === "ward-doors") {
      g.rect(0, 0, pw, ph).fill(c.ink);
      g.rect(1, 2, Math.floor(pw / 2) - 2, ph - 4).fill(c.linen);
      g.rect(Math.ceil(pw / 2) + 1, 2, Math.floor(pw / 2) - 3, ph - 4).fill(
        c.linen,
      );
      g.rect(3, ph / 2, 2, 3).fill(c.ink);
      g.rect(pw - 5, ph / 2, 2, 3).fill(c.ink);
      stamp(g, -18, 3, "PALATA", c.ink);
    } else if (kind === "bed") {
      g.rect(0, 6, pw, ph - 6).fill(c.metal);
      g.rect(2, 8, pw - 4, ph - 10).fill(c.paper);
      g.rect(4, 12, pw - 16, 10).fill(c.linen);
      g.rect(pw - 14, 11, 10, 10).fill(c.skin);
      g.rect(pw - 13, 12, 8, 4).fill(c.paper);
      g.rect(2, 8, pw - 4, 3).fill(c.ink);
    } else if (kind === "apparatus") {
      g.rect(2, 14, pw - 4, ph - 16).fill(c.metal);
      g.rect(6, 4, pw - 12, 16).fill(c.ink);
      g.rect(8, 6, pw - 16, 12).fill(c.screen);
      g.rect(1, 20, 5, 12).fill(c.rust);
      g.rect(pw - 6, 18, 5, 14).fill(c.rust);
    } else if (kind === "drip") {
      g.rect(size / 2 - 1, 0, 2, ph).fill(c.metal);
      g.rect(2, 0, size - 4, 4).fill(c.metal);
      g.rect(size / 2 - 3, 6, 6, 8).fill(c.paper);
      g.rect(size / 2, 14, 1, 8).fill(c.screen);
    } else if (kind === "carpet") {
      g.rect(0, 0, pw, ph).fill(c.ink);
      g.rect(1, 1, pw - 2, ph - 2).fill(c.rust);
      g.rect(4, 3, pw - 8, ph - 6).fill(c.accent);
      g.rect(8, 6, pw - 16, ph - 12).fill(c.rust);
    } else if (kind === "plaque") {
      g.rect(0, 2, pw, 11).fill(c.metal);
      g.rect(1, 3, pw - 2, 9).fill(c.paper);
      stamp(g, 4, 5, this.definition.copy.plaque ?? "DREAM WALKER", c.ink);
    } else if (kind === "gonzo") {
      g.rect(2, 4, 11, 9).fill(c.accent);
      g.rect(3, 5, 9, 3).fill(c.paper);
      g.rect(4, 9, 7, 2).fill(c.rust);
    }
    return g;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/** Tiny 3×5 caps so a wall stamp stays pixel art instead of a Pixi Text blur. */
function stamp(
  g: Graphics,
  x: number,
  y: number,
  text: string,
  color: number,
): void {
  const glyphs: Record<string, string[]> = {
    A: ["010", "101", "111", "101", "101"],
    D: ["110", "101", "101", "101", "110"],
    E: ["111", "100", "110", "100", "111"],
    H: ["101", "101", "111", "101", "101"],
    I: ["111", "010", "010", "010", "111"],
    K: ["101", "101", "110", "101", "101"],
    L: ["100", "100", "100", "100", "111"],
    M: ["101", "111", "101", "101", "101"],
    N: ["101", "111", "111", "101", "101"],
    O: ["010", "101", "101", "101", "010"],
    P: ["110", "101", "110", "100", "100"],
    R: ["110", "101", "110", "101", "101"],
    S: ["011", "100", "010", "001", "110"],
    T: ["111", "010", "010", "010", "010"],
    U: ["101", "101", "101", "101", "010"],
    W: ["101", "101", "101", "111", "101"],
    " ": ["000", "000", "000", "000", "000"],
  };
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = glyphs[raw] ?? glyphs.A!;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row]![col] === "1") {
          g.rect(cursor + col, y + row, 1, 1).fill(color);
        }
      }
    }
    cursor += 4;
  }
}
