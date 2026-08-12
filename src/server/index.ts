import { resolve, sep } from "node:path";

import type {
  AiStreamEvent,
  CycleExitRequestPayload,
  DialogueRequestPayload,
  ExamineRequestPayload,
  FinaleRequestPayload,
  InhabitRequestPayload,
} from "../shared/ai";
import { AgentRuntime, AgentRuntimeError } from "./agent-runtime";
import { CodexAccountProcess } from "./codex-account";
import { DEFAULT_ANTHROPIC_MODEL, normaliseAnthropicBaseURL } from "./config";

const root = process.cwd();
const port = Number(process.env.DREAMWALKER_API_PORT ?? 8080);
const development = process.env.DREAMWALKER_DEV === "1";
const codexPath = process.env.DREAMWALKER_CODEX_PATH ?? "codex";
const codexHome = resolve(
  process.env.DREAMWALKER_CODEX_HOME ?? `${root}/.dreamwalker/codex-home`,
);
const configuredAnthropicBaseURL = process.env.ANTHROPIC_BASE_URL?.trim();
const anthropicBaseURL = configuredAnthropicBaseURL
  ? normaliseAnthropicBaseURL(configuredAnthropicBaseURL)
  : undefined;
const anthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
const anthropicModel =
  process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
const anthropic =
  anthropicBaseURL && anthropicAuthToken && anthropicModel
    ? {
        baseURL: anthropicBaseURL,
        authToken: anthropicAuthToken,
        model: anthropicModel,
      }
    : undefined;

const account = new CodexAccountProcess({
  codexPath,
  codexHome,
  verbose: process.env.DREAMWALKER_AI_VERBOSE === "1",
});
const agents = new AgentRuntime(account, {
  artifactPath: process.env.DREAMWALKER_ARTIFACT,
  secretPath: process.env.DREAMWALKER_SECRET_FILE,
  codexPath,
  codexHome,
  anthropic,
  verbose: process.env.DREAMWALKER_AI_VERBOSE === "1",
});

if (agents.providerMode === "codex") {
  await account.start();
  await account.refresh();
}

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch (error) {
    throw new AgentRuntimeError(
      "invalid_request",
      "Тело запроса должно быть JSON.",
      false,
      { cause: error },
    );
  }
}

function errorEvent(error: unknown): AiStreamEvent<never> {
  if (error instanceof AgentRuntimeError) {
    return {
      type: "error",
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    type: "error",
    code: "internal",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function streaming<T>(
  run: (emitPartial: (reply: string) => void) => Promise<T>,
): Response {
  const encoder = new TextEncoder();
  let open = true;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AiStreamEvent<T>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      // Population generation can take longer than an HTTP proxy's silent-response
      // window. Empty partials are valid NDJSON events and keep the connection alive;
      // clients without a visible streaming target simply ignore them.
      send({ type: "partial", reply: "" });
      keepAlive = setInterval(
        () => send({ type: "partial", reply: "" }),
        10_000,
      );
      void run((reply) => send({ type: "partial", reply }))
        .then((value) => send({ type: "result", value }))
        .catch((error) => send(errorEvent(error)))
        .finally(() => {
          if (keepAlive) clearInterval(keepAlive);
          keepAlive = null;
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // The client or Bun's HTTP layer may already have closed the body.
          }
        });
    },
    cancel() {
      open = false;
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function aiRoute<TPayload, TResult>(
  request: Request,
  handler: (
    payload: TPayload,
    signal: AbortSignal,
    emitPartial: (reply: string) => void,
  ) => Promise<TResult>,
): Promise<Response> {
  try {
    const payload = await readJson<TPayload>(request);
    return streaming((emit) => handler(payload, request.signal, emit));
  } catch (error) {
    return json(errorEvent(error), 400);
  }
}

function accountError(error: unknown): Response {
  return json(
    { error: error instanceof Error ? error.message : String(error) },
    400,
  );
}

async function api(
  request: Request,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/health" && request.method === "GET") {
    return json({
      ok: true,
      dream: agents.artifact.slug,
      provider: agents.providerMode,
    });
  }

  if (pathname === "/api/codex/account" && request.method === "GET") {
    if (agents.providerMode === "anthropic")
      return json(agents.connectionStatus());
    const snapshot = account.snapshot();
    return json(
      snapshot.state === "connected" || snapshot.state === "incompatible"
        ? snapshot
        : await account.refresh(),
    );
  }

  if (pathname === "/api/codex/login" && request.method === "POST") {
    if (agents.providerMode === "anthropic") {
      return json(
        { error: "Anthropic-compatible provider configured by the server." },
        409,
      );
    }
    try {
      return json(await account.startDeviceLogin());
    } catch (error) {
      return accountError(error);
    }
  }

  if (pathname === "/api/codex/login/cancel" && request.method === "POST") {
    try {
      const body = await readJson<{ loginId?: string }>(request);
      await account.cancelLogin(body.loginId);
      return json(account.snapshot());
    } catch (error) {
      return accountError(error);
    }
  }

  if (pathname === "/api/codex/logout" && request.method === "POST") {
    if (agents.providerMode === "anthropic") {
      return json(
        { error: "Anthropic-compatible provider is configured by the server." },
        409,
      );
    }
    try {
      agents.dispose();
      await account.logout();
      return json(account.snapshot());
    } catch (error) {
      return accountError(error);
    }
  }

  if (pathname === "/api/ai/dialogue" && request.method === "POST") {
    return aiRoute<
      DialogueRequestPayload,
      Awaited<ReturnType<typeof agents.dialogue>>
    >(request, (payload, signal, emit) =>
      agents.dialogue(payload, signal, emit),
    );
  }

  if (pathname === "/api/ai/inhabit" && request.method === "POST") {
    return aiRoute<
      InhabitRequestPayload,
      Awaited<ReturnType<typeof agents.inhabit>>
    >(request, (payload, signal) => agents.inhabit(payload, signal));
  }

  if (pathname === "/api/ai/examine" && request.method === "POST") {
    return aiRoute<
      ExamineRequestPayload,
      Awaited<ReturnType<typeof agents.examine>>
    >(request, (payload, signal) => agents.examine(payload, signal));
  }

  if (pathname === "/api/ai/cycle-exit" && request.method === "POST") {
    return aiRoute<
      CycleExitRequestPayload,
      Awaited<ReturnType<typeof agents.endCycle>>
    >(request, (payload, signal) => agents.endCycle(payload, signal));
  }

  if (pathname === "/api/ai/finale" && request.method === "POST") {
    return aiRoute<
      FinaleRequestPayload,
      Awaited<ReturnType<typeof agents.judge>>
    >(request, (payload, signal) => agents.judge(payload, signal));
  }

  if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
  return null;
}

async function staticFile(pathname: string): Promise<Response> {
  const dist = resolve(root, "dist");
  const requested = pathname === "/" ? "/index.html" : pathname;
  const path = resolve(dist, `.${decodeURIComponent(requested)}`);
  if (path !== dist && !path.startsWith(`${dist}${sep}`)) {
    return new Response("not found", { status: 404 });
  }
  const file = Bun.file(path);
  if (await file.exists()) return new Response(file);

  const index = Bun.file(resolve(dist, "index.html"));
  if (await index.exists()) return new Response(index);
  return new Response("Run `bun run build` first.", { status: 503 });
}

const server = Bun.serve({
  port,
  idleTimeout: 180,
  async fetch(request) {
    const url = new URL(request.url);
    const response = await api(request, url.pathname);
    if (response) return response;
    if (development) return new Response("not found", { status: 404 });
    return staticFile(url.pathname);
  },
});

console.log(
  `[dream-walker] ${development ? "API" : "game"} listening on ${server.url} (${agents.providerMode})`,
);

function shutdown(): void {
  agents.dispose();
  account.dispose();
  void server.stop(true);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
