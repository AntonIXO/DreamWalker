import { describe, expect, test } from "bun:test";

import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_JEV_MODEL,
  normaliseAnthropicBaseURL,
  normaliseOpenAIBaseURL,
  resolveAiBackend,
  resolveJevConfig,
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

describe("resolveJevConfig", () => {
  test("only the server OpenRouter key enables NPC decisions", () => {
    expect(resolveJevConfig({}).enabled).toBe(false);
    expect(resolveJevConfig({ OPENAI_KEY: "other" }).enabled).toBe(false);
    expect(resolveJevConfig({ OPENROUTER_KEY: "  test  " })).toEqual({
      enabled: true,
      apiKey: "test",
      model: DEFAULT_JEV_MODEL,
      inputUsdPerMillion: 0.042,
    });
  });

  test.each(["0", "false"])("explicit %s disables decisions", (value) => {
    expect(
      resolveJevConfig({ OPENROUTER_KEY: "test", JEV_ENABLED: value }).enabled,
    ).toBe(false);
  });

  test("accepts a model and reservation rate override, rejects invalid rates", () => {
    expect(
      resolveJevConfig({
        JEV_MODEL: "typesafe/jev-1.13",
        JEV_INPUT_USD_PER_MILLION: "0.1",
      }),
    ).toMatchObject({
      model: "typesafe/jev-1.13",
      inputUsdPerMillion: 0.1,
    });
    expect(() =>
      resolveJevConfig({ JEV_INPUT_USD_PER_MILLION: "NaN" }),
    ).toThrow();
    expect(() =>
      resolveJevConfig({ JEV_INPUT_USD_PER_MILLION: "-1" }),
    ).toThrow();
    expect(() => resolveJevConfig({ JEV_ENABLED: "maybe" })).toThrow();
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
  test.each(["openai", "anthropic"])(
    "an explicitly selected %s backend cannot silently become Codex OAuth",
    (provider) => {
      expect(() =>
        resolveAiBackend({ DREAMWALKER_AI_PROVIDER: provider }),
      ).toThrow(`DREAMWALKER_AI_PROVIDER=${provider} requires`);
    },
  );

  test("without a provider or credentials, Codex remains the default", () => {
    expect(resolveAiBackend({})).toEqual({ mode: "codex" });
  });

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
