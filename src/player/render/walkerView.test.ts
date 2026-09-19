import { describe, expect, test } from "bun:test";
import { Texture, TextureSource } from "pixi.js";

import { WALK_STRIDE } from "../../shared/roomWalk";
import type { AtlasTextures } from "./atlasTextures";
import { authoredWalkFromSheet, WalkerSprite } from "./walkerView";

const ref = {
  path: "assets/sprites/test.png",
  frameW: 48,
  frameH: 48,
  dirs: ["s", "w", "n", "e"],
  frames: 2,
  anchorY: 0.9,
};

describe("authored figure sheets", () => {
  test("uses the measured per-sheet direction order", () => {
    const source = new TextureSource({ width: 96, height: 192 });
    const sheet = new Texture({ source, label: "test-sheet" });
    const walk = authoredWalkFromSheet(sheet, ref, 34);

    expect(walk.south[0]!.frame.y).toBe(0);
    expect(walk.west?.[0]!.frame.y).toBe(48);
    expect(walk.north?.[0]!.frame.y).toBe(96);
    expect(walk.east[0]!.frame.y).toBe(144);
    expect(walk.east[1]!.frame.x).toBe(48);
  });

  test("freezes on directional idle and advances only while moving", () => {
    const source = new TextureSource({ width: 96, height: 192 });
    const sheet = new Texture({ source, label: "test-sheet" });
    const walk = authoredWalkFromSheet(sheet, ref, 34);
    const sprite = new WalkerSprite({} as AtlasTextures, "unused", walk);

    sprite.update(10, 20, "w", 0, false, 0);
    expect(sprite.sprite.texture).toBe(walk.west![0]!);
    sprite.update(10, 20, "w", 1, true, WALK_STRIDE);
    expect(sprite.sprite.texture).toBe(walk.west![1]!);
    expect(sprite.sprite.scale.x).toBeGreaterThan(0);
  });

  test("rejects a sheet whose geometry disagrees with its manifest", () => {
    const source = new TextureSource({ width: 48, height: 48 });
    const sheet = new Texture({ source });
    expect(() => authoredWalkFromSheet(sheet, ref, 34)).toThrow(
      /expected 96x192/,
    );
  });

  test("changing clothes invalidates cached frames without changing position or disposing shared art", () => {
    const first = authoredWalkFromSheet(
      new Texture({ source: new TextureSource({ width: 96, height: 192 }) }),
      ref,
      34,
    );
    const other = authoredWalkFromSheet(
      new Texture({ source: new TextureSource({ width: 96, height: 192 }) }),
      ref,
      36,
    );
    const walker = new WalkerSprite({} as AtlasTextures, "player", first);
    for (const dir of ["s", "w", "n", "e"] as const) {
      walker.setAppearance("player", first);
      walker.update(12, 24, dir, 0);
      walker.setAppearance("figure_role", other);
      walker.update(12, 24, dir, 0);
      const texture =
        dir === "s"
          ? other.south[0]
          : dir === "n"
            ? other.north![0]
            : dir === "e"
              ? other.east[0]
              : other.west![0];
      expect(walker.sprite.texture).toBe(texture!);
      expect(walker.sprite.x).toBe(12);
      expect(walker.sprite.y).toBe(24);
    }
    walker.setPosture("lying");
    expect(walker.sprite.rotation).not.toBe(0);
    walker.setPosture("lying", true);
    expect(walker.sprite.alpha).toBe(0);
    walker.setPosture("standing");
    expect(walker.sprite.rotation).toBe(0);
    expect(walker.sprite.alpha).toBe(1);
    walker.destroy();
    expect(other.south[0]!.destroyed).toBe(false);
  });
});
