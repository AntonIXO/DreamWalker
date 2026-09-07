import { describe, expect, test } from "bun:test";

import { assertMuralObjectArt, muralObjectMissingArt } from "./object-art";

const mural = {
  graphics: {
    backdropFit: "cells" as const,
    backdropImage: "rooms/a.png",
    floorRole: "floor",
    wallRole: "wall",
    propRole: "prop",
    glitchPreset: "none" as const,
  },
};

describe("object art on murals", () => {
  test("a carryable without image or role is refused on a mural room", () => {
    expect(
      muralObjectMissingArt(mural, {
        mobility: "carryable",
        visual: { image: null, role: null },
      }),
    ).toBe(true);
  });

  test("fixed furniture on a mural may stay invisible", () => {
    expect(
      muralObjectMissingArt(mural, {
        mobility: "fixed",
        visual: { image: null, role: null },
      }),
    ).toBe(false);
  });

  test("assertMuralObjectArt names the object", () => {
    const errors = assertMuralObjectArt(
      [{ id: "a", graphics: mural.graphics }],
      [
        {
          id: "bottle",
          location: { kind: "room", roomId: "a" },
          mobility: "carryable",
          visual: { image: null, role: null },
        },
      ],
    );
    expect(errors.some((line) => line.includes("bottle"))).toBe(true);
  });
});
