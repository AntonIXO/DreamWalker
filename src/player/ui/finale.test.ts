import { describe, expect, spyOn, test } from "bun:test";

import { endingChrome, FinalePanel } from "./finale";

test("closing during the empty-wallet pause cancels the delayed ending", async () => {
  let finishPause: (() => void) | undefined;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
  ) => {
    finishPause = callback;
    return 0;
  }) as unknown as typeof setTimeout);
  let endings = 0;
  const panel = Object.create(FinalePanel.prototype);
  Object.assign(panel, {
    busy: false,
    ended: false,
    generation: 0,
    root: { hidden: false },
    submit: { disabled: false },
    inputs: [{ value: "word", disabled: false }],
    reply: { textContent: "", style: {} },
    mind: {
      judge: async () => ({ verdict: "match", wallet: "dry", reply: "empty" }),
      abort() {},
    },
    thinking: { run: (_label: string, task: () => Promise<unknown>) => task() },
    fullPhrase: () => [],
    callbacks: { onClose() {} },
    showEnding: () => {
      endings++;
    },
  });
  try {
    const pending = panel.judge();
    for (let i = 0; i < 5 && !finishPause; i++) await Promise.resolve();
    expect(finishPause).toBeDefined();
    panel.close();
    finishPause!();
    await pending;
    expect(panel.isWaiting).toBe(false);
    expect(panel.isOpen).toBe(false);
    expect(endings).toBe(0);
  } finally {
    timer.mockRestore();
  }
});

describe("endingChrome", () => {
  test("no ending leaves the walk-away button alive", () => {
    for (const kind of [
      "match",
      "empty",
      "unfinished",
      "resonance",
      "void",
      "walk-away",
      "locked",
    ] as const) {
      expect(endingChrome(kind).leaveHidden).toBe(true);
    }
  });

  test("only the void hides the close control", () => {
    expect(endingChrome("match").closeHidden).toBe(false);
    expect(endingChrome("void").closeHidden).toBe(true);
  });
});
