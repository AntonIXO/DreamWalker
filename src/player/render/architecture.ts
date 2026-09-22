import {
  Container,
  Graphics,
  Sprite,
  TilingSprite,
  type Texture,
} from "pixi.js";
import { cellAt, isWalkableCell } from "../../shared/roomGrid";
import type { RoomState } from "../game/world";

export const hasArchitecture = (room: Pick<RoomState, "tags">): boolean =>
  room.tags.some((tag) => tag.startsWith("architecture:"));

/** The same cells clip the floor painting and stop the player's feet. */
export function floorMask(room: RoomState): Graphics {
  const mask = new Graphics({ eventMode: "none" });
  const s = room.tileSize;
  for (let y = 0; y < room.height; y++) {
    let start = -1;
    for (let x = 0; x <= room.width; x++) {
      const inside = x < room.width && cellAt(room, x, y) !== "void";
      if (inside && start < 0) start = x;
      if (!inside && start >= 0) {
        mask.rect(start * s, y * s, (x - start) * s, s);
        start = -1;
      }
    }
  }
  return mask.fill(0xffffff);
}

/** Low, continuous plaster walls. No unrelated atlas bricks over the painting. */
export function drawArchitecture(
  room: RoomState,
  art: ReadonlyMap<string, Texture> = new Map(),
): Container {
  const layer = new Container({
    label: `architecture:${room.id}`,
    eventMode: "none",
  });
  const g = new Graphics({ eventMode: "none" });
  const s = room.tileSize;
  const outdoor = room.tags.includes("material:0");
  const clinical = room.tags.includes("material:3");
  const cap = outdoor ? 0x737666 : clinical ? 0xb1bca5 : 0xc2ae87;
  const face = outdoor ? 0x484e43 : clinical ? 0x637e74 : 0x7c7461;
  const dark = 0x343d37;
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const cell = cellAt(room, x, y);
      if (cell !== "wall" && cell !== "wallFace" && cell !== "tree") continue;
      const px = x * s;
      const py = y * s;
      const below = isWalkableCell(cellAt(room, x, y + 1));
      g.rect(px, py, s, s).fill(face);
      g.rect(px, py, s, below ? s * 0.42 : s).fill(cap);
      if (below) {
        g.rect(px, py + s - 2, s, 2).fill(dark);
        g.rect(px + 2, py + s, s, 3).fill({ color: dark, alpha: 0.2 });
        g.rect(px, py + s * 0.42, s, 1).fill({ color: 0xe8ddbd, alpha: 0.55 });
      }
      if (cellAt(room, x - 1, y) === "void") g.rect(px, py, 2, s).fill(dark);
      if (cellAt(room, x + 1, y) === "void")
        g.rect(px + s - 2, py, 2, s).fill(dark);
      if (outdoor && !art.has("hedge") && (x + y) % 3 === 0) {
        g.ellipse(px + s * 0.5, py + s * 0.4, s * 0.62, s * 0.38).fill(
          0x47543b,
        );
        g.ellipse(px + s * 0.35, py + s * 0.25, s * 0.38, s * 0.24).fill(
          0x788060,
        );
      }
    }
  }
  layer.addChild(g);
  const wall = art.get("wall");
  const hedge = art.get("hedge");
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const cell = cellAt(room, x, y);
      if (cell !== "wall" && cell !== "wallFace") continue;
      if (wall) {
        let end = x + 1;
        while (
          end < room.width &&
          ["wall", "wallFace"].includes(cellAt(room, end, y))
        )
          end++;
        const strip = new TilingSprite({
          texture: wall,
          x: x * s,
          y: y * s,
          width: (end - x) * s,
          height: s,
          tileScale: { x: (3 * s) / wall.width, y: s / wall.height },
          eventMode: "none",
        });
        layer.addChild(strip);
        // Foliage belongs on the low border, not on traversable ground.
        if (outdoor && hedge)
          for (let shrub = x; shrub < end; shrub += 3) {
            if ((shrub + y) % 2 !== 0) continue;
            const leaf = new Sprite({
              texture: hedge,
              x: (shrub + 0.5) * s,
              y: (y + 0.9) * s,
              anchor: { x: 0.5, y: 1 },
              eventMode: "none",
            });
            leaf.setSize(s * 1.6, s * 1.35);
            layer.addChild(leaf);
          }
        x = end - 1;
      } else if (outdoor && hedge && (x + y) % 3 === 0) {
        const sprite = new Sprite({
          texture: hedge,
          x: (x + 0.5) * s,
          y: (y + 0.8) * s,
          anchor: { x: 0.5, y: 1 },
          eventMode: "none",
        });
        sprite.setSize(s * 1.6, s * 1.35);
        layer.addChild(sprite);
      }
    }
  }
  // Water is a surface with a real, authored collision rectangle, never a generic
  // placeholder enlarged twelve tiles across the pool.
  for (const prop of room.props.filter((prop) => prop.role === "water")) {
    const x = prop.x * s,
      y = prop.y * s,
      w = prop.w * s,
      h = prop.h * s;
    const pool = new Graphics({ eventMode: "none" });
    pool.rect(x, y, w, h).fill(0xb9c7b4);
    pool.rect(x + 2, y + 2, w - 4, h - 4).fill(0x365d61);
    pool.rect(x + 4, y + 4, w - 8, h - 8).fill(0x598b86);
    for (let yy = y + 8; yy < y + h - 5; yy += 8)
      for (let xx = x + 8; xx < x + w - 5; xx += 18) {
        pool
          .moveTo(xx, yy)
          .lineTo(xx + 7, yy - 1)
          .stroke({ color: 0xa4c8b5, width: 0.7, alpha: 0.3 });
      }
    layer.addChild(pool);
  }
  return layer;
}

/** Curved route masks read as paths bordered by plants, not isolated square tiles. */
export function drawPassage(
  room: RoomState,
  art: ReadonlyMap<string, Texture> = new Map(),
): Container {
  const layer = new Container({
    label: `passage:${room.id}`,
    eventMode: "none",
  });
  const g = new Graphics({ eventMode: "none" });
  const s = room.tileSize;
  const arcade = room.tags.includes("passage:arcade");
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const cell = cellAt(room, x, y);
      if (cell === "void") continue;
      const walk = isWalkableCell(cell);
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => isWalkableCell(cellAt(room, x + dx!, y + dy!)));
      if (!walk && !near) continue;
      const px = x * s;
      const py = y * s;
      const seed = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (walk) {
        const path = cell === "path" || cell === "threshold";
        g.rect(px, py, s, s).fill(
          path ? (arcade ? 0xa59b83 : 0x89836b) : 0x53644a,
        );
        if (path) {
          g.rect(px + 1, py + s - 1, s - 2, 1).fill({
            color: 0x333f35,
            alpha: 0.14,
          });
          if (seed % 3 === 0)
            g.rect(px + 3, py + 5, s - 7, 1).fill({
              color: 0xe0d3ad,
              alpha: 0.24,
            });
        } else {
          for (let i = 0; i < 3; i++)
            g.rect(
              px + ((seed >> (i * 3)) % 13),
              py + ((seed >> (i * 4)) % 13),
              1,
              3,
            ).fill(0x88916a);
        }
      } else if (arcade) {
        g.rect(px, py, s, s).fill(0x4a554c);
        g.rect(px, py, s, s * 0.42).fill(0xa7aa91);
        if ((x + y) % 5 === 0) {
          g.rect(px + 5, py + 3, 6, 3).fill(0xe4c78c);
          g.ellipse(px + 8, py + 9, 10, 8).fill({
            color: 0xe4c78c,
            alpha: 0.08,
          });
        }
      } else if (!art.has("hedge")) {
        g.ellipse(px + 8, py + 10, 10, 8).fill({
          color: 0x1c2d27,
          alpha: 0.55,
        });
        g.ellipse(px + 7, py + 6, 10, 7).fill(0x394d3a);
        g.ellipse(px + 4, py + 3, 6, 4).fill(0x65704b);
        if (seed % 5 === 0) g.rect(px + 5, py + 3, 2, 2).fill(0xb59459);
      }
    }
  }
  layer.addChild(g);
  const paving = art.get(arcade ? "corridor" : "paving");
  if (paving) {
    const ground = new Container({ eventMode: "none" });
    const floor = new TilingSprite({
      texture: paving,
      width: room.width * s,
      height: room.height * s,
      tileScale: { x: (8 * s) / paving.width, y: (8 * s) / paving.height },
      alpha: 0.85,
      eventMode: "none",
    });
    const mask = new Graphics({ eventMode: "none" });
    for (let y = 0; y < room.height; y++)
      for (let x = 0; x < room.width; x++) {
        const cell = cellAt(room, x, y);
        if (cell === "path" || cell === "threshold")
          mask.rect(x * s, y * s, s, s);
      }
    mask.fill(0xffffff);
    ground.addChild(floor, mask);
    ground.mask = mask;
    layer.addChild(ground);
  }
  const wall = art.get("wall");
  if (arcade && wall) {
    const border = new Container({ eventMode: "none" });
    const skin = new TilingSprite({
      texture: wall,
      width: room.width * s,
      height: room.height * s,
      tileScale: { x: (3 * s) / wall.width, y: s / wall.height },
      eventMode: "none",
    });
    const mask = new Graphics({ eventMode: "none" });
    for (let y = 0; y < room.height; y++)
      for (let x = 0; x < room.width; x++) {
        if (cellAt(room, x, y) !== "tree") continue;
        if (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => isWalkableCell(cellAt(room, x + dx!, y + dy!)))
        )
          mask.rect(x * s, y * s, s, s);
      }
    mask.fill(0xffffff);
    border.addChild(skin, mask);
    border.mask = mask;
    layer.addChild(border);
  }
  const hedge = art.get("hedge");
  const lantern = art.get("lantern");
  for (let y = 0; y < room.height; y++)
    for (let x = 0; x < room.width; x++) {
      if (cellAt(room, x, y) !== "tree") continue;
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => isWalkableCell(cellAt(room, x + dx!, y + dy!)));
      if (!near) continue;
      const texture = arcade
        ? (x + y) % 7 === 0
          ? lantern
          : null
        : (x + y) % 2 === 0
          ? hedge
          : null;
      if (!texture) continue;
      const sprite = new Sprite({
        texture,
        x: (x + 0.5) * s,
        y: (y + 0.9) * s,
        anchor: { x: 0.5, y: 1 },
        eventMode: "none",
      });
      const height = arcade ? s * 2.4 : s * 1.7;
      sprite.scale.set(height / texture.height);
      layer.addChild(sprite);
    }
  return layer;
}

export function drawArchitecturalDoors(
  room: RoomState,
  art: ReadonlyMap<string, Texture> = new Map(),
): Container {
  const layer = new Container({ eventMode: "none" });
  const g = new Graphics({ eventMode: "none" });
  const s = room.tileSize;
  for (const door of room.doors) {
    if (door.hidden) continue;
    const x = door.x * s,
      y = door.y * s,
      w = door.w * s,
      h = door.h * s;
    const rift = door.threshold === "rift";
    const locked = door.type !== "open" && door.type !== "ledge";
    const vertical = door.w < door.h;
    if (rift || locked || door.threshold === "lift")
      g.rect(x, y, w, h).fill({
        color: rift ? 0x706081 : 0x4b5148,
        alpha: rift ? 0.75 : 1,
      });
    if (vertical) {
      g.rect(x, y, w, 2)
        .rect(x, y + h - 2, w, 2)
        .fill(0x3b4941);
      g.rect(x + Math.floor(w / 2), y + 2, 1, h - 4).fill({
        color: 0xe6d6ae,
        alpha: 0.45,
      });
    } else {
      g.rect(x, y, 3, h)
        .rect(x + w - 3, y, 3, h)
        .fill(0x3b4941);
      g.rect(x + 3, y + h - 3, w - 6, 1).fill({ color: 0xe6d6ae, alpha: 0.6 });
    }
    if (rift)
      g.rect(x + 4, y + 3, Math.max(1, w - 8), Math.max(1, h - 6)).fill({
        color: 0xd2aa96,
        alpha: 0.3,
      });
  }
  layer.addChild(g);
  const arch = art.get("arch");
  if (arch)
    for (const door of room.doors) {
      if (door.hidden || door.w < 2 || door.threshold === "lift") continue;
      if (!room.tags.includes("material:1") && door.threshold !== "rift")
        continue;
      const sprite = new Sprite({
        texture: arch,
        anchor: { x: 0.5, y: 1 },
        x: (door.x + door.w / 2) * s,
        y: (door.y + door.h) * s,
        eventMode: "none",
      });
      sprite.scale.set((door.w * s + 8) / arch.width);
      layer.addChild(sprite);
    }
  return layer;
}
