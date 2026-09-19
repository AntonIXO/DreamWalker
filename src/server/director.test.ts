import { describe, expect, test } from "bun:test";
import fixture from "../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../shared/dream";
import { directorPlanSchema, type DirectorRequest } from "../shared/director";
import { createWorld } from "../player/game/world";
import { snapshot } from "../player/mind/remote";
import { directorInput, sanitiseDirectorPlan } from "./director";
import { sonArtifact } from "../../dreams/son/pack";
import { AgentRuntime } from "./agent-runtime";
import type { CodexAccountProcess } from "./codex-account";
import type { CycleExitRequestPayload } from "../shared/ai";

function setup() {
  const artifact = validateDreamArtifact(structuredClone(fixture));
  const world = createWorld(artifact);
  const request: DirectorRequest = {
    slug: artifact.slug,
    runId: "test",
    cycleNumber: 1,
    world: snapshot(world),
    elapsedSeconds: 10,
    signals: ["player borrowed a coat"],
    activeSituations: [],
  };
  return { artifact, world, request };
}

describe("finite director plans", () => {
  test("keeps the whole catalogue but bounds detailed scenes instead of repeating world geometry", () => {
    const artifact = sonArtifact();
    const world = snapshot(createWorld(artifact));
    const input = directorInput(
      artifact,
      {
        slug: artifact.slug,
        runId: "test",
        cycleNumber: 1,
        world,
        elapsedSeconds: 0,
        signals: [],
        activeSituations: [],
      },
      [],
    );
    const payload = JSON.parse(input);
    expect(payload.catalogue.rooms).toHaveLength(world.rooms.length);
    expect(payload.catalogue.objects).toHaveLength(world.objects.length);
    expect(payload.catalogue.figures).toHaveLength(world.figures.length);
    expect(payload.world.rooms.length).toBeLessThanOrEqual(4);
    expect(payload.world.objects.length).toBeLessThanOrEqual(48);
    expect(payload.figurePerspectives.length).toBeLessThanOrEqual(8);
    expect(payload.world.geometry).toBeUndefined();
    expect(input.length).toBeLessThan(60_000);
  });
  test("foreground acquisition aborts background generation without inheriting its busy lock", async () => {
    const runtime = new AgentRuntime(
      { refresh: async () => undefined } as unknown as CodexAccountProcess,
      { codexPath: "codex", codexHome: ".dreamwalker/codex-home" },
    );
    const world = createWorld(runtime.artifact);
    let finish!: (value: unknown) => void;
    let generated = false;
    (
      runtime as unknown as {
        generate: (...args: unknown[]) => Promise<unknown>;
      }
    ).generate = async () => {
      generated = true;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const request: DirectorRequest = {
      slug: runtime.artifact.slug,
      runId: "00000000-0000-4000-8000-000000000001",
      cycleNumber: 1,
      world: snapshot(world),
      elapsedSeconds: 10,
      signals: [],
      activeSituations: [],
    };
    const pending = runtime.direct(request, new AbortController().signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(generated).toBe(true);
    // Wrong slug exits immediately, but it first acquires the foreground channel.
    await expect(
      runtime.endCycle(
        { slug: "another-dream" } as CycleExitRequestPayload,
        new AbortController().signal,
      ),
    ).rejects.toThrow("another-dream");
    finish({ situations: [] });
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    runtime.dispose();
  });
  test("accepts a new composition without requiring an authored template", () => {
    const { artifact, world, request } = setup();
    const result = sanitiseDirectorPlan(
      {
        situations: [
          {
            id: "new-combination",
            goal: "Make room for the fitting",
            cause: "The coat was borrowed",
            lifetimeSeconds: 80,
            steps: [
              {
                id: "respond",
                afterSeconds: 5,
                guards: [
                  { kind: "actorRoom", actor: { kind: "player" }, roomId: "a" },
                ],
                effect: {
                  kind: "npc",
                  figureId: world.figures[0]!.id,
                  actions: [],
                  reply: "Примерочная занята.",
                },
              },
            ],
          },
        ],
      },
      artifact,
      request,
    );
    expect(result.situations).toHaveLength(1);
  });

  test("rejects a whole causal chain containing an invented object or executable effect", () => {
    const { artifact, world, request } = setup();
    const base = {
      id: "invalid",
      goal: "An opportunity",
      cause: "A request",
      lifetimeSeconds: 80,
      steps: [
        {
          id: "act",
          afterSeconds: 0,
          guards: [],
          effect: {
            kind: "npc",
            figureId: world.figures[0]!.id,
            actions: [{ type: "take", objectId: "not-in-this-dream" }],
            reply: "Готово.",
          },
        },
      ],
    };
    expect(
      sanitiseDirectorPlan({ situations: [base] }, artifact, request)
        .situations,
    ).toEqual([]);
    expect(
      directorPlanSchema.safeParse({
        situations: [
          {
            ...base,
            steps: [
              {
                id: "code",
                afterSeconds: 0,
                guards: [],
                effect: { kind: "script", code: "world.tiles.clear()" },
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("enforces total action limits across situations and refuses non-rift retargets", () => {
    const { artifact, world, request } = setup();
    const step = {
      id: "act",
      afterSeconds: 0,
      guards: [],
      effect: {
        kind: "npc",
        figureId: world.figures[0]!.id,
        actions: Array.from({ length: 5 }, () => ({ type: "leave" })),
      },
    };
    const base = {
      id: "a",
      goal: "a",
      cause: "a",
      lifetimeSeconds: 60,
      steps: [step],
    };
    expect(
      directorPlanSchema.safeParse({ situations: [base, { ...base, id: "b" }] })
        .success,
    ).toBe(false);
    const result = sanitiseDirectorPlan(
      {
        situations: [
          {
            ...base,
            steps: [
              {
                ...step,
                effect: {
                  kind: "patch",
                  patch: {
                    kind: "retargetDoor",
                    doorId: "a-to-b",
                    toRoomId: "a",
                    reason: "a",
                  },
                },
              },
            ],
          },
        ],
      },
      artifact,
      request,
    );
    expect(result.situations).toEqual([]);
  });

  test("an already exposed authored passage is not offered as hidden again", () => {
    const { artifact, request } = setup();
    artifact.rooms[0]!.doors[0]!.hidden = true;
    const visible = JSON.parse(directorInput(artifact, request, []));
    expect(
      visible.structuralOptions.flatMap(
        (room: { hiddenThresholds: unknown[] }) => room.hiddenThresholds,
      ),
    ).toHaveLength(0);
    request.world.doors = request.world.doors.filter(
      (door) => door.id !== artifact.rooms[0]!.doors[0]!.id,
    );
    const hidden = JSON.parse(directorInput(artifact, request, []));
    expect(
      hidden.structuralOptions.flatMap(
        (room: { hiddenThresholds: unknown[] }) => room.hiddenThresholds,
      ),
    ).toHaveLength(1);
  });
});
