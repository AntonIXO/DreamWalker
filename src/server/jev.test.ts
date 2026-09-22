import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fixture from "../shared/__fixtures__/tiny-dream.json";
import { sonArtifact } from "../../dreams/son/pack";
import { validateDreamArtifact } from "../shared/dream";
import { createWorld } from "../player/game/world";
import { snapshot } from "../player/mind/remote";
import type { NpcDecisionRequest, NpcTask } from "../shared/npc-decision";
import { resolveJevConfig } from "./config";
import {
  JevService,
  JEV_DECISIONS_URL,
  JEV_MAX_BODY_BYTES,
  npcDecisionResponse,
  type JevServiceOptions,
} from "./jev";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function answer(choice = "act", cost: number | undefined = 0.000126): Response {
  return Response.json({
    model: "typesafe/jev-test",
    answers: { next_action: { type: "choice", choice } },
    usage: { input_tokens: 3000, output_tokens: 0, cost },
  });
}
function setup(overrides: Partial<JevServiceOptions> = {}) {
  const artifact = validateDreamArtifact(structuredClone(fixture));
  const directory = mkdtempSync(join(tmpdir(), "dream-jev-service-"));
  directories.push(directory);
  const request: NpcDecisionRequest = {
    slug: artifact.slug,
    requestId: "request-1",
    runId: "run-1",
    cycleNumber: 1,
    figureId: "figure1",
    cause: { kind: "receipt", rootId: "event-1" },
    world: snapshot(createWorld(artifact)),
  };
  const task: NpcTask = {
    id: "task-1",
    figureId: request.figureId,
    summary: "Get up",
    actions: [{ type: "leave" }],
    dependencies: {
      figureId: request.figureId,
      objectIds: [],
      actorIds: [],
      doorIds: [],
    },
    contextKey: "relevant-state",
    lifetimeSeconds: 180,
    cause: request.cause,
  };
  const batch = {
    context: { figure: { id: request.figureId, personality: "Quiet" } },
    dependencies: task.dependencies,
    contextKey: "relevant-state",
    candidates: [
      { id: "act", description: "Get up", task },
      { id: "wait", description: "Wait", task: null },
    ],
  };
  const ledgerPath = join(directory, "usage.json");
  const service = new JevService({
    artifact,
    config: resolveJevConfig({ OPENROUTER_KEY: "test-secret" }),
    ledgerPath,
    fetch: async () => answer(),
    buildCandidates: () => batch,
    ...overrides,
  });
  return { service, request, task, batch, ledgerPath };
}

describe("independent event-driven Jev service", () => {
  test("the complete authored dream passes transport bounds and is reduced to one perspective", async () => {
    const artifact = sonArtifact();
    let sent = "";
    const { service, request } = setup({
      artifact,
      buildCandidates: undefined,
      fetch: async (_url, init) => {
        sent = init.body as string;
        return answer("wait");
      },
    });
    const world = snapshot(createWorld(artifact));
    expect(world.rooms.length).toBeGreaterThan(128);
    const result = await service.decide({
      ...request,
      slug: artifact.slug,
      figureId: "turyshev",
      world,
    });
    expect(result.status).toBe("wait");
    expect(result.diagnostics?.selectedId).toBe("wait");
    expect(Buffer.byteLength(sent)).toBeLessThan(31_000);
    expect(sent).not.toContain("geometry");
  });

  test("sends exact Decisions choice shape, returns only locally built actions", async () => {
    let sent: unknown;
    const { service, request, task, ledgerPath } = setup({
      fetch: async (url, init) => {
        expect(url).toBe(JEV_DECISIONS_URL);
        expect((init.headers as Record<string, string>).Authorization).toBe(
          "Bearer test-secret",
        );
        sent = JSON.parse(init.body as string);
        return answer();
      },
    });
    const result = await service.decide(request);
    expect(result.status).toBe("selected");
    expect(result.task).toEqual(task);
    expect(result.diagnostics).toMatchObject({
      model: "typesafe/jev-test",
      inputTokens: 3000,
      costUsd: 0.000126,
    });
    expect(sent).toMatchObject({
      model: "~typesafe/jev-latest",
      questions: {
        next_action: {
          type: "choice",
          criteria: { act: "Get up", wait: "Wait" },
        },
      },
    });
    const encoded = JSON.stringify(sent);
    expect(encoded).not.toContain("geometry");
    expect(encoded).not.toContain("secretHash");
    expect(readFileSync(ledgerPath, "utf8")).not.toContain("test-secret");
    expect(service.status()).toEqual({
      enabled: true,
      provider: "openrouter",
      model: "~typesafe/jev-latest",
    });
  });

  test("decision policy distinguishes an adopted NPC goal from idle habits and player commands", async () => {
    let instructions = "";
    const { service, request } = setup({
      fetch: async (_url, init) => {
        instructions = JSON.parse(init.body as string).questions.next_action
          .instructions;
        return answer();
      },
    });
    await service.decide({
      ...request,
      goal: {
        figureId: request.figureId,
        goalId: "deliver",
        goal: "Передай бутылку санитару",
        lifetimeSeconds: 180,
      },
    });
    // The classifier must know the authority and priority of these distinct inputs.
    expect(instructions).toMatch(
      /goal.*already adopted current intention from the sleeper\/director/,
    );
    expect(instructions).toMatch(
      /complete matching task over a preparatory subtask/,
    );
    expect(instructions).toMatch(
      /habitual pose or old routine.*prohibition.*cancels/,
    );
    expect(instructions).toMatch(
      /Without a current goal.*meaningful personal reason/,
    );
    expect(instructions).toMatch(
      /player's words alone do not become the NPC's adopted goal/i,
    );
  });

  test("wait is valid without confidence; provider failures are unavailable with no retry", async () => {
    const waiting = setup({ fetch: async () => answer("wait") });
    expect((await waiting.service.decide(waiting.request)).status).toBe("wait");
    let calls = 0;
    const failing = setup({
      fetch: async () => {
        calls++;
        return new Response("private upstream message", { status: 429 });
      },
    });
    const result = await failing.service.decide(failing.request);
    expect(result).toMatchObject({
      status: "unavailable",
      diagnostics: { reason: "provider_error" },
    });
    expect(calls).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private upstream message");
  });

  test("one inflight request serves all runs and has no busy narrative dependency", async () => {
    let finish!: (response: Response) => void;
    const { service, request } = setup({
      fetch: async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = service.decide(request);
    const second = await service.decide({ ...request, runId: "another-run" });
    expect(second).toMatchObject({
      status: "deferred",
      diagnostics: { reason: "busy" },
    });
    finish(answer());
    expect((await pending).status).toBe("selected");
  });

  test("unknown choice is rejected but reported cost is still charged", async () => {
    const { service, request, ledgerPath } = setup({
      fetch: async () => answer("invented-action"),
    });
    expect(await service.decide(request)).toMatchObject({
      status: "unavailable",
      diagnostics: { reason: "invalid_answer" },
    });
    expect(
      JSON.parse(readFileSync(ledgerPath, "utf8")).entries[0].costUsd,
    ).toBe(0.000126);
  });

  test("already aborted requests never call a provider; aborted inflight ones retain reservation", async () => {
    let calls = 0;
    const abort = new AbortController();
    const { service, request, ledgerPath } = setup({
      fetch: async (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new Error("abort")),
          ),
        );
      },
    });
    const pending = service.decide(request, abort.signal);
    abort.abort();
    expect(await pending).toMatchObject({
      status: "unavailable",
      diagnostics: { reason: "aborted" },
    });
    expect(
      await service.decide({ ...request, requestId: "next" }, abort.signal),
    ).toMatchObject({
      status: "unavailable",
      diagnostics: { reason: "aborted" },
    });
    expect(calls).toBe(1);
    const entry = JSON.parse(readFileSync(ledgerPath, "utf8")).entries[0];
    expect(entry.costUsd).toBeUndefined();
    expect(entry.reservedUsd).toBeGreaterThan(0);
  });

  test("the provider deadline aborts once and returns unavailable without waiting for another decision", async () => {
    let calls = 0;
    const { service, request } = setup({
      fetch: async (_url, init) => {
        calls++;
        return new Promise((_resolve, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new Error("timeout")),
          ),
        );
      },
    });
    const started = performance.now();
    expect(await service.decide(request)).toMatchObject({
      status: "unavailable",
      diagnostics: { reason: "timeout" },
    });
    expect(calls).toBe(1);
    expect(performance.now() - started).toBeLessThan(4500);
  });

  test("missing usage keeps the preflight reservation instead of pretending zero cost", async () => {
    const { service, request, ledgerPath } = setup({
      fetch: async () =>
        Response.json({
          model: "typesafe/jev-test",
          answers: { next_action: { type: "choice", choice: "act" } },
          usage: { input_tokens: 3000, output_tokens: 0 },
        }),
    });
    expect((await service.decide(request)).status).toBe("selected");
    expect(
      JSON.parse(readFileSync(ledgerPath, "utf8")).entries[0].costUsd,
    ).toBeUndefined();
  });

  test("requests, disabled config and excessive model context are rejected before billing", async () => {
    let calls = 0;
    const fixture = setup({
      fetch: async () => {
        calls++;
        return answer();
      },
    });
    expect(
      await fixture.service.decide({
        ...fixture.request,
        figureId: "invented",
      }),
    ).toMatchObject({
      status: "unavailable",
      diagnostics: { reason: "invalid_request" },
    });
    expect(
      await fixture.service.decide({ ...fixture.request, world: {} }),
    ).toMatchObject({ status: "unavailable" });
    const disabled = setup({
      config: resolveJevConfig({}),
      fetch: async () => {
        calls++;
        return answer();
      },
    });
    expect(await disabled.service.decide(disabled.request)).toMatchObject({
      diagnostics: { reason: "disabled" },
    });
    const oversized = setup({
      buildCandidates: () => ({
        ...fixture.batch,
        context: { text: "я".repeat(32_000) },
      }),
      fetch: async () => {
        calls++;
        return answer();
      },
    });
    expect(await oversized.service.decide(oversized.request)).toMatchObject({
      diagnostics: { reason: "context_limit" },
    });
    expect(calls).toBe(0);
  });

  test("only wait/continue options are resolved locally", async () => {
    const fixture = setup();
    let calls = 0;
    const { service, request } = setup({
      buildCandidates: () => ({
        ...fixture.batch,
        candidates: fixture.batch.candidates.filter(
          (candidate) => candidate.task === null,
        ),
      }),
      fetch: async () => {
        calls++;
        return answer();
      },
    });
    expect(await service.decide(request)).toMatchObject({
      status: "wait",
      diagnostics: { reason: "no_choice" },
    });
    expect(calls).toBe(0);
  });

  test("the JSON route bounds both declared and streamed body size", async () => {
    const { service, request } = setup();
    const url = "http://localhost/api/ai/npc-decision";
    const valid = await npcDecisionResponse(
      new Request(url, { method: "POST", body: JSON.stringify(request) }),
      service,
    );
    expect(valid.status).toBe(200);
    expect((await valid.json()).status).toBe("selected");
    expect(
      (
        await npcDecisionResponse(
          new Request(url, { method: "POST", body: "{" }),
          service,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await npcDecisionResponse(
          new Request(url, {
            method: "POST",
            body: "{}",
            headers: { "Content-Length": String(JEV_MAX_BODY_BYTES + 1) },
          }),
          service,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await npcDecisionResponse(
          new Request(url, {
            method: "POST",
            body: "x".repeat(JEV_MAX_BODY_BYTES + 1),
          }),
          service,
        )
      ).status,
    ).toBe(413);
  });
});
