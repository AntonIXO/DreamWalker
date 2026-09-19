import { describe, expect, test } from "bun:test";

import { sonArtifact } from "../../../dreams/son/pack";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { originX, originY } from "../../shared/street";
import { escortFigure, updateFigures } from "./figures";
import { applyPatch } from "./patch";
import { setLiveObjects } from "./object-collision";
import { createWorld } from "./world";
import type { WorldObjectState } from "../../shared/world-object";

const artifact = validateDreamArtifact(sonArtifact()) as DreamArtifact;

const YARD = "19-dvor-i-oranzhevye-lavochki";
const STREET = "path-1-2-e";

describe("a led figure", () => {
  test("a seated or lying figure is not dragged out by ambient movement or the next agenda phase", () => {
    const world = createWorld(artifact);
    const figure = world.figures[0]!;
    const object = world.objects[0]!;
    object.state.occupancy = {
      actor: { kind: "figure", id: figure.id },
      pose: "lying",
      returnPose: { roomId: figure.roomId, x: figure.x, y: figure.y },
    };
    figure.targetX = figure.x + 1;
    figure.targetY = figure.y;
    figure.walking = true;
    const before = {
      x: figure.x,
      y: figure.y,
      roomId: figure.roomId,
      phase: figure.agendaPhase,
    };
    for (let i = 0; i < 60; i++)
      updateFigures(world, 0.95, 1 / 30, null, world.currentRoomId);
    expect({
      x: figure.x,
      y: figure.y,
      roomId: figure.roomId,
      phase: figure.agendaPhase,
    }).toEqual(before);
    expect(figure.walking).toBe(false);
    expect(figure.targetX).toBeNull();
  });
  test("a director-controlled figure keeps its current path instead of ambient walking or reseating", () => {
    const world = createWorld(artifact);
    const figure = world.figures[0]!;
    const before = {
      x: figure.x,
      y: figure.y,
      roomId: figure.roomId,
      phase: figure.agendaPhase,
    };
    figure.targetX = figure.x + 1;
    figure.targetY = figure.y;
    for (let i = 0; i < 30; i++)
      updateFigures(
        world,
        0.9,
        1 / 30,
        null,
        world.currentRoomId,
        null,
        new Set([figure.id]),
      );
    expect({
      x: figure.x,
      y: figure.y,
      roomId: figure.roomId,
      phase: figure.agendaPhase,
    }).toEqual(before);
    expect(figure.targetX).toBe(before.x + 1);
  });
  test("cannot be escorted into a meta-space", () => {
    const world = createWorld(artifact);
    const figure = world.figures.find((entry) => entry.id === "mama")!;
    applyPatch(world, {
      kind: "markFigure",
      figureId: "mama",
      fate: "led",
      quoted: null,
      reason: "test",
    });

    expect(
      escortFigure(world, "mama", "m5-odinochestvo", { x: 10, y: 5 }),
    ).toBe(false);
    expect(figure.roomId).toBe("18-kupol-bez-sten");
  });

  test("does not follow the sanitar into a meta-space", () => {
    const world = createWorld(artifact);
    const figure = world.figures.find((entry) => entry.id === "mama")!;
    const from = world.roomById.get("m4-razvilka-gde-ty-ostalsia")!;
    figure.roomId = from.id;
    figure.x = 18;
    figure.y = 6;
    applyPatch(world, {
      kind: "markFigure",
      figureId: "mama",
      fate: "led",
      quoted: null,
      reason: "test",
    });

    const target = world.roomById.get("m5-odinochestvo")!;
    const toward = {
      x: originX(target) + 10,
      y: originY(target) + 5,
    };
    for (let i = 0; i < 240; i++) {
      updateFigures(world, 0, 1 / 30, null, from.id, toward);
    }

    expect(figure.roomId).not.toBe(target.id);
  });

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

describe("figure collision with live objects", () => {
  test("ambient steps never enter a solid live object", () => {
    const world = createWorld(artifact);
    const figure = world.figures.find((entry) => entry.id === "kirill")!;
    figure.roomId = YARD;
    figure.x = 10;
    figure.y = 6;
    const object: WorldObjectState = {
      id: "bottle",
      name: "бутылка",
      location: { kind: "room", roomId: YARD, x: 11, y: 6 },
      mobility: "carryable",
      affordances: ["take"],
      body: { w: 1, h: 1, solid: true },
      visual: { role: null, image: "bottle.png" },
      interaction: null,
      state: {},
      tags: [],
      clueId: null,
      holdsShardId: null,
      sensorySeed: null,
      once: false,
      dwellMs: null,
      keyId: null,
      hotspotKind: null,
      uiAction: null,
    };
    setLiveObjects(world, [object]);
    for (let i = 0; i < 120; i++) {
      updateFigures(world, 0, 1 / 30, null, YARD, null);
      expect(Math.round(figure.x)).not.toBe(11);
      expect(Math.round(figure.y) === 6 && Math.round(figure.x) === 11).toBe(
        false,
      );
    }
  });
});
