import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import {
  EpisodicMemory,
  type MemoryEpisodeInput,
} from "../../shared/episodic-memory";
import type { ActorPose } from "../../shared/world-object";
import { createWorld } from "../game/world";
import { RumorExchange } from "./rumors";

function setup() {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const base = world.figures[0]!;
  const alice = {
    ...base,
    id: "alice",
    name: "Алиса",
    roomId: "a",
    x: 2,
    y: 3,
  };
  const bob = { ...base, id: "bob", name: "Борис", roomId: "a", x: 3, y: 3 };
  const carol = {
    ...base,
    id: "carol",
    name: "Карина",
    roomId: "b",
    x: 2,
    y: 3,
  };
  const david = {
    ...base,
    id: "david",
    name: "Давид",
    roomId: "b",
    x: 9,
    y: 3,
  };
  world.figures = [alice, bob];
  world.baseFigures = [alice, bob, carol, david].map((figure) => ({
    ...figure,
  }));
  world.objects = [];
  world.objectById.clear();
  const episodes = new EpisodicMemory();
  const rumors = new RumorExchange(episodes);
  const player: ActorPose = { roomId: "b", x: 3, y: 3 };
  const add = (overrides: Partial<MemoryEpisodeInput> = {}) => {
    const originId = overrides.originId ?? `origin:${crypto.randomUUID()}`;
    const entry: MemoryEpisodeInput = {
      id: `event:${crypto.randomUUID()}`,
      cycle: 1,
      kind: "action",
      text: "Санитар взял красную чашку в комнате А.",
      roomIds: ["a"],
      entityIds: ["player", "cup"],
      observerIds: ["alice", "sleeper"],
      originId,
      subjectActorId: "player",
      shareable: true,
      provenance: {
        kind: "observed",
        originWitnessId: "alice",
        speakerId: null,
        hops: 0,
        acquiredRoomId: "a",
        acquiredCycle: 1,
      },
      ...overrides,
    };
    episodes.add(entry);
    return entry;
  };
  const tick = (seconds = 5, paused = false, cycle = 1) =>
    rumors.tick(world, player, cycle, seconds, paused);
  return {
    world,
    alice,
    bob,
    carol,
    david,
    episodes,
    rumors,
    player,
    add,
    tick,
  };
}

describe("nearby rumor exchange", () => {
  test("uses simulation time and emits one fact after a delayed frame without catching up", () => {
    const { add, tick, episodes, rumors } = setup();
    add();
    add();
    expect(tick(4)).toBeNull();
    expect(tick(100, true)).toBeNull();
    expect(rumors.snapshot().clockSeconds).toBe(4);
    const delivery = tick(1)!;
    expect(delivery.speakerId).toBe("alice");
    expect(delivery.listenerId).toBe("bob");
    expect(episodes.forObserver("bob", 1)).toHaveLength(1);
    expect(tick(1000)).not.toBeNull();
    expect(episodes.forObserver("bob", 1)).toHaveLength(2);
    expect(tick(0)).toBeNull();
    expect(tick(Number.NaN)).toBeNull();
  });

  test("requires a mutual nearby view in the same room", () => {
    const { world, bob, add, tick, episodes } = setup();
    add();
    bob.roomId = "b";
    expect(tick()).toBeNull();
    bob.roomId = "a";
    bob.x = 7;
    expect(tick()).toBeNull();
    bob.x = 5;
    const room = world.roomById.get("a")!;
    room.cells = room.cells.map(
      (line) => `${line.slice(0, 4)}#${line.slice(5)}`,
    );
    expect(tick()).toBeNull();
    expect(episodes.forObserver("bob", 1)).toEqual([]);
    room.cells = room.cells.map(
      (line) => `${line.slice(0, 4)}.${line.slice(5)}`,
    );
    expect(tick()).not.toBeNull();
  });

  test("transfers a heard copy with source attribution, never witnessed permissions", () => {
    const { add, tick, episodes } = setup();
    const source = add();
    const delivery = tick()!;
    const received = episodes.forObserver("bob", 1);
    expect(received).toHaveLength(1);
    expect(received[0]!).toMatchObject({
      text: source.text,
      originId: source.originId,
      kind: "action",
      provenance: {
        kind: "heard",
        originWitnessId: "alice",
        speakerId: "alice",
        hops: 1,
        acquiredRoomId: "a",
        acquiredCycle: 1,
      },
    });
    const original = episodes
      .snapshot()
      .episodes.find((entry) => entry.id === source.id)!;
    expect(original.observerIds).toEqual(["alice", "sleeper"]);
    expect(delivery.text).toContain("Алиса");
    expect(delivery.text).toContain("Борис");
    expect(delivery.text).toContain("красную чашку");
    expect(delivery.heardByPlayer).toBe(false);
  });

  test("shares with audible bystanders only, captured at delivery", () => {
    const { world, carol, david, player, add, tick, episodes } = setup();
    carol.roomId = "a";
    carol.x = 3;
    carol.y = 2;
    david.roomId = "a";
    david.x = 9;
    world.figures.push(carol, david);
    player.roomId = "a";
    player.x = 3;
    add();
    expect(tick()!.heardByPlayer).toBe(true);
    expect(episodes.forObserver("carol", 1)[0]!.provenance?.hops).toBe(1);
    expect(episodes.forObserver("player", 1)[0]!.provenance?.kind).toBe(
      "heard",
    );
    expect(episodes.forObserver("david", 1)).toEqual([]);
    david.x = 3;
    // Moving into earshot afterwards does not make an old rumor heard retroactively.
    expect(episodes.forObserver("david", 1)).toEqual([]);
  });

  test("two hops are possible across meetings; a third hop and same-tick cascade are not", () => {
    const { world, bob, carol, david, add, tick, episodes } = setup();
    const source = add();
    tick();
    world.figures = [bob, carol];
    bob.roomId = "b";
    expect(episodes.forObserver("carol", 1)).toEqual([]);
    const second = tick()!;
    expect(second.speakerId).toBe("bob");
    expect(second.text).toContain("Алиса");
    expect(episodes.forObserver("carol", 1)[0]).toMatchObject({
      originId: source.originId,
      provenance: {
        kind: "heard",
        originWitnessId: "alice",
        speakerId: "bob",
        hops: 2,
      },
    });
    world.figures = [carol, david];
    david.x = 3;
    expect(tick()).toBeNull();
    expect(episodes.forObserver("david", 1)).toEqual([]);
  });

  test("private, old-cycle, unknown-subject and unconfirmed speech never become rumors", () => {
    const { add, tick, episodes } = setup();
    add({ observerIds: ["sleeper"], text: "SLEEPER_ONLY" });
    add({ observerIds: ["player"], text: "PLAYER_PRIVATE" });
    add({ shareable: false, text: "NOT_SHAREABLE" });
    add({ kind: "dialogue", text: "OFFERED_PRIVATE_MEMORY" });
    add({ subjectActorId: "alice", text: "NPC_ACTION" });
    add({ subjectActorId: null, text: "HIDDEN_ACTOR" });
    add({ cycle: 0, text: "OLD_CYCLE" });
    add({ provenance: undefined, text: "LEGACY_UNSCOPED" });
    expect(tick()).toBeNull();
    expect(episodes.forObserver("bob", 1)).toEqual([]);
  });

  test("concrete actions outrank newer movement; pair cooldown survives reload", () => {
    const { world, player, add, tick, episodes, rumors } = setup();
    const action = add({ text: "FIRST_ACTION" });
    const newer = add({ text: "NEWER_ACTION" });
    add({ kind: "movement", text: "NEWEST_MOVEMENT" });
    expect(tick()!.originId).toBe(newer.originId!);
    const saved = rumors.snapshot();
    const resumed = new RumorExchange(episodes);
    resumed.restore(saved);
    expect(resumed.tick(world, player, 1, 55)).toBeNull();
    expect(resumed.tick(world, player, 1, 5)!.originId).toBe(action.originId!);
    expect(resumed.tick(world, player, 1, 5)).toBeNull();
  });

  test("deduplicates one origin from multiple witnesses and retains that knowledge after eviction", () => {
    const { world, player, add, tick, episodes, rumors } = setup();
    const source = add({ originId: "one-event" });
    tick();
    const saved = rumors.snapshot();
    episodes.clear();
    add({ ...source, id: "another-view-same-origin" });
    const resumed = new RumorExchange(episodes);
    resumed.restore(saved);
    expect(resumed.tick(world, player, 1, 65)).toBeNull();
    expect(episodes.forObserver("bob", 1)).toEqual([]);
  });

  test("silenced or absent figures do not participate", () => {
    const { world, bob, add, tick, episodes } = setup();
    add();
    for (const fate of ["broken", "dead", "gone"] as const) {
      world.fates.set(bob.id, {
        figureId: bob.id,
        fate,
        cycle: 1,
        roomId: "a",
        by: "press",
        remains: null,
        quoted: null,
      });
      expect(tick()).toBeNull();
    }
    world.fates.delete(bob.id);
    world.figures = world.figures.filter((figure) => figure.id !== bob.id);
    expect(tick()).toBeNull();
    expect(episodes.forObserver("bob", 1)).toEqual([]);
  });

  test("a new incarnation can learn again after explicit forgetting", () => {
    const { add, tick, episodes, rumors } = setup();
    add();
    tick();
    episodes.forgetObserver("bob");
    rumors.forgetFigure("bob");
    expect(tick()!.listenerId).toBe("bob");
    expect(episodes.forObserver("bob", 1)).toHaveLength(1);
  });

  test("cycle reset discards cooldown and dedup but never shares a previous cycle's facts", () => {
    const { add, tick, episodes, rumors } = setup();
    add();
    tick();
    expect(tick(5, false, 2)).toBeNull();
    expect(episodes.forObserver("bob", 2)).toEqual([]);
    const current = add({
      cycle: 2,
      provenance: {
        kind: "observed",
        originWitnessId: "alice",
        speakerId: null,
        hops: 0,
        acquiredRoomId: "a",
        acquiredCycle: 2,
      },
    });
    expect(tick(5, false, 2)!.originId).toBe(current.originId!);
    rumors.reset();
    expect(rumors.snapshot()).toEqual({
      cycle: null,
      clockSeconds: 0,
      elapsedSeconds: 0,
      cooldowns: [],
      seenOrigins: [],
    });
  });

  test("snapshot recovery is bounded and rejects malformed scheduler state", () => {
    const { rumors } = setup();
    rumors.restore({ cycle: 1, clockSeconds: Infinity, elapsedSeconds: 0 });
    expect(rumors.snapshot().cycle).toBeNull();
    rumors.restore({
      cycle: 1,
      clockSeconds: 20,
      elapsedSeconds: 4,
      cooldowns: [{ firstId: "alice", secondId: "bob", until: 9999 }, null],
      seenOrigins: Array.from({ length: 5000 }, (_, i) => ({
        figureId: "bob",
        originId: `event:${i}`,
      })),
    });
    const snapshot = rumors.snapshot();
    expect(snapshot.seenOrigins).toHaveLength(4096);
    expect(snapshot.cooldowns[0]!.until).toBe(80);
    snapshot.seenOrigins.length = 0;
    expect(rumors.snapshot().seenOrigins).toHaveLength(4096);
  });

  test("a new run clears both knowledge and scheduling before reusing the first cycle", () => {
    const { episodes, rumors, add, tick } = setup();
    add({ originId: "old-run-fact" });
    tick();
    rumors.reset();
    episodes.clear();
    expect(tick()).toBeNull();
    expect(episodes.forObserver("bob", 1)).toEqual([]);
    const current = add({ originId: "new-run-fact" });
    expect(tick()!.originId).toBe(current.originId!);
    expect(episodes.forObserver("bob", 1)).toHaveLength(1);
  });
});
