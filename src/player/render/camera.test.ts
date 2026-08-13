import { describe, expect, test } from "bun:test";

import { Camera, DEFAULT_CAMERA, fitZoom, FOLLOW_VIEW_TILES } from "./camera";

/** Just enough of a Pixi Container for the camera to write x/y/scale. */
function stubStage(): {
  x: number;
  y: number;
  scale: { x: number; y: number; set: (n: number) => void };
} {
  const stage = {
    x: 0,
    y: 0,
    scale: {
      x: 1,
      y: 1,
      set(n: number) {
        stage.scale.x = n;
        stage.scale.y = n;
      },
    },
  };
  return stage;
}

function makeCamera(
  viewW: number,
  viewH: number,
  tilesW: number,
  tilesH: number,
  tileSize = 16,
): { camera: Camera; stage: ReturnType<typeof stubStage> } {
  const stage = stubStage();
  const camera = new Camera(
    stage as never,
    tileSize,
    viewW,
    viewH,
    DEFAULT_CAMERA,
  );
  camera.setWorldSize(tilesW, tilesH);
  return { camera, stage };
}

describe("fitZoom", () => {
  test("is a whole number of at least 1", () => {
    expect(fitZoom(640, 360, 18, 13, 16)).toBe(1);
    expect(Number.isInteger(fitZoom(800, 500, 22, 13, 16))).toBe(true);
    expect(fitZoom(10, 10, 18, 13, 16)).toBe(1);
  });

  test("an 18×13 lobby at 640×360 is zoom 1 — zoom 2 would crop it", () => {
    expect(fitZoom(640, 360, 18, 13, 16)).toBe(1);
    // Width still fits at 2×; height (416) is what would leave the bed off-screen.
    expect(13 * 16 * 2).toBeGreaterThan(360);
  });

  test("an 18×13 lobby at 1920×1080 is zoom 5", () => {
    expect(fitZoom(1920, 1080, 18, 13, 16)).toBe(5);
    expect(Math.floor(Math.min(1920 / 288, 1080 / 208))).toBe(5);
  });

  test("outdoor target at 1920×1080 is zoom 5", () => {
    expect(
      fitZoom(1920, 1080, FOLLOW_VIEW_TILES.w, FOLLOW_VIEW_TILES.h, 16),
    ).toBe(5);
  });

  test("rejects empty measurements", () => {
    expect(fitZoom(0, 360, 18, 13, 16)).toBe(1);
    expect(fitZoom(640, 360, 0, 13, 16)).toBe(1);
    expect(fitZoom(640, 360, 18, 13, 0)).toBe(1);
  });
});

describe("Camera", () => {
  test("setZoom widens visibleTiles as zoom drops", () => {
    const { camera } = makeCamera(640, 360, 40, 30);
    camera.setZoom(4);
    camera.cutTo(320, 180);
    const tight = camera.visibleTiles(0);
    camera.setZoom(1);
    const wide = camera.visibleTiles(0);
    expect(wide.w).toBeGreaterThan(tight.w);
    expect(wide.h).toBeGreaterThan(tight.h);
  });

  test("does not rewrite the shared DEFAULT_CAMERA", () => {
    const before = DEFAULT_CAMERA.zoom;
    const { camera } = makeCamera(640, 360, 18, 13);
    camera.setZoom(4);
    expect(DEFAULT_CAMERA.zoom).toBe(before);
    expect(camera.zoom).toBe(4);
  });

  test("clamp centres a world smaller than the view", () => {
    // 18×13 lobby at zoom 5 on 1920×1080: 1440×1040 world inside a larger view.
    const { camera, stage } = makeCamera(1920, 1080, 18, 13);
    camera.setZoom(5);
    camera.cutTo(100, 80);
    expect(stage.x).toBe(Math.round((1920 - 18 * 16 * 5) / 2));
    expect(stage.y).toBe(Math.round((1080 - 13 * 16 * 5) / 2));
  });

  test("fit applies fitZoom", () => {
    const { camera } = makeCamera(1920, 1080, 18, 13);
    expect(camera.fit(18, 13)).toBe(5);
    expect(camera.zoom).toBe(5);
  });
});
