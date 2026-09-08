import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import { Cycle } from "./cycle";
import { createPlayer } from "./player";
import { createWorld, resetWorld } from "./world";
import { RunStore, restoreWorld, snapshotWorld, type RunSave } from "./save";
import {
  captureWorldAction,
  createWorldMind,
  recordWorldAction,
} from "../../shared/world-mind";
import { executeWorldAction } from "../../shared/world-action-engine";
import type { WorldActionEnvelope } from "../../shared/world-action";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { ObservationLog } from "../mind/observation";

function setup() {
  const artifact = validateDreamArtifact(structuredClone(fixture));
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const store = new RunStore(artifact, () => storage);
  const world = createWorld(artifact);
  const cycle = new Cycle(artifact);
  const observations = new ObservationLog();
  const snapshot = (): RunSave => ({
    world: snapshotWorld(world),
    session: {
      player: createPlayer(world.rooms[0]!, artifact.spawn.entryId),
      meta: {
        roomId: world.rooms[0]!.id,
        remainingMs: 2345,
        returnTo: {
          roomId: world.rooms[0]!.id,
          entryId: artifact.spawn.entryId,
        },
      },
      dwellMs: new Map([["waiting", 1200]]),
    },
    cycle: cycle.snapshot(),
    observations: observations.snapshot(world),
    heartbeatCalls: 2,
    memory: {
      runId: "test-run",
      knownShardIds: ["shard"],
      sleeper: { summary: "summary", tells: [] },
      memories: [],
      exhaustion: 0.3,
    },
    journal: [{ cycle: 2, at: "now", text: "Remember this" }],
    notebook: { words: ["one", "", "", "", "", ""], observedClueIds: ["clue"] },
    conversations: new Map([
      [
        "npc",
        {
          summary: "Recognizes the player",
          lines: [{ speaker: "sanitar", text: "Hello" }],
        },
      ],
    ]),
    ending: null,
  });
  return {
    artifact,
    data,
    storage,
    store,
    world,
    cycle,
    observations,
    snapshot,
  };
}

describe("run checkpoints", () => {
  test("adding authored container capabilities upgrades old saves without losing carried items or words", () => {
    const { artifact, store, storage, world, snapshot } = setup();
    const prop = artifact.rooms.flatMap((room) => room.props)[0]!;
    const existing = world.objectById.get(prop.id)!;
    existing.location = { kind: "held", actor: { kind: "player" } };
    existing.state.inscription = "пометка";
    const saved = snapshot();
    saved.commands = [
      { speaker: "player", text: "Отметь вещь" },
      { speaker: "world", text: "Пометка осталась." },
    ];
    expect(store.write(saved)).toBe(true);
    const upgraded = structuredClone(artifact);
    upgraded.rooms
      .flatMap((room) => room.props)
      .find((item) => item.id === prop.id)!.container = "open";
    const restored = new RunStore(upgraded, () => storage).load(upgraded);
    expect(restored.unavailable).toBe(false);
    expect(restored.save?.commands).toEqual(saved.commands);
    const next = createWorld(upgraded);
    restoreWorld(next, restored.save!.world);
    expect(next.objectById.get(prop.id)?.location).toEqual({
      kind: "held",
      actor: { kind: "player" },
    });
    expect(next.objectById.get(prop.id)?.state).toMatchObject({
      open: true,
      inscription: "пометка",
    });
    expect(next.objectById.get(prop.id)?.tags).toContain("container");
    expect(restored.save?.notebook.words[0]).toBe("one");
    const incompatible = structuredClone(upgraded);
    incompatible.title += "changed";
    expect(
      new RunStore(incompatible, () => storage).load(incompatible).unavailable,
    ).toBe(true);
  });

  test("round trip preserves live state, shared indexes and the next cycle baseline", () => {
    const { artifact, store, world, cycle, observations, snapshot } = setup();
    cycle.restart();
    cycle.update(12.5);
    cycle.extend(120_000);
    observations.noteApproach("npc");
    observations.noteBeat();
    observations.tick(12.5, world.currentRoomId);
    world.keysHeld.add("key");
    world.flags.set("story", true);
    world.leverage.set("npc", new Set(["secret"]));
    world.visitCounts.set(world.currentRoomId, 4);
    const room = world.rooms[0]!;
    room.closedHotspotIds.add("used");
    room.doors[0]!.type = "sealed";
    world.objects[0]!.name = "Changed object";
    const save = snapshot();
    save.session.player.x += 7;
    expect(store.write(save)).toBe(true);
    const loaded = store.load(artifact).save!;
    expect(loaded).toEqual(save);

    const restored = createWorld(artifact);
    const roomReference = restored.rooms[0];
    restoreWorld(restored, loaded.world);
    expect(restored.rooms[0]).toBe(roomReference);
    expect(restored.roomById.get(room.id)).toBe(roomReference);
    expect(restored.doorById.get(room.doors[0]!.id)).toBe(
      restored.rooms[0]!.doors[0],
    );
    expect(restored.objectById.get(restored.objects[0]!.id)).toBe(
      restored.objects[0],
    );
    expect(restored.keysHeld.has("key")).toBe(true);
    expect(restored.leverage.get("npc")?.has("secret")).toBe(true);
    const resumedCycle = new Cycle(artifact);
    resumedCycle.restore(loaded.cycle);
    expect(resumedCycle.number).toBe(2);
    expect(resumedCycle.remainingSeconds).toBe(cycle.remainingSeconds);
    const resumedObservations = new ObservationLog();
    resumedObservations.restore(loaded.observations);
    expect(resumedObservations.snapshot(restored)).toEqual(loaded.observations);
    resetWorld(restored, 2);
    expect(restored.objects[0]!.name).toBe(world.baseObjects[0]!.name);
    expect(restored.keysHeld.size).toBe(0);
    expect(restored.visitCounts.get(room.id)).toBe(4);
  });

  test("physical receipts survive a save and disappear at the next cycle", () => {
    const { artifact, store, world, snapshot } = setup();
    const mutator = bindWorldMutator(
      world,
      staticPlayerPose({ roomId: "a", x: 9, y: 4 }),
    );
    const envelope: WorldActionEnvelope = {
      actor: { kind: "player" },
      source: "player",
      action: { type: "take", objectId: "shelf" },
    };
    const before = captureWorldAction(mutator, envelope);
    const result = executeWorldAction(mutator, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(world.worldMind, mutator, envelope, result, before, 2);
    expect(store.write(snapshot())).toBe(true);
    const loaded = store.load(artifact).save!;
    const resumed = createWorld(artifact);
    restoreWorld(resumed, loaded.world);
    expect(resumed.worldMind).toEqual(world.worldMind);
    resumed.worldMind.events[0]!.before.objects[0]!.name =
      "changed restored copy";
    expect(loaded.world.worldMind?.events[0]?.before.objects[0]?.name).not.toBe(
      "changed restored copy",
    );
    resetWorld(resumed, 3);
    expect(resumed.worldMind).toEqual(createWorldMind());
  });

  test("checkpoints created before World Mind restore with empty physical history", () => {
    const { artifact, store, world, snapshot } = setup();
    const older = snapshot();
    delete older.world.worldMind;
    expect(store.write(older)).toBe(true);
    const loaded = store.load(artifact).save!;
    expect(loaded).not.toBeNull();
    restoreWorld(world, loaded.world);
    expect(world.worldMind).toEqual(createWorldMind());
  });

  test("refuses damaged, unknown-version and changed-pack saves without deleting them", () => {
    const { artifact, data, store, snapshot, storage } = setup();
    store.write(snapshot());
    const valid = data.get(store.key)!;
    for (const raw of [
      "{",
      valid.replace('"version":1', '"version":99'),
      valid.replace("Remember this", "damaged"),
    ]) {
      data.set(store.key, raw);
      expect(store.load(artifact)).toEqual({ save: null, unavailable: true });
      expect(data.get(store.key)).toBe(raw);
    }
    data.set(store.key, valid);
    const changed = structuredClone(artifact);
    changed.cycle.durationMs++;
    expect(new RunStore(changed, () => storage).load(changed).save).toBeNull();
  });

  test("quota failures retain the last checkpoint and blocked storage does not throw", () => {
    const { artifact, data, store, snapshot, storage } = setup();
    store.write(snapshot());
    const previous = data.get(store.key);
    const full = new RunStore(artifact, () => ({
      ...storage,
      setItem() {
        throw new Error("quota");
      },
    }));
    expect(full.write(snapshot())).toBe(false);
    expect(data.get(store.key)).toBe(previous);
    const blocked = new RunStore(artifact, () => {
      throw new Error("blocked");
    });
    expect(blocked.load(artifact).save).toBeNull();
    expect(blocked.write(snapshot())).toBe(false);
  });

  test("saves terminal outcomes and expired cycles instead of reviving a finished run", () => {
    const { artifact, store, snapshot, cycle } = setup();
    cycle.update(artifact.cycle.durationMs / 1000);
    const save = snapshot();
    save.ending = { kind: "void", text: "Nothing left" };
    store.write(save);
    expect(store.load(artifact).save?.ending).toEqual(save.ending);
    expect(store.load(artifact).save?.cycle.remainingMs).toBe(0);
  });
});
