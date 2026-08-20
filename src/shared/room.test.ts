import { describe, expect, test } from "bun:test";

import { hidePropSprites, muralShowsTheRoom, type RoomGraphics } from "./room";

function graphics(over: Partial<RoomGraphics> = {}): RoomGraphics {
  return {
    floorRole: "floor",
    wallRole: "wall",
    propRole: "prop",
    backdropImage: null,
    backdropFit: "cells",
    glitchPreset: "none",
    ...over,
  };
}

describe("muralShowsTheRoom", () => {
  test("a cells painting is the furniture", () => {
    expect(
      muralShowsTheRoom(
        graphics({ backdropImage: "assets/rooms/08-apartment.png" }),
      ),
    ).toBe(true);
  });

  test("a room still waiting for art is not", () => {
    expect(muralShowsTheRoom(graphics())).toBe(false);
  });

  test("a meta-space screen picture is not furniture in the tile rect", () => {
    expect(
      muralShowsTheRoom(
        graphics({
          backdropFit: "screen",
          backdropImage: "assets/rooms/m1.png",
        }),
      ),
    ).toBe(false);
  });
});

describe("hidePropSprites", () => {
  test("a generated street never shows object sheets", () => {
    expect(
      hidePropSprites({
        tags: ["route"],
        graphics: graphics(),
      }),
    ).toBe(true);
  });

  test("a painted room hides the brown fallback even if the PNG failed to load", () => {
    expect(
      hidePropSprites({
        tags: [],
        graphics: graphics({ backdropImage: "assets/rooms/08.png" }),
      }),
    ).toBe(true);
  });
});
