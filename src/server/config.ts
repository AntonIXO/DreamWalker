/** AI SDK's Anthropic provider appends `/messages`; accept either proxy root or v1 root. */
export function normaliseAnthropicBaseURL(value: string): string {
  const root = value.trim().replace(/\/+$/, "");
  return root.endsWith("/v1") ? root : `${root}/v1`;
}

/** OpenAI-compatible clients already talk to a `/v1` root. */
export function normaliseOpenAIBaseURL(value: string): string {
  const root = value.trim().replace(/\/+$/, "");
  return root.endsWith("/v1") ? root : `${root}/v1`;
}

export type AiProviderMode = "codex" | "anthropic" | "openai";

/** Default model on the Anthropic-compatible Antigravity proxy. */
export const DEFAULT_ANTHROPIC_MODEL = "gemini-3.7-flash-high";

/** CloseRouter's public OpenAI-compatible root. */
export const DEFAULT_OPENAI_BASE_URL = "https://api.closerouter.dev/v1";

/** Default chat model on CloseRouter. */
export const DEFAULT_OPENAI_MODEL = "openai/gpt-5.6-luna";

export interface AnthropicBackend {
  baseURL: string;
  authToken: string;
  model: string;
}

export interface OpenAIBackend {
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface ResolvedAiBackend {
  mode: AiProviderMode;
  anthropic?: AnthropicBackend;
  openai?: OpenAIBackend;
}

function openaiKeyFrom(env: NodeJS.Dict<string>): string | undefined {
  return (
    env.OPENAI_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    env.CLOSEROUTER_API_KEY?.trim() ||
    undefined
  );
}

/**
 * Pick the inference backend from the environment.
 *
 * `DREAMWALKER_AI_PROVIDER` is the explicit switch (`openai` / `anthropic` / `codex`).
 * With no switch, an OpenAI-compatible key wins, then Anthropic, then Codex OAuth.
 */
export function resolveAiBackend(
  env: NodeJS.Dict<string> = process.env,
): ResolvedAiBackend {
  const requested = env.DREAMWALKER_AI_PROVIDER?.trim().toLowerCase();
  const openaiKey = openaiKeyFrom(env);
  const anthropicBase = env.ANTHROPIC_BASE_URL?.trim();
  const anthropicToken = env.ANTHROPIC_AUTH_TOKEN?.trim();
  const anthropicReady = Boolean(anthropicBase && anthropicToken);

  let mode: AiProviderMode;
  if (
    requested === "openai" ||
    requested === "anthropic" ||
    requested === "codex"
  ) {
    mode = requested;
  } else if (openaiKey) {
    mode = "openai";
  } else if (anthropicReady) {
    mode = "anthropic";
  } else {
    mode = "codex";
  }

  if (mode === "openai" && openaiKey) {
    return {
      mode,
      openai: {
        baseURL: normaliseOpenAIBaseURL(
          env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
        ),
        apiKey: openaiKey,
        model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      },
    };
  }
  if (mode === "anthropic" && anthropicReady) {
    return {
      mode,
      anthropic: {
        baseURL: normaliseAnthropicBaseURL(anthropicBase!),
        authToken: anthropicToken!,
        model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
      },
    };
  }
  return { mode: mode === "codex" ? "codex" : mode };
}
