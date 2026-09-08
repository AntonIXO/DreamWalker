import { describe, expect, test } from "bun:test";
import type {
  WorldAction,
  WorldActionEnvelope,
} from "../../shared/world-action";
import { replayNpcActions, replayPlayerActions } from "./action-feedback";

const actions: WorldAction[] = [
  { type: "take", objectId: "cup" },
  { type: "give", objectId: "cup", to: { kind: "player" } },
  { type: "close", targetId: "box" },
];

describe("NPC execution feedback", () => {
  test("actual refusal replaces the planned success and stops the remaining actions", () => {
    const envelopes: WorldActionEnvelope[] = [];
    const result = replayNpcActions(
      "neighbor",
      actions,
      (envelope) => {
        envelopes.push(envelope);
        return envelopes.length === 1
          ? {
              ok: true,
              refusal: null,
              events: [
                {
                  type: "object.taken",
                  objectId: "cup",
                  actor: envelope.actor,
                  fromRoomId: "a",
                },
              ],
              affectedRooms: ["a"],
              affectedObjects: ["cup"],
            }
          : {
              ok: false,
              refusal: "player moved away",
              events: [],
              affectedRooms: [],
              affectedObjects: [],
            };
      },
      () => 7,
    );
    expect(result.ok).toBe(false);
    expect(result.executed).toBe(2);
    expect(result.execution.filter((receipt) => receipt.ok)).toHaveLength(1);
    expect(envelopes.map((envelope) => envelope.actor)).toEqual([
      { kind: "figure", id: "neighbor" },
      { kind: "figure", id: "neighbor" },
    ]);
    expect(
      result.execution.map(({ ok, refusal }) => ({ ok, refusal })),
    ).toEqual([
      { ok: true, refusal: null },
      { ok: false, refusal: "player moved away" },
    ]);
    expect(
      result.execution.every((receipt) => receipt.worldRevision === 7),
    ).toBe(true);
  });

  test("a thrown engine failure is remembered even though no action succeeded", () => {
    const result = replayNpcActions(
      "neighbor",
      actions,
      () => {
        throw new Error("world changed");
      },
      () => 9,
    );
    expect(result.ok).toBe(false);
    expect(result.execution).toEqual([
      {
        action: actions[0]!,
        ok: false,
        refusal: "world changed",
        events: [],
        worldRevision: 9,
      },
    ]);
  });
});

test("player command rejects an NPC impersonation or teleport before applying any prefix", () => {
  for (const invalid of [
    {
      actor: { kind: "figure", id: "neighbor" },
      source: "npc",
      action: actions[0]!,
    },
    {
      actor: { kind: "player" },
      source: "player",
      action: { type: "moveTo", x: 3, y: 3 },
    },
  ] as WorldActionEnvelope[]) {
    let executed = 0;
    const outcome = replayPlayerActions(
      [
        { actor: { kind: "player" }, source: "player", action: actions[0]! },
        invalid,
      ],
      () => {
        executed++;
        return {
          ok: true,
          refusal: null,
          events: [],
          affectedObjects: [],
          affectedRooms: [],
        };
      },
      () => 0,
    );
    expect(outcome.ok).toBe(false);
    expect(executed).toBe(0);
  }
});
