import { describe, expect, test } from "bun:test";

import { normaliseAnthropicBaseURL } from "./config";

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
