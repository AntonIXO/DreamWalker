import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { ActionOption } from "../../shared/world-action";
import type { WorldObjectState } from "../../shared/world-object";
import { createPlayer } from "./player";
import { setLiveObjects } from "./object-collision";
import {
  actionRingRowsFor,
  findTarget,
  primaryObjectAction,
  type ListActions,
} from "./interact";
import { createWorld } from "./world";

function tiny() {
  return createWorld(
    validateDreamArtifact(JSON.parse(JSON.stringify(fixture))) as DreamArtifact,
  );
}

function bottle(overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id: "bottle",
    name: "бутылка",
    location: { kind: "room", roomId: "a", x: 5, y: 3 },
    mobility: "carryable",
    affordances: ["examine", "take"],
    body: { w: 1, h: 1, solid: true },
    visual: { role: null, image: "bottle.png" },
    interaction: { reach: 1.4, prompt: "бутылка", refusal: null },
    state: {},
    tags: [],
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: "clue",
    uiAction: null,
    ...overrides,
  };
}

function option(
  partial: Pick<ActionOption, "action" | "affordance"> &
    Partial<ActionOption>,
): ActionOption {
  return {
    label: partial.label ?? partial.affordance,
    refusal: partial.refusal ?? null,
    ...partial,
  };
}

describe("findTarget objects", () => {
  test("a nearby carryable is an object target with injected actions", () => {
    const world = tiny();
    const room = world.roomById.get("a")!;
    const player = createPlayer(room, "default");
    setLiveObjects(world, [bottle()]);
    player.x = 5 * room.tileSize + 8;
    player.y = 3 * room.tileSize + 8;
    const actions: ListActions = (_world, _actor, target) => {
      if (target.kind !== "object") return [];
      return [
        option({
          action: { type: "take", objectId: "bottle" },
          affordance: "take",
          label: "взять",
        }),
        option({
          action: { type: "use", objectId: "bottle" },
          affordance: "use",
          label: "использовать",
          refusal: "не к чему",
        }),
      ];
    };
    const target = findTarget(world, room, player, undefined, actions);
    expect(target?.kind).toBe("object");
    if (target?.kind !== "object") return;
    expect(target.object.id).toBe("bottle");
    expect(target.actions.map((row) => row.affordance)).toEqual(["take", "use"]);
    expect(target.actions[1]?.refusal).toBe("не к чему");
  });

  test("figures still resolve as talk targets", () => {
    const world = tiny();
    const room = world.roomById.get("a")!;
    const player = createPlayer(room, "default");
    const figure = world.figures[0]!;
    figure.roomId = "a";
    figure.x = 6;
    figure.y = 6;
    player.x = 6 * room.tileSize + 8;
    player.y = 6 * room.tileSize + 8;
    const target = findTarget(world, room, player);
    expect(target?.kind).toBe("figure");
    if (target?.kind !== "figure") return;
    expect(target.verbs.map((row) => row.verb)).toEqual([
      "talk",
      "press",
      "lead",
      "kill",
    ]);
  });
});

describe("primaryObjectAction", () => {
  test("E prefers an unrefused take", () => {
    const pick = primaryObjectAction([
      option({
        action: { type: "take", objectId: "bottle" },
        affordance: "take",
      }),
      option({
        action: { type: "use", objectId: "bottle" },
        affordance: "examine",
      }),
    ]);
    expect(pick?.action.type).toBe("take");
  });

  test("a refused take is not a silent no-op — examine is next", () => {
    const pick = primaryObjectAction([
      option({
        action: { type: "take", objectId: "box" },
        affordance: "take",
        refusal: "закрыто",
      }),
      option({
        action: { type: "use", objectId: "box" },
        affordance: "examine",
      }),
    ]);
    expect(pick?.affordance).toBe("examine");
  });
});

describe("actionRingRowsFor", () => {
  test("keeps talk/press/lead/kill and appends give without hiding refusals", () => {
    const world = tiny();
    const figure = world.figures[0]!;
    const extras: ActionOption[] = [
      option({
        action: { type: "give", objectId: "bottle", to: { kind: "figure", id: figure.id } },
        affordance: "give",
        label: "отдать",
      }),
    ];
    const rows = actionRingRowsFor({
      kind: "figure",
      verbs: [
        { verb: "talk", label: "заговорить", refusal: null },
        { verb: "press", label: "надавить", refusal: "Надавить нечем." },
        { verb: "lead", label: "увести", refusal: null },
        { verb: "kill", label: "убить", refusal: "Здесь нечем." },
      ],
      actions: extras,
    });
    expect(rows.map((row) => row.label)).toEqual([
      "заговорить",
      "надавить",
      "увести",
      "убить",
      "отдать",
    ]);
    expect(rows.filter((row) => row.refusal).map((row) => row.refusal)).toEqual([
      "Надавить нечем.",
      "Здесь нечем.",
    ]);
    expect(rows.find((row) => row.payload.kind === "verb" && row.payload.verb === "kill")?.confirm).toBe(
      true,
    );
  });

  test("object ring shows engine rows including refused take/put", () => {
    const rows = actionRingRowsFor({
      kind: "object",
      verbs: [],
      actions: [
        option({
          action: { type: "take", objectId: "box" },
          affordance: "take",
          label: "взять",
          refusal: "закрыто",
        }),
        option({
          action: { type: "put", objectId: "bottle", intoObjectId: "box" },
          affordance: "put",
          label: "положить",
          refusal: "закрыто",
        }),
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.refusal === "закрыто")).toBe(true);
  });
});
