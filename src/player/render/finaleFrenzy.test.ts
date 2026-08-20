import { describe, expect, test } from "bun:test";
import { Texture } from "pixi.js";

import { FinaleFrenzy } from "./finaleFrenzy";
import type { AtlasTextures } from "./atlasTextures";

function createMockAtlas(): AtlasTextures {
  const frames = new Map<string, Texture>();
  frames.set("figure_watcher_s_0", Texture.WHITE);
  frames.set("figure_visitor_s_0", Texture.WHITE);
  frames.set("player_s_0", Texture.WHITE);
  return {
    manifest: {
      image: "atlas.png",
      tileSize: 16,
      frames: {},
      roleFrames: {},
    },
    imageUrl: "atlas.png",
    sheetWidth: 256,
    sheetHeight: 256,
    frames,
    roles: new Map(),
    tileSize: 16,
  };
}

describe("FinaleFrenzy", () => {
  test("initializes inactive", () => {
    const atlas = createMockAtlas();
    const frenzy = new FinaleFrenzy(
      atlas,
      new Map([["glaz", Texture.WHITE]]),
      {
        south: [Texture.WHITE, Texture.WHITE],
        east: [Texture.WHITE, Texture.WHITE],
        north: [Texture.WHITE, Texture.WHITE],
        worldHeight: 40,
      },
      Texture.WHITE,
      800,
      600,
    );

    expect(frenzy.isSequenceActive).toBe(false);
    expect(frenzy.isFrenzyRunning).toBe(false);
    expect(frenzy.root.visible).toBe(false);
    frenzy.destroy();
  });

  test("triggers frenzy after 20 seconds of sequence", () => {
    const atlas = createMockAtlas();
    const frenzy = new FinaleFrenzy(
      atlas,
      new Map([["glaz", Texture.WHITE]]),
      {
        south: [Texture.WHITE],
        east: [Texture.WHITE],
        worldHeight: 40,
      },
      null,
      800,
      600,
    );

    frenzy.startSequence();
    expect(frenzy.isSequenceActive).toBe(true);
    expect(frenzy.isFrenzyRunning).toBe(false);
    expect(frenzy.remainingSecondsToFrenzy).toBeCloseTo(20, 1);

    // Advance 10 seconds
    frenzy.update(10);
    expect(frenzy.isFrenzyRunning).toBe(false);
    expect(frenzy.remainingSecondsToFrenzy).toBeCloseTo(10, 1);

    // Advance remaining 10.5 seconds
    frenzy.update(10.5);
    expect(frenzy.isFrenzyRunning).toBe(true);
    expect(frenzy.root.visible).toBe(true);
    expect(frenzy.remainingSecondsToFrenzy).toBe(0);

    // Continues updating smoothly
    frenzy.update(0.1);
    expect(frenzy.isFrenzyRunning).toBe(true);

    frenzy.destroy();
  });

  test("triggerFrenzy starts frenzy immediately", () => {
    const atlas = createMockAtlas();
    const frenzy = new FinaleFrenzy(atlas, new Map(), null, null, 1024, 768);

    frenzy.triggerFrenzy();
    expect(frenzy.isSequenceActive).toBe(true);
    expect(frenzy.isFrenzyRunning).toBe(true);
    expect(frenzy.root.visible).toBe(true);

    frenzy.stop();
    expect(frenzy.isSequenceActive).toBe(false);
    expect(frenzy.isFrenzyRunning).toBe(false);
    expect(frenzy.root.visible).toBe(false);

    frenzy.destroy();
  });
});
