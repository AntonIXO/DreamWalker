import { describe, expect, spyOn, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import { MAX_MEMORY_TEXT } from "../../shared/episodic-memory";
import type { ActorPose, WorldObjectState } from "../../shared/world-object";
import { createWorld } from "../game/world";
import { ContextMemory } from "./context-memory";
import { MindMemory } from "./memory";

interface RecordedEpisode {
  id: string;
  cycle: number;
  kind: string;
  text: string;
  roomIds: string[];
  entityIds: string[];
  observerIds: string[];
}

function setup() {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const base = world.figures[0]!;
  world.figures = [
    { ...base, id: "alice", name: "Алиса", roomId: "a", x: 2, y: 3 },
    { ...base, id: "bob", name: "Борис", roomId: "b", x: 2, y: 3 },
  ];
  world.objects = [];
  world.objectById.clear();
  const records: RecordedEpisode[] = [];
  const forgotten: string[] = [];
  const memory = new MindMemory(`context-${crypto.randomUUID()}`);
  spyOn(memory.episodes, "add").mockImplementation((entry) => {
    records.push(structuredClone(entry));
  });
  spyOn(memory.episodes, "forgetObserver").mockImplementation((id) => {
    forgotten.push(id);
  });
  const context = new ContextMemory(memory);
  const player: ActorPose = { roomId: "a", x: 3, y: 3 };
  const addObject = (
    id: string,
    name: string,
    location: WorldObjectState["location"],
    state: WorldObjectState["state"] = {},
  ) => {
    const object: WorldObjectState = {
      id,
      name,
      location,
      state,
      mobility: "carryable",
      affordances: [],
      body: null,
      visual: { role: null, image: null },
      interaction: null,
      tags: ["SECRET_TAG"],
      clueId: "SECRET_CLUE",
      holdsShardId: "SECRET_SHARD",
      sensorySeed: "SECRET_SEED",
      once: false,
      dwellMs: null,
      keyId: null,
      hotspotKind: null,
      uiAction: null,
    };
    world.objects.push(object);
    world.objectById.set(id, object);
    return object;
  };
  return { world, memory, context, player, records, forgotten, addObject };
}

describe("dynamic context senses", () => {
  test("authored habits and conditional stage directions never become witnessed facts", () => {
    const { context, world, player, records } = setup();
    world.figures[0]!.activity =
      "Бутылка рядом. Если санитар садится, придвигается. При подозрении 3 отворачивается.";
    context.observe(world, player, 1);
    const text = records.map((entry) => entry.text).join("\n");
    expect(text).toContain("Алиса");
    expect(text).not.toContain("Бутылка рядом");
    expect(text).not.toContain("подозрении 3");
  });
  test("records readable current places and people without repeating stationary frames", () => {
    const { context, world, player, records } = setup();
    context.observe(world, player, 1);
    const mine = records.filter((entry) =>
      entry.observerIds.includes("player"),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain("Комната А");
    expect(mine[0]!.text).toContain("Алиса");
    expect(mine[0]!.text).not.toContain("Борис");
    const count = records.length;
    for (let i = 0; i < 30; i++) {
      context.observe(world, { ...player, x: 3 + i / 100 }, 1);
    }
    expect(records).toHaveLength(count);
  });

  test("the traveller knows the route; witnesses learn only their visible side", () => {
    const { context, world, player, records } = setup();
    context.observe(world, player, 1);
    records.length = 0;
    context.observe(world, { roomId: "b", x: 3, y: 3 }, 1);
    const movement = records.filter((entry) => entry.kind === "movement");
    const own = movement.find((entry) => entry.observerIds.includes("player"))!;
    expect(own.roomIds).toEqual(["a", "b"]);
    expect(own.text).toContain("Комната А");
    expect(own.text).toContain("Комната Б");
    const departure = movement.find((entry) =>
      entry.observerIds.includes("alice"),
    )!;
    expect(departure.roomIds).toEqual(["a"]);
    expect(departure.text).not.toContain("Комната Б");
    const arrival = movement.find((entry) =>
      entry.observerIds.includes("bob"),
    )!;
    expect(arrival.roomIds).toEqual(["b"]);
    expect(arrival.text).not.toContain("Комната А");
  });

  test("large scenes are collected in bounded complete records without dropping the tail", () => {
    const { context, world, player, records, addObject } = setup();
    for (let i = 0; i < 18; i++) {
      addObject(
        `object-${i}`,
        `Предмет ${i} ${"я".repeat(210)}`,
        { kind: "room", roomId: "a", x: 4, y: 3 },
        { inscription: `Метка ${i} ${"б".repeat(210)}` },
      );
    }
    for (let i = 0; i < 3; i++) context.observe(world, player, 1);
    const mine = records.filter((entry) =>
      entry.observerIds.includes("player"),
    );
    expect(mine.every((entry) => entry.text.length <= MAX_MEMORY_TEXT)).toBe(
      true,
    );
    const ids = new Set(mine.flatMap((entry) => entry.entityIds));
    for (let i = 0; i < 18; i++) expect(ids.has(`object-${i}`)).toBe(true);
    expect(mine.some((entry) => entry.text.includes("Метка 17"))).toBe(true);
    const count = records.length;
    context.observe(world, player, 1);
    expect(records).toHaveLength(count);
  });

  test("walls hide actors and changed objects; hidden metadata never enters memory", () => {
    const { context, world, player, records, addObject } = setup();
    const room = world.roomById.get("a")!;
    room.cells = room.cells.map(
      (line) => `${line.slice(0, 6)}#${line.slice(7)}`,
    );
    world.figures.push({
      ...world.figures[0]!,
      id: "hidden",
      name: "НЕВИДИМЫЙ",
      x: 8,
      y: 3,
    });
    const hidden = addObject("secret", "ТАЙНЫЙ ПРЕДМЕТ", {
      kind: "room",
      roomId: "a",
      x: 8,
      y: 3,
    });
    const cup = addObject("cup", "Чашка", {
      kind: "room",
      roomId: "a",
      x: 4,
      y: 3,
    });
    context.observe(world, player, 1);
    const mine = records.filter((entry) =>
      entry.observerIds.includes("player"),
    );
    expect(JSON.stringify(mine)).not.toContain("НЕВИДИМЫЙ");
    expect(JSON.stringify(mine)).not.toContain("ТАЙНЫЙ ПРЕДМЕТ");
    expect(JSON.stringify(records)).not.toContain("SECRET_");
    records.length = 0;
    hidden.state.inscription = "HIDDEN_CHANGE";
    cup.state.broken = true;
    context.observe(world, player, 1);
    const updated = records.filter((entry) =>
      entry.observerIds.includes("player"),
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]!.text).toContain("Чашка");
    expect(updated[0]!.text).toContain("сломано");
    expect(updated[0]!.text).not.toContain("HIDDEN_CHANGE");
  });

  test("nested contents become observable only through an entirely open chain", () => {
    const { context, world, player, records, addObject } = setup();
    const bag = addObject(
      "bag",
      "Сумка",
      { kind: "held", actor: { kind: "player" } },
      { open: false },
    );
    addObject(
      "box",
      "Коробка",
      { kind: "inside", objectId: "bag" },
      { open: true },
    );
    addObject("note", "СПРЯТАННАЯ ЗАПИСКА", {
      kind: "inside",
      objectId: "box",
    });
    context.observe(world, player, 1);
    expect(JSON.stringify(records)).not.toContain("СПРЯТАННАЯ ЗАПИСКА");
    records.length = 0;
    bag.state.open = true;
    context.observe(world, player, 1);
    const mine = records.filter((entry) =>
      entry.observerIds.includes("player"),
    );
    expect(JSON.stringify(mine)).toContain("СПРЯТАННАЯ ЗАПИСКА");
    expect(JSON.stringify(mine)).toContain("Коробка");
  });

  test("losing and regaining sight updates context without inventing hidden whereabouts", () => {
    const { context, world, player, records, addObject } = setup();
    const cup = addObject("cup", "Чашка", {
      kind: "room",
      roomId: "a",
      x: 4,
      y: 3,
    });
    context.observe(world, player, 1);
    records.length = 0;
    cup.location = { kind: "room", roomId: "b", x: 4, y: 3 };
    context.observe(world, player, 1);
    const absent = records.filter((entry) =>
      entry.observerIds.includes("player"),
    );
    expect(absent).toHaveLength(1);
    expect(absent[0]!.text).toContain("Чашка» больше не видно");
    expect(absent[0]!.text).not.toContain("Комната Б");
    records.length = 0;
    cup.location = { kind: "room", roomId: "a", x: 4, y: 3 };
    context.observe(world, player, 1);
    const returned = records.filter((entry) =>
      entry.observerIds.includes("player"),
    );
    expect(returned).toHaveLength(1);
    expect(returned[0]!.text).toContain("Чашка");
    expect(returned[0]!.text).not.toContain("больше не видно");
  });

  test("cycle, run and explicit reset begin fresh sensing without inventing a route", () => {
    const { context, world, player, records, memory } = setup();
    context.observe(world, player, 1);
    records.length = 0;
    const other = { roomId: "b", x: 3, y: 3 };
    context.observe(world, other, 2);
    expect(records.some((entry) => entry.kind === "movement")).toBe(false);
    expect(records.some((entry) => entry.cycle === 2)).toBe(true);
    records.length = 0;
    memory.newRun();
    context.observe(world, player, 2);
    expect(records.some((entry) => entry.kind === "movement")).toBe(false);
    records.length = 0;
    context.resetTracking();
    context.observe(world, other, 2);
    expect(records.some((entry) => entry.kind === "movement")).toBe(false);
  });

  test("Kirill's same-cycle return revokes old witness access and has no old-life route", () => {
    const { context, world, player, records, forgotten } = setup();
    const kirill = world.figures[0]!;
    kirill.id = "kirill";
    kirill.name = "Кирилл";
    context.observe(world, player, 1);
    records.length = 0;
    world.fateHistory.push({
      figureId: "kirill",
      fate: "dead",
      cycle: 1,
      roomId: "a",
      by: "kill",
      quoted: null,
      remains: null,
    });
    kirill.roomId = "b";
    context.observe(world, player, 1);
    expect(forgotten).toEqual(["kirill"]);
    expect(
      records.some(
        (entry) =>
          entry.kind === "movement" && entry.observerIds.includes("kirill"),
      ),
    ).toBe(false);
    expect(
      records.some(
        (entry) =>
          entry.kind === "observation" && entry.observerIds.includes("kirill"),
      ),
    ).toBe(true);
  });
});
