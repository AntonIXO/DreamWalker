/** AI SDK's Anthropic provider appends `/messages`; accept either proxy root or v1 root. */
export function normaliseAnthropicBaseURL(value: string): string {
  const root = value.trim().replace(/\/+$/, "");
  return root.endsWith("/v1") ? root : `${root}/v1`;
}
