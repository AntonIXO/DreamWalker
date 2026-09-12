import { describe, expect, test } from "bun:test";
import {
  EpisodicMemory,
  episodesForWorldEvent,
  MAX_MEMORY_EPISODES,
  MAX_MEMORY_TEXT,
  type MemoryEpisodeInput,
} from "./episodic-memory";
import type { WorldActionEnvelope } from "./world-action";
import { createWorldMutator, executeWorldAction } from "./world-action-engine";
import {
  captureWorldAction,
  createWorldMind,
  MAX_WORLD_MIND_EVENTS,
  recordWorldAction,
  type WorldMindEvent,
} from "./world-mind";
import type { WorldMutator, WorldObjectState } from "./world-object";

const names = {
  rooms: { courtyard: "Двор", hotel: "Гостиница" },
  figures: { actor: "Художник", witness: "Турышев", kirill: "Кирилл" },
};

function memory(
  overrides: Partial<MemoryEpisodeInput> = {},
): MemoryEpisodeInput {
  return {
    id: "example",
    cycle: 2,
    kind: "dialogue",
    text: "Санитар рассказал о потерянной чашке.",
    roomIds: ["courtyard"],
    entityIds: ["player", "witness", "cup"],
    observerIds: ["sleeper", "player", "witness"],
    ...overrides,
  };
}

function object(overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id: "cup",
    name: "чашка",
    location: { kind: "room", roomId: "courtyard", x: 2, y: 2 },
    mobility: "carryable",
    affordances: ["take", "drop", "give", "put", "use", "open", "close"],
    body: null,
    visual: { role: "prop", image: null },
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

function perform(
  world: WorldMutator,
  envelope: WorldActionEnvelope,
): WorldMindEvent {
  const before = captureWorldAction(world, envelope);
  const result = executeWorldAction(world, envelope);
  expect(result.ok).toBe(true);
  const event = recordWorldAction(
    createWorldMind(),
    world,
    envelope,
    result,
    before,
    2,
  );
  expect(event).not.toBeNull();
  return event!;
}

describe("run episodic memory", () => {
  test("NPCs carry witnessed memories between rooms but exact memories end with the cycle", () => {
    const store = new EpisodicMemory();
    store.add(memory());
    // Retrieval is observer-based, so walking into another room cannot erase it.
    expect(store.forObserver("witness", 2)[0]?.roomIds).toEqual(["courtyard"]);
    expect(store.forObserver("unseen", 2)).toEqual([]);
    expect(store.forObserver("witness", 3)).toEqual([]);
    expect(store.forObserver("player", 3)).toHaveLength(1);
    expect(store.forObserver("sleeper", 3)).toHaveLength(1);
  });

  test("duplicate receipts are ignored and public copies cannot rewrite facts", () => {
    const store = new EpisodicMemory();
    const original = memory();
    store.add(original);
    original.text = "Changed later";
    original.observerIds.push("unseen");
    store.add(memory({ text: "Duplicate rewritten" }));
    const snapshot = store.snapshot();
    snapshot.episodes[0]!.text = "Mutated save";
    snapshot.episodes[0]!.observerIds.push("unseen");
    const observed = store.forObserver("witness", 2);
    observed[0]!.text = "Mutated retrieval";
    observed[0]!.entityIds.push("hidden");
    expect(store.snapshot().episodes).toHaveLength(1);
    expect(store.forObserver("witness", 2)[0]?.text).toBe(memory().text);
    expect(store.forObserver("unseen", 2)).toEqual([]);
    expect(store.forObserver("witness", 2)[0]?.entityIds).not.toContain(
      "hidden",
    );
  });

  test("capacity, saved text and identifier lists are bounded", () => {
    const store = new EpisodicMemory({ capacity: 2 });
    for (let i = 0; i < 5; i++)
      store.add(memory({ id: `entry-${i}`, text: "я".repeat(5000) }));
    const snapshot = store.snapshot();
    expect(snapshot.episodes.map((episode) => episode.id)).toEqual([
      "entry-3",
      "entry-4",
    ]);
    expect(snapshot.episodes[0]?.sequence).toBe(4);
    expect(snapshot.episodes[0]?.text).toHaveLength(MAX_MEMORY_TEXT);
    expect(snapshot.nextSequence).toBe(6);
    const capped = new EpisodicMemory({ capacity: Number.MAX_SAFE_INTEGER });
    capped.restore(
      Array.from({ length: MAX_MEMORY_EPISODES + 5 }, (_, i) =>
        memory({
          id: `entry-${i}`,
          roomIds: Array.from({ length: 1000 }, (_, j) => `room-${j}`),
        }),
      ),
    );
    expect(capped.snapshot().episodes).toHaveLength(MAX_MEMORY_EPISODES);
    expect(capped.snapshot().episodes[0]?.roomIds.length).toBeLessThanOrEqual(
      64,
    );
  });

  test("reload preserves order and scope, while a new run clears everything", () => {
    const store = new EpisodicMemory({ capacity: 2 });
    store.add(memory({ id: "one" }));
    store.add(memory({ id: "two" }));
    store.add(memory({ id: "three" }));
    const restored = new EpisodicMemory();
    restored.restore(JSON.parse(JSON.stringify(store.snapshot())));
    expect(restored.snapshot()).toEqual(store.snapshot());
    restored.add(memory({ id: "four" }));
    expect(restored.snapshot().episodes.at(-1)?.sequence).toBe(4);
    expect(restored.forObserver("unseen", 2)).toEqual([]);
    restored.clear();
    expect(restored.snapshot()).toEqual({ episodes: [], nextSequence: 1 });
  });

  test("malformed and old saves cannot grant memories to an unspecified observer", () => {
    const store = new EpisodicMemory();
    store.restore(undefined);
    expect(store.snapshot().episodes).toEqual([]);
    store.restore({
      nextSequence: Number.MAX_SAFE_INTEGER,
      episodes: [
        null,
        { ...memory(), id: "no-scope", observerIds: "witness" },
        { ...memory(), id: "bad-kind", kind: "proposal" },
        { ...memory(), id: "bad-cycle", cycle: NaN },
        { ...memory(), id: "negative-cycle", cycle: -1 },
        { ...memory(), id: "blank", text: "   " },
        { ...memory(), id: "valid", sequence: -2 },
        { ...memory(), id: "valid", text: "duplicate" },
      ],
    });
    expect(store.snapshot().episodes.map((episode) => episode.id)).toEqual([
      "valid",
    ]);
    expect(store.snapshot().nextSequence).toBe(2);
    store.restore({});
    expect(store.forObserver("witness", 2)).toEqual([]);
  });

  test("returning figures forget without rewriting the other witnesses", () => {
    const store = new EpisodicMemory();
    store.add(
      memory({
        observerIds: ["kirill", "sleeper", "player", "witness"],
        entityIds: ["kirill"],
      }),
    );
    store.add(memory({ id: "private", observerIds: ["kirill"] }));
    store.forgetObserver("kirill");
    store.forgetObserver("player");
    expect(store.forObserver("kirill", 2)).toEqual([]);
    expect(store.forObserver("witness", 2)).toHaveLength(1);
    expect(store.forObserver("player", 2)).toHaveLength(1);
    expect(store.forObserver("sleeper", 3)).toHaveLength(1);
    expect(store.snapshot().episodes).toHaveLength(1);
    store.add(memory({ id: "after-return", observerIds: ["kirill"] }));
    expect(store.forObserver("kirill", 2)[0]?.id).toBe("after-return");
  });

  test("Kirill's physical history stays hidden from ordinary NPCs even in a restored save", () => {
    const store = new EpisodicMemory();
    store.restore([
      memory({
        kind: "action",
        entityIds: ["kirill"],
        observerIds: ["witness", "glaz", "sleeper", "player"],
      }),
    ]);
    expect(store.forObserver("witness", 2)).toEqual([]);
    expect(store.forObserver("glaz", 2)).toHaveLength(1);
    expect(store.forObserver("sleeper", 3)).toHaveLength(1);
    expect(store.forObserver("player", 3)).toHaveLength(1);
  });

  test("a fresh scene remains available with Kirill nearby, and his own route lasts until revival", () => {
    const store = new EpisodicMemory();
    store.add(memory({ kind: "observation", entityIds: ["player", "kirill"] }));
    store.add(
      memory({
        id: "kirill-route",
        kind: "movement",
        entityIds: ["kirill"],
        subjectActorId: "kirill",
        observerIds: ["kirill", "glaz", "sleeper"],
        text: "Кирилл перешёл из двора в гостиницу.",
      }),
    );
    expect(store.forObserver("witness", 2)).toHaveLength(1);
    expect(store.forObserver("kirill", 2)[0]?.id).toBe("kirill-route");
    store.forgetObserver("kirill");
    expect(store.forObserver("kirill", 2)).toEqual([]);
    expect(store.forObserver("glaz", 2)).toHaveLength(1);
  });

  test("legacy facts default to private non-rumor origins and valid source chains survive reload", () => {
    const store = new EpisodicMemory();
    store.add(memory());
    expect(store.snapshot().episodes[0]).toMatchObject({
      originId: "example",
      subjectActorId: null,
      shareable: false,
    });
    expect(store.snapshot().episodes[0]?.provenance).toBeUndefined();
    store.add(
      memory({
        id: "heard:two",
        kind: "action",
        originId: "world:2:5",
        subjectActorId: "player",
        shareable: true,
        provenance: {
          kind: "heard",
          originWitnessId: "first-witness",
          speakerId: "speaker",
          hops: 2,
          acquiredRoomId: "hotel",
          acquiredCycle: 2,
        },
      }),
    );
    const restored = new EpisodicMemory();
    restored.restore(JSON.parse(JSON.stringify(store.snapshot())));
    expect(restored.snapshot()).toEqual(store.snapshot());
    const heard = restored.snapshot().episodes[1]!;
    expect(heard.originId).toBe("world:2:5");
    expect(heard.shareable).toBe(true);
    expect(heard.provenance).toEqual(store.snapshot().episodes[1]?.provenance);
    heard.provenance!.originWitnessId = "invented";
    expect(restored.snapshot().episodes[1]?.provenance?.originWitnessId).toBe(
      "first-witness",
    );
  });

  test("malformed provenance is bounded and never promotes a fact to a rumor", () => {
    const store = new EpisodicMemory();
    const provenance = {
      kind: "observed",
      originWitnessId: "witness",
      speakerId: null,
      hops: 0,
      acquiredRoomId: "courtyard",
      acquiredCycle: 2,
    };
    store.restore({
      episodes: [
        {
          ...memory(),
          id: "bad-hops",
          kind: "action",
          subjectActorId: "player",
          shareable: true,
          provenance: { ...provenance, hops: 9 },
        },
        {
          ...memory(),
          id: "bad-id",
          kind: "action",
          subjectActorId: "player",
          shareable: true,
          provenance: { ...provenance, originWitnessId: "x".repeat(1000) },
        },
        {
          ...memory(),
          id: "bad-cycle",
          kind: "action",
          subjectActorId: "player",
          shareable: true,
          provenance: { ...provenance, acquiredCycle: -1 },
        },
        {
          ...memory(),
          id: "bad-speaker",
          kind: "action",
          subjectActorId: "player",
          shareable: true,
          provenance: { ...provenance, kind: "heard", hops: 1 },
        },
        {
          ...memory(),
          id: "heard-masquerade",
          kind: "action",
          subjectActorId: "player",
          shareable: true,
          provenance: { ...provenance, speakerId: "someone" },
        },
        {
          ...memory(),
          id: "player-only-witness",
          kind: "action",
          subjectActorId: "actor",
          shareable: true,
          provenance,
        },
        {
          ...memory(),
          id: "dialogue",
          subjectActorId: "player",
          shareable: true,
          provenance,
        },
      ],
    });
    expect(store.snapshot().episodes).toHaveLength(7);
    expect(
      store.snapshot().episodes.every((episode) => episode.shareable === false),
    ).toBe(true);
    expect(
      store
        .snapshot()
        .episodes.slice(0, 5)
        .every((episode) => episode.provenance === undefined),
    ).toBe(true);
  });
});

describe("episodic memories from observed world receipts", () => {
  test("the player's real item change is shared with nearby witnesses and keeps its physical state", () => {
    const world = createWorldMutator({
      objects: [object()],
      playerPose: { roomId: "courtyard", x: 1, y: 2 },
      figurePoses: [
        ["witness", { roomId: "courtyard", x: 1, y: 3 }],
        ["behind-wall", { roomId: "courtyard", x: 5, y: 2 }],
        ["elsewhere", { roomId: "hotel", x: 1, y: 2 }],
      ],
      isWalkableTile: (_room, x) => x !== 4,
    });
    const event = perform(world, {
      actor: { kind: "player" },
      source: "player",
      action: {
        type: "alter",
        objectId: "cup",
        verb: "намочить",
        changes: { wet: true, inscription: "Моя чашка" },
      },
    });
    const episodes = episodesForWorldEvent(event, names);
    expect(episodes.map((episode) => episode.observerIds[0])).toEqual([
      "sleeper",
      "player",
      "witness",
    ]);
    const observed = episodes.find(
      (episode) => episode.observerIds[0] === "witness",
    )!;
    expect(observed.text).toContain("Санитар");
    expect(observed.text).toContain("Двор");
    expect(observed.text).toContain("чашка");
    expect(observed.text).toContain("мокрый");
    expect(observed.text).toContain("Моя чашка");
    expect(observed.entityIds).toEqual(["player", "cup"]);
    expect(observed.cycle).toBe(2);
    expect(episodes.every((episode) => !episode.text.startsWith("Цикл "))).toBe(
      true,
    );
    expect(observed.text).not.toContain("Свидетели:");
    expect(observed.subjectActorId).toBe("player");
    expect(observed.shareable).toBe(true);
    expect(new Set(episodes.map((episode) => episode.originId))).toEqual(
      new Set(["world:2:1"]),
    );
    expect(observed.provenance).toEqual({
      kind: "observed",
      originWitnessId: "witness",
      speakerId: null,
      hops: 0,
      acquiredRoomId: "courtyard",
      acquiredCycle: 2,
    });
  });

  test("the sleeper retains actual witness names after the short world receipt expires", () => {
    const world = createWorldMutator({
      objects: [object()],
      playerPose: { roomId: "courtyard", x: 1, y: 2 },
      figurePoses: [
        ["witness", { roomId: "courtyard", x: 1, y: 3 }],
        ["actor", { roomId: "hotel", x: 1, y: 3 }],
      ],
      isWalkableTile: () => true,
    });
    const receipts = createWorldMind();
    const store = new EpisodicMemory();
    for (let i = 0; i <= MAX_WORLD_MIND_EVENTS; i++) {
      const envelope: WorldActionEnvelope = {
        actor: { kind: "player" },
        source: "player",
        action:
          i === 0
            ? { type: "take", objectId: "cup" }
            : { type: "moveTo", x: (i % 2) + 1, y: 2 },
      };
      const before = captureWorldAction(world, envelope);
      const result = executeWorldAction(world, envelope);
      expect(result.ok).toBe(true);
      const event = recordWorldAction(
        receipts,
        world,
        envelope,
        result,
        before,
        2,
      )!;
      for (const episode of episodesForWorldEvent(event, names))
        store.add(episode);
    }
    expect(receipts.events.some((event) => event.sequence === 1)).toBe(false);
    const original = store
      .forObserver("sleeper", 2)
      .find((episode) => episode.originId === "world:2:1")!;
    expect(original.text).toContain("Свидетели: Турышев.");
    expect(original.text).not.toContain("Художник");
    expect(original.observerIds).toEqual(["sleeper"]);
    const witnessed = store
      .forObserver("witness", 2)
      .find((episode) => episode.originId === "world:2:1")!;
    expect(witnessed.text).not.toContain("Свидетели:");
    expect(witnessed.observerIds).toEqual(["witness"]);
  });

  test("a room crossing remembers only the endpoint each witness could see", () => {
    const world = createWorldMutator({
      objects: [],
      figurePoses: [
        ["actor", { roomId: "courtyard", x: 1, y: 1 }],
        ["source", { roomId: "courtyard", x: 1, y: 2 }],
        ["destination", { roomId: "hotel", x: 8, y: 9 }],
      ],
      doors: [
        {
          id: "door",
          type: "open",
          closed: false,
          fromRoomId: "courtyard",
          toRoomId: "hotel",
          x: 1,
          y: 1,
          w: 1,
          h: 1,
          keyId: null,
          threshold: "rift",
          toX: 8,
          toY: 8,
        },
      ],
      isWalkableTile: () => true,
    });
    const episodes = episodesForWorldEvent(
      perform(world, {
        actor: { kind: "figure", id: "actor" },
        source: "npc",
        action: { type: "traverseDoor", doorId: "door" },
      }),
      names,
    );
    const byObserver = (id: string) =>
      episodes.find((episode) => episode.observerIds.includes(id))!;
    expect(JSON.stringify(byObserver("source"))).not.toContain("hotel");
    expect(byObserver("source").text).not.toContain("Гостиница");
    expect(byObserver("source").text).toContain("вышел из поля зрения");
    expect(byObserver("source").roomIds).toEqual(["courtyard"]);
    expect(byObserver("source").provenance?.acquiredRoomId).toBe("courtyard");
    expect(JSON.stringify(byObserver("destination"))).not.toContain(
      "courtyard",
    );
    expect(byObserver("destination").text).toContain("появился");
    expect(byObserver("destination").roomIds).toEqual(["hotel"]);
    expect(byObserver("destination").provenance?.acquiredRoomId).toBe("hotel");
    expect(byObserver("actor").text).toContain(
      "перешёл из «Двор» в «Гостиница»",
    );
    expect(byObserver("actor").kind).toBe("movement");
    expect(byObserver("actor").provenance?.acquiredRoomId).toBe("hotel");
    expect(episodes.every((episode) => episode.shareable === false)).toBe(true);
    expect(byObserver("sleeper").roomIds).toEqual(["courtyard", "hotel"]);
    expect(
      episodes.some((episode) => episode.observerIds.includes("player")),
    ).toBe(false);
  });

  test("an unseen secondary object and its name cannot escape through embedding text or IDs", () => {
    const world = createWorldMutator({
      objects: [
        object({ location: { kind: "held", actor: { kind: "player" } } }),
        object({
          id: "hidden-bottle",
          name: "Секретная бутылка",
          location: { kind: "room", roomId: "courtyard", x: 2, y: 1 },
        }),
      ],
      playerPose: { roomId: "courtyard", x: 2, y: 0 },
      figurePoses: [["witness", { roomId: "courtyard", x: 0, y: 0 }]],
      isWalkableTile: (_room, x, y) => !(x === 1 && y === 1),
    });
    const episodes = episodesForWorldEvent(
      perform(world, {
        actor: { kind: "player" },
        source: "player",
        action: {
          type: "alter",
          objectId: "cup",
          targetId: "hidden-bottle",
          verb: "намочить секретной бутылкой",
          changes: { wet: true },
        },
      }),
      names,
    );
    const observed = episodes.find((episode) =>
      episode.observerIds.includes("witness"),
    )!;
    expect(observed.text).toContain("мокрый");
    expect(JSON.stringify(observed)).not.toContain("hidden-bottle");
    expect(observed.text.toLowerCase()).not.toContain("бутылк");
  });

  test("closed containers do not grant a witness the hidden object's removal", () => {
    const cup = object({ location: { kind: "inside", objectId: "box" } });
    const world = createWorldMutator({
      objects: [
        cup,
        object({ id: "box", name: "Тайник", state: { open: false } }),
      ],
      figurePoses: [["witness", { roomId: "courtyard", x: 1, y: 2 }]],
      isWalkableTile: () => true,
    });
    const envelope: WorldActionEnvelope = {
      actor: { kind: "script", id: "hidden-action" },
      source: "script",
      action: { type: "take", objectId: "cup" },
    };
    const before = captureWorldAction(world, envelope);
    cup.location = { kind: "removed" };
    const event = recordWorldAction(
      createWorldMind(),
      world,
      envelope,
      {
        ok: true,
        refusal: null,
        affectedObjects: ["cup"],
        affectedRooms: ["courtyard"],
        events: [
          {
            type: "object.taken",
            objectId: "cup",
            actor: envelope.actor,
            fromRoomId: null,
          },
        ],
      },
      before,
      2,
    )!;
    expect(
      episodesForWorldEvent(event, names).map((episode) => episode.observerIds),
    ).toEqual([["sleeper"]]);
  });

  test("physical Kirill receipts are available to himself, the Eye and sleeper", () => {
    const world = createWorldMutator({
      objects: [object()],
      figurePoses: [
        ["kirill", { roomId: "courtyard", x: 1, y: 2 }],
        ["witness", { roomId: "courtyard", x: 1, y: 3 }],
        ["glaz", { roomId: "courtyard", x: 1, y: 4 }],
      ],
      isWalkableTile: () => true,
    });
    const event = perform(world, {
      actor: { kind: "figure", id: "kirill" },
      source: "npc",
      action: { type: "take", objectId: "cup" },
    });
    expect(
      episodesForWorldEvent(event, names).map((episode) => episode.observerIds),
    ).toEqual([["sleeper"], ["kirill"], ["glaz"]]);
  });

  test("a real player movement is shareable, standing still produces no memory", () => {
    const world = createWorldMutator({
      objects: [],
      playerPose: { roomId: "courtyard", x: 1, y: 1 },
      figurePoses: [["witness", { roomId: "courtyard", x: 1, y: 2 }]],
      isWalkableTile: () => true,
    });
    const move = (x: number) =>
      episodesForWorldEvent(
        perform(world, {
          actor: { kind: "player" },
          source: "player",
          action: { type: "moveTo", x, y: 1 },
        }),
        names,
      );
    expect(move(1)).toEqual([]);
    const observed = move(2).find((episode) =>
      episode.observerIds.includes("witness"),
    )!;
    expect(observed.kind).toBe("movement");
    expect(observed.subjectActorId).toBe("player");
    expect(observed.shareable).toBe(true);
  });

  test("a visible changed object does not identify an unseen actor as its owner", () => {
    const world = createWorldMutator({
      objects: [
        object({ location: { kind: "room", roomId: "courtyard", x: 0, y: 1 } }),
      ],
      playerPose: { roomId: "courtyard", x: 2, y: 0 },
      figurePoses: [["witness", { roomId: "courtyard", x: 0, y: 0 }]],
      isWalkableTile: (_room, x, y) => !(x === 1 && y === 0),
    });
    const envelope: WorldActionEnvelope = {
      actor: { kind: "player" },
      source: "player",
      action: {
        type: "alter",
        objectId: "cup",
        verb: "намочить",
        changes: { wet: true },
      },
    };
    const before = captureWorldAction(world, envelope);
    world.objectById.get("cup")!.state.wet = true;
    const event = recordWorldAction(
      createWorldMind(),
      world,
      envelope,
      {
        ok: true,
        refusal: null,
        affectedObjects: ["cup"],
        affectedRooms: ["courtyard"],
        events: [
          {
            type: "object.changed",
            objectId: "cup",
            targetId: null,
            actor: envelope.actor,
            verb: "намочить",
            before: {},
            after: { wet: true },
          },
        ],
      },
      before,
      2,
    )!;
    const observed = episodesForWorldEvent(event, names).find((episode) =>
      episode.observerIds.includes("witness"),
    )!;
    expect(observed.text).toContain("мокрый");
    expect(observed.text).not.toContain("Санитар");
    expect(observed.subjectActorId).toBeNull();
    expect(observed.entityIds).not.toContain("player");
    expect(observed.shareable).toBe(false);
  });
});
