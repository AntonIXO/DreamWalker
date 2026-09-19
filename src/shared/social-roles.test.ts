import { describe, expect, test } from "bun:test";
import { compilePhysicalProfile } from "./object-profile";
import { createWorldMutator, executeWorldAction } from "./world-action-engine";
import {
  captureWorldAction,
  createWorldMind,
  recordWorldAction,
} from "./world-mind";
import {
  perceivedPlayerIdentity,
  recordRoleReport,
  recordRoleWitnesses,
  type RoleRecognitionState,
} from "./social-roles";
import type { WorldObjectState } from "./world-object";
import type { WorldActionEnvelope } from "./world-action";

function setup() {
  const profile = {
    kind: "garment",
    wear: { slot: "body", appearanceFigureId: "hudozhnik" },
  } as const;
  const coat: WorldObjectState = {
    id: "coat",
    name: "пиджак",
    profile,
    ...compilePhysicalProfile(profile),
    location: { kind: "held", actor: { kind: "player" } },
    body: null,
    visual: { role: null, image: null },
    interaction: null,
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: null,
    uiAction: null,
  };
  const world = createWorldMutator({
    objects: [coat],
    playerPose: { roomId: "a", x: 2, y: 2 },
    figurePoses: [
      ["witness", { roomId: "a", x: 3, y: 2 }],
      ["stranger", { roomId: "b", x: 3, y: 2 }],
    ],
    isWalkableTile: () => true,
  });
  const envelope: WorldActionEnvelope = {
    actor: { kind: "player" },
    source: "player",
    action: { type: "wear", objectId: "coat" },
  };
  const before = captureWorldAction(world, envelope);
  const result = executeWorldAction(world, envelope);
  const event = recordWorldAction(
    createWorldMind(),
    world,
    envelope,
    result,
    before,
    1,
  )!;
  const recognition: RoleRecognitionState = {};
  recordRoleWitnesses(recognition, world.objects, event);
  return {
    world,
    coat,
    event,
    recognition,
    snapshot: () => ({ objects: world.objects, roleRecognition: recognition }),
  };
}

describe("assumed roles and recognition", () => {
  test("a witness knows the substitution while a stranger sees the role; identity and ownership stay player", () => {
    const { coat, snapshot } = setup();
    expect(perceivedPlayerIdentity(snapshot(), "witness").recognition).toBe(
      "recognized",
    );
    expect(perceivedPlayerIdentity(snapshot(), "stranger").recognition).toBe(
      "role",
    );
    expect(perceivedPlayerIdentity(snapshot(), "hudozhnik").recognition).toBe(
      "recognized",
    );
    expect(coat.location).toEqual({ kind: "held", actor: { kind: "player" } });
    expect(coat.state.wornBy).toEqual({ kind: "player" });
  });

  test("recognition survives a checkpoint and removing then replacing the garment", () => {
    const { coat, recognition } = setup();
    coat.state.wornBy = null;
    expect(
      perceivedPlayerIdentity(
        { objects: [coat], roleRecognition: recognition },
        "witness",
      ).roleId,
    ).toBeNull();
    coat.state.wornBy = { kind: "player" };
    const snapshot = structuredClone({
      objects: [coat],
      roleRecognition: recognition,
    });
    expect(perceivedPlayerIdentity(snapshot, "witness").recognition).toBe(
      "recognized",
    );
  });

  test("a report preserves its source and does not turn hearsay into direct observation", () => {
    const { recognition, event, snapshot } = setup();
    recordRoleReport(recognition, {
      speakerId: "witness",
      listenerId: "stranger",
      originId: `world:1:${event.sequence}`,
    });
    expect(perceivedPlayerIdentity(snapshot(), "stranger")).toMatchObject({
      recognition: "uncertain",
      evidence: [{ sourceId: "witness" }],
    });
    recordRoleReport(recognition, {
      speakerId: "stranger",
      listenerId: "witness",
      originId: `world:1:${event.sequence}`,
    });
    expect(perceivedPlayerIdentity(snapshot(), "witness").recognition).toBe(
      "recognized",
    );
  });

  test("unrelated reports and unseen proposals grant no recognition", () => {
    const { recognition } = setup();
    recordRoleReport(recognition, {
      speakerId: "witness",
      listenerId: "stranger",
      originId: "world:9:999",
    });
    expect(recognition.stranger).toBeUndefined();
  });
});
