import { describe, expect, test } from "bun:test";

import { sonArtifact } from "../../../dreams/son/pack";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { originX, originY } from "../../shared/street";
import { escortFigure, updateFigures } from "./figures";
import { applyPatch } from "./patch";
import { createWorld } from "./world";

const artifact = validateDreamArtifact(sonArtifact()) as DreamArtifact;

const YARD = "19-dvor-i-oranzhevye-lavochki";
const STREET = "path-1-2-e";

describe("a led figure", () => {
  test("can be escorted onto a street that has no figure slots", () => {
    const world = createWorld(artifact);
    const figure = world.figures.find((entry) => entry.id === "kirill")!;
    figure.roomId = YARD;
    figure.x = 16;
    figure.y = 6;
    applyPatch(world, {
      kind: "markFigure",
      figureId: "kirill",
      fate: "led",
      quoted: null,
      reason: "test",
    });
    const street = world.roomById.get(STREET)!;
    expect(street.figureSlots).toEqual([]);
    expect(escortFigure(world, "kirill", STREET, { x: 0.5, y: 6 })).toBe(true);
    expect(figure.roomId).toBe(STREET);
  });

  test("walks through a doorway onto the street instead of stopping at the wall", () => {
    const world = createWorld(artifact);
    const yard = world.roomById.get(YARD)!;
    const figure = world.figures.find((entry) => entry.id === "kirill")!;
    figure.roomId = YARD;
    figure.x = 16;
    figure.y = 6;
    applyPatch(world, {
      kind: "markFigure",
      figureId: "kirill",
      fate: "led",
      quoted: null,
      reason: "test",
    });
    const toward = {
      x: originX(yard) + yard.width + 4,
      y: originY(yard) + 6,
    };
    for (let i = 0; i < 240; i++) {
      updateFigures(world, 0, 1 / 30, null, YARD, toward);
    }
    expect(figure.roomId).toBe(STREET);
  });
});
