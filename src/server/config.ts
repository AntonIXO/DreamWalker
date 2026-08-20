/** AI SDK's Anthropic provider appends `/messages`; accept either proxy root or v1 root. */
export function normaliseAnthropicBaseURL(value: string): string {
  const root = value.trim().replace(/\/+$/, "");
  return root.endsWith("/v1") ? root : `${root}/v1`;
}

/** Default model on the Anthropic-compatible Antigravity proxy. */
export const DEFAULT_ANTHROPIC_MODEL = "gemini-3.7-flash-high";
