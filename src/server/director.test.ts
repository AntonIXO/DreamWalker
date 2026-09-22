import { describe, expect, test } from "bun:test";
import fixture from "../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../shared/dream";
import { directorPlanSchema, type DirectorRequest } from "../shared/director";
import { createWorld } from "../player/game/world";
import { snapshot } from "../player/mind/remote";
import {
  directorInput,
  directorInstructions,
  sanitiseDirectorPlan,
} from "./director";
import { sonArtifact } from "../../dreams/son/pack";
import { AgentRuntime } from "./agent-runtime";
import type { CodexAccountProcess } from "./codex-account";
import type { CycleExitRequestPayload } from "../shared/ai";
import { rollWallet } from "../shared/wallet";

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
  test("guidance keeps old plans compatible but refuses duplicate, executable or unbounded intentions", () => {
    const guidance = {
      figureId: "figure1",
      goalId: "keep-the-bench-clear",
      goal: "Keep the bench available for visitors",
      lifetimeSeconds: 80,
    };
    expect(directorPlanSchema.parse({ situations: [] })).toEqual({
      situations: [],
    });
    expect(
      directorPlanSchema.safeParse({
        situations: [],
        npcGuidance: [guidance, { ...guidance, goalId: "another-goal" }],
      }).success,
    ).toBe(false);
    for (const change of [
      { lifetimeSeconds: 4 },
      { lifetimeSeconds: 181 },
      { goal: "a".repeat(241) },
      { actions: [{ type: "leave" }] },
      { destination: { roomId: "a", x: 2, y: 2 } },
    ])
      expect(
        directorPlanSchema.safeParse({
          situations: [],
          npcGuidance: [{ ...guidance, ...change }],
        }).success,
      ).toBe(false);
  });

  test("only live NPCs receive guidance, while the Eye remains excluded", () => {
    const { artifact, request } = setup();
    const figure = request.world.figures[0]!;
    request.world.figures.push(
      { ...figure, id: "glaz" },
      { ...figure, id: "dead-figure", fate: "dead" },
    );
    const guidance = (figureId: string) => ({
      figureId,
      goalId: "guard-place",
      goal: "Keep the place tidy",
      lifetimeSeconds: 60,
    });
    for (const figureId of ["missing", "dead-figure", "glaz"])
      expect(
        sanitiseDirectorPlan(
          {
            situations: [],
            npcGuidance: [guidance("figure1"), guidance(figureId)],
          },
          artifact,
          request,
        ).npcGuidance,
      ).toEqual([guidance("figure1")]);
  });

  test("director sees stable guidance identities and pinned room restrictions", () => {
    const { artifact, request } = setup();
    const figure = request.world.figures[0]!;
    request.world.figures.push(
      { ...figure, id: "turyshev" },
      { ...figure, id: "glaz" },
    );
    const guidance = {
      figureId: "turyshev",
      goalId: "keep-the-bench-clear",
      goal: "Keep the bench available for visitors",
      lifetimeSeconds: 80,
    };
    request.activeNpcGuidance = [guidance];
    const input = JSON.parse(directorInput(artifact, request, []));
    expect(input.activeNpcGuidance).toEqual([guidance]);
    expect(input.npcGuidanceRestrictions).toContainEqual({
      figureId: "turyshev",
      allowed: true,
      roomId: artifact.spawn.roomId,
    });
    expect(input.npcGuidanceRestrictions).toContainEqual({
      figureId: "glaz",
      allowed: false,
      roomId: artifact.finaleRoomId,
    });
    expect(
      sanitiseDirectorPlan(
        { situations: [], npcGuidance: [guidance] },
        artifact,
        request,
      ).npcGuidance,
    ).toEqual([guidance]);
    expect(directorInstructions()).toContain("Reuse exactly the same goalId");
  });

  test("a dry-wallet crypto-bro stays in the authored metro in guidance, walks and reseating", () => {
    const artifact = sonArtifact();
    const runIds = Array.from(
      { length: 128 },
      (_, index) =>
        `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    );
    const dryRunId = runIds.find(
      (runId) => rollWallet(artifact.slug, runId, 0).wallet === "dry",
    );
    const fullRunId = runIds.find(
      (runId) => rollWallet(artifact.slug, runId, 0).wallet === "full",
    );
    expect(dryRunId).toBeDefined();
    expect(fullRunId).toBeDefined();
    const metro = artifact.rooms.find((room) => room.id.includes("metro"))!;
    expect(metro.kind).toBe("place");
    const request: DirectorRequest = {
      slug: artifact.slug,
      runId: dryRunId!,
      cycleNumber: 1,
      world: snapshot(createWorld(artifact)),
      elapsedSeconds: 10,
      signals: [],
      activeSituations: [],
    };
    const input = JSON.parse(directorInput(artifact, request, []));
    expect(input.npcGuidanceRestrictions).toContainEqual({
      figureId: "kripto-bro",
      allowed: true,
      roomId: metro.id,
    });
    const planFor = (roomId: string, kind: "walk" | "reseat") => ({
      situations: [
        {
          id: `crypto-bro-${kind}`,
          goal: "Keep the platform tidy",
          cause: "A visitor rearranged the luggage",
          lifetimeSeconds: 60,
          steps: [
            {
              id: "act",
              afterSeconds: 0,
              guards: [],
              effect:
                kind === "walk"
                  ? {
                      kind: "npc",
                      figureId: "kripto-bro",
                      destination: { roomId, x: 2, y: 2 },
                      actions: [],
                    }
                  : {
                      kind: "patch",
                      patch: {
                        kind: "moveFigure",
                        figureId: "kripto-bro",
                        toRoomId: roomId,
                        reason: "return to the platform",
                      },
                    },
            },
          ],
        },
      ],
    });
    for (const kind of ["walk", "reseat"] as const) {
      expect(
        sanitiseDirectorPlan(planFor(metro.id, kind), artifact, request)
          .situations,
      ).toHaveLength(1);
      expect(
        sanitiseDirectorPlan(
          planFor(artifact.spawn.roomId, kind),
          artifact,
          request,
        ).situations,
      ).toEqual([]);
      expect(
        sanitiseDirectorPlan(planFor(artifact.spawn.roomId, kind), artifact, {
          ...request,
          runId: fullRunId!,
        }).situations,
      ).toHaveLength(1);
    }
  });

  test("the Eye cannot change its pose by occupying or leaving a support", () => {
    const { artifact, request } = setup();
    request.world.figures.push({ ...request.world.figures[0]!, id: "glaz" });
    const objectId = request.world.objects[0]!.id;
    for (const action of [{ type: "occupy", objectId }, { type: "leave" }]) {
      const planFor = (figureId: string) => ({
        situations: [
          {
            id: "change-seat",
            goal: "Make room for a visitor",
            cause: "The bench is crowded",
            lifetimeSeconds: 60,
            steps: [
              {
                id: "act",
                afterSeconds: 0,
                guards: [],
                effect: { kind: "npc", figureId, actions: [action] },
              },
            ],
          },
        ],
      });
      expect(
        sanitiseDirectorPlan(planFor("figure1"), artifact, request).situations,
      ).toHaveLength(1);
      expect(
        sanitiseDirectorPlan(planFor("glaz"), artifact, request).situations,
      ).toEqual([]);
    }
  });

  test("a physical situation cannot also issue a competing guidance to that NPC", () => {
    const { artifact, request } = setup();
    const result = sanitiseDirectorPlan(
      {
        situations: [
          {
            id: "clear-bench",
            goal: "Clear the bench",
            cause: "A visitor needs a seat",
            lifetimeSeconds: 60,
            steps: [
              {
                id: "stand-up",
                afterSeconds: 0,
                guards: [],
                effect: {
                  kind: "npc",
                  figureId: "figure1",
                  actions: [{ type: "leave" }],
                },
              },
            ],
          },
        ],
        npcGuidance: [
          {
            figureId: "figure1",
            goalId: "sit-down",
            goal: "Stay on the bench",
            lifetimeSeconds: 60,
          },
        ],
      },
      artifact,
      request,
    );
    expect(result.situations).toHaveLength(1);
    expect(result.npcGuidance).toEqual([]);
  });

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
