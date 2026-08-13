/**
 * Player-facing comments are authored (and often returned by the sleeper) as markdown.
 * The UI is DOM, not Pixi text, so this turns a safe subset into HTML.
 *
 * HTML is escaped first. Model output and journal lines are untrusted; a raw
 * `<script>` in a reply must never become a tag.
 */

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPE[ch] ?? ch);
}

/**
 * Inline marks that actually appear in the bible and in sleeper replies:
 * `**bold**`, `*italic*`, `` `code` ``. Block structure is left to CSS
 * (`white-space: pre-line`) so a `<p>` comment stays a `<p>`.
 */
export function renderMarkdown(source: string): string {
  const slots: string[] = [];
  const stash = (html: string): string => {
    slots.push(html);
    return `%%md${slots.length - 1}%%`;
  };

  let text = escapeHtml(source);
  text = text.replace(/`([^`]+)`/g, (_match, code: string) =>
    stash(`<code>${code}</code>`),
  );
  text = text.replace(
    /\*\*(.+?)\*\*|__(.+?)__/g,
    (_match, a: string, b: string) => stash(`<strong>${a ?? b}</strong>`),
  );
  text = text.replace(
    /(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g,
    (_match, body: string) => stash(`<em>${body}</em>`),
  );
  text = text.replace(
    /(?<![A-Za-z0-9_])_(?!\s)([^_]+?)(?<!\s)_(?![A-Za-z0-9_])/g,
    (_match, body: string) => stash(`<em>${body}</em>`),
  );
  return text.replace(/%%md(\d+)%%/g, (_match, index: string) => {
    return slots[Number(index)] ?? "";
  });
}

/** Paint a comment. Replaces children; the source string is not kept on the node. */
export function setMarkdown(node: HTMLElement, source: string): void {
  node.innerHTML = renderMarkdown(source);
}
