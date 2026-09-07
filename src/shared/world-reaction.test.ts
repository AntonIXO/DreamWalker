/**
 * Pack scripts react to WorldEvents by dispatching WorldActions.
 * Physics live in the engine; these tests inject a fake executor.
 */

import { describe, expect, test } from "bun:test";

import type { DreamScript, ScriptFlag } from "./pack";
import type {
  WorldAction,
  WorldActionEnvelope,
  WorldActionResult,
  WorldEvent,
} from "./world-action";
import type { WorldMutator } from "./world-object";
import {
  physicalGestures,
  runReactions,
  type ExecuteWorldAction,
  type WorldReactionHost,
} from "./world-reaction";

function okResult(
  overrides: Partial<WorldActionResult> = {},
): WorldActionResult {
  return {
    ok: true,
    refusal: null,
    affectedRooms: [],
    affectedObjects: [],
    events: [],
    ...overrides,
  };
}

function fakeHost(
  overrides: Partial<WorldReactionHost> = {},
): WorldReactionHost & {
  dispatched: WorldAction[];
  flags: Map<string, ScriptFlag>;
} {
  const flags = new Map<string, ScriptFlag>();
  const dispatched: WorldAction[] = [];
  const host: WorldReactionHost & {
    dispatched: WorldAction[];
    flags: Map<string, ScriptFlag>;
  } = {
    currentRoomId: "room-a",
    exhaustion: 0,
    cycleNumber: 1,
    dispatched,
    flags,
    getFlag: (key) => flags.get(key),
    setFlag: (key, value) => {
      flags.set(key, value);
    },
    dispatch: (action) => {
      dispatched.push(action);
      return okResult();
    },
    ...overrides,
  };
  return host;
}

describe("runReactions", () => {
  test("object.used lets a script dispatch open (key → door)", () => {
    const host = fakeHost();
    const scripts: DreamScript[] = [
      {
        id: "key-door",
        onWorldEvent(reactionHost, event) {
          if (event.type !== "object.used") return;
          if (event.objectId !== "brass-key") return;
          if (event.targetId !== "cellar-door") return;
          reactionHost.dispatch({ type: "open", targetId: "cellar-door" });
        },
      },
    ];
    const event: WorldEvent = {
      type: "object.used",
      objectId: "brass-key",
      targetId: "cellar-door",
      actor: { kind: "player" },
    };

    const actions = runReactions(host, [event], scripts);

    expect(actions).toEqual([{ type: "open", targetId: "cellar-door" }]);
    expect(host.dispatched).toEqual(actions);
  });

  test("object.taken can notify a witness script via setFlag", () => {
    const host = fakeHost();
    const scripts: DreamScript[] = [
      {
        id: "witness",
        onWorldEvent(reactionHost, event) {
          if (event.type !== "object.taken") return;
          if (event.objectId !== "bottle") return;
          reactionHost.setFlag("saw-bottle-taken", true);
        },
      },
    ];

    runReactions(
      host,
      [
        {
          type: "object.taken",
          objectId: "bottle",
          actor: { kind: "figure", id: "npc-1" },
          fromRoomId: "room-a",
        },
      ],
      scripts,
    );

    expect(host.getFlag("saw-bottle-taken")).toBe(true);
    expect(host.dispatched).toEqual([]);
  });

  test("object.given dispatch payload names the new holder", () => {
    const host = fakeHost();
    const scripts: DreamScript[] = [
      {
        id: "handoff",
        onWorldEvent(reactionHost, event) {
          if (event.type !== "object.taken") return;
          reactionHost.dispatch({
            type: "give",
            objectId: event.objectId,
            to: { kind: "player" },
          });
        },
      },
    ];

    const actions = runReactions(
      host,
      [
        {
          type: "object.taken",
          objectId: "bottle",
          actor: { kind: "figure", id: "npc-1" },
          fromRoomId: "room-a",
        },
      ],
      scripts,
    );

    expect(actions).toEqual([
      { type: "give", objectId: "bottle", to: { kind: "player" } },
    ]);
  });

  test("dispatch of embodied actions cannot express shiftWalls", () => {
    const host = fakeHost();
    host.dispatch({ type: "open", targetId: "a-to-b" });
    expect(host.dispatched.every((action) => !("variantId" in action))).toBe(
      true,
    );
  });
});

describe("physicalGestures", () => {
  test("ScriptHost wrappers call dispatch with equivalent WorldActions", () => {
    const dispatched: WorldAction[] = [];
    const gestures = physicalGestures((action) => {
      dispatched.push(action);
      return okResult();
    });

    gestures.openDoor("cellar-door");
    gestures.removeProp("notes");
    gestures.closeHotspot("monitor");

    expect(dispatched).toEqual([
      { type: "open", targetId: "cellar-door" },
      { type: "take", objectId: "notes" },
      { type: "close", targetId: "monitor" },
    ]);
  });
});

describe("injected executor", () => {
  test("a fake execute records source and action without take/drop physics", () => {
    const envelopes: WorldActionEnvelope[] = [];
    const execute: ExecuteWorldAction = (
      _world: WorldMutator,
      envelope: WorldActionEnvelope,
    ) => {
      envelopes.push(envelope);
      return okResult({
        events: [
          {
            type: "object.used",
            objectId: "brass-key",
            targetId: "cellar-door",
            actor: envelope.actor,
          },
        ],
      });
    };
    const world = {} as WorldMutator;
    const result = execute(world, {
      actor: { kind: "script", id: "key-door" },
      source: "script",
      action: { type: "use", objectId: "brass-key", targetId: "cellar-door" },
    });

    expect(result.ok).toBe(true);
    expect(envelopes[0]?.source).toBe("script");
    expect(envelopes[0]?.action).toEqual({
      type: "use",
      objectId: "brass-key",
      targetId: "cellar-door",
    });
  });
});
