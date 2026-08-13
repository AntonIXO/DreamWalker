import { describe, expect, test } from "bun:test";

import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  test("turns bible emphasis into tags", () => {
    expect(renderMarkdown("рот открывается **не в такт смеху**")).toBe(
      "рот открывается <strong>не в такт смеху</strong>",
    );
    expect(renderMarkdown("ты *внутри*")).toBe("ты <em>внутри</em>");
    expect(renderMarkdown("смотри `E`")).toBe("смотри <code>E</code>");
  });

  test("escapes HTML before applying marks", () => {
    expect(renderMarkdown('<script>alert("x")</script> **дальше**')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; <strong>дальше</strong>",
    );
  });

  test("leaves unfinished marks alone", () => {
    expect(renderMarkdown("ещё **не закрыто")).toBe("ещё **не закрыто");
  });

  test("does not treat word_underscores as italic", () => {
    expect(renderMarkdown("secret_hash остаётся")).toBe("secret_hash остаётся");
  });

  test("keeps a system prefix around a marked phrase", () => {
    expect(renderMarkdown("ЗАПИСЬ — **пыль на номерках**")).toBe(
      "ЗАПИСЬ — <strong>пыль на номерках</strong>",
    );
  });
});
