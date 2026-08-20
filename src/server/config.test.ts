import { describe, expect, test } from "bun:test";

import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  normaliseAnthropicBaseURL,
  normaliseOpenAIBaseURL,
  resolveAiBackend,
} from "./config";

describe("normaliseAnthropicBaseURL", () => {
  test("adds the Anthropic v1 segment to a proxy root", () => {
    expect(normaliseAnthropicBaseURL("http://proxy.test/anthropic")).toBe(
      "http://proxy.test/anthropic/v1",
    );
  });

  test("does not duplicate an existing v1 segment", () => {
    expect(normaliseAnthropicBaseURL("http://proxy.test/anthropic/v1/")).toBe(
      "http://proxy.test/anthropic/v1",
    );
  });
});

describe("normaliseOpenAIBaseURL", () => {
  test("keeps CloseRouter's /v1 root", () => {
    expect(normaliseOpenAIBaseURL("https://api.closerouter.dev/v1")).toBe(
      DEFAULT_OPENAI_BASE_URL,
    );
  });
});

describe("resolveAiBackend", () => {
  test("an OPENAI_KEY selects CloseRouter without an explicit switch", () => {
    const backend = resolveAiBackend({
      OPENAI_KEY: "closerouter_test",
      ANTHROPIC_BASE_URL: "http://proxy.test/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token",
    });
    expect(backend.mode).toBe("openai");
    expect(backend.openai?.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(backend.openai?.baseURL).toBe(DEFAULT_OPENAI_BASE_URL);
  });

  test("DREAMWALKER_AI_PROVIDER=anthropic keeps the Messages proxy", () => {
    const backend = resolveAiBackend({
      DREAMWALKER_AI_PROVIDER: "anthropic",
      OPENAI_KEY: "closerouter_test",
      ANTHROPIC_BASE_URL: "http://proxy.test/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token",
    });
    expect(backend.mode).toBe("anthropic");
  });
});
