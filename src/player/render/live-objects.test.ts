import { describe, expect, test } from "bun:test";

import type { WorldObjectState } from "../../shared/world-object";
import { liveObjectPlacements } from "./walkerView";

function bottle(overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id: "bottle",
    name: "бутылка",
    location: { kind: "room", roomId: "a", x: 5, y: 3 },
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
    ...overrides,
  };
}

describe("liveObjectPlacements", () => {
  test("a floor bottle is on the live layer", () => {
    const list = liveObjectPlacements([bottle()], new Map());
    expect(list).toEqual([
      {
        id: "bottle",
        roomId: "a",
        x: 5,
        y: 3,
        held: false,
        image: "bottle.png",
        role: null,
      },
    ]);
  });

  test("a taken bottle follows the holder instead of staying on the floor", () => {
    const list = liveObjectPlacements(
      [bottle({ location: { kind: "held", actor: { kind: "player" } } })],
      new Map([["player", { roomId: "b", x: 2, y: 2 }]]),
    );
    expect(list).toEqual([
      {
        id: "bottle",
        roomId: "b",
        x: 2,
        y: 2,
        held: true,
        image: "bottle.png",
        role: null,
      },
    ]);
  });

  test("fixed furniture stays off the live layer", () => {
    const list = liveObjectPlacements(
      [bottle({ id: "crate", mobility: "fixed" })],
      new Map(),
    );
    expect(list).toEqual([]);
  });
});
