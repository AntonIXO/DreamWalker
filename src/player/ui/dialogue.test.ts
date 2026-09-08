import { expect, test } from "bun:test";
import { DialoguePanel } from "./dialogue";
import type { TurnResponse } from "../mind/types";

test("a cancelled answer cannot unlock a reopened conversation with the same figure", async () => {
  // Exercise the real async handler; rendering and speech are incidental to this race.
  const pending: Array<{ reject(error: Error): void }> = [];
  const panel = Object.create(DialoguePanel.prototype);
  const figure = { id: "figure1", name: "Сосед" };
  Object.assign(panel, {
    figure,
    busy: false,
    turnGeneration: 0,
    root: { hidden: false },
    inputEl: { value: "hello", disabled: false, blur() {}, focus() {} },
    memoryEl: { value: "", disabled: false },
    leverageEl: { value: "", disabled: false },
    voice: { halt() {}, currentStatus: "idle" },
    mind: {
      abort() {},
      turn: () =>
        new Promise<TurnResponse>((_resolve, reject) =>
          pending.push({ reject }),
        ),
    },
    thinking: { run: (_label: string, task: () => Promise<unknown>) => task() },
    callbacks: { onClose() {} },
    line: () => ({ remove() {} }),
    paintFace() {},
    refreshVoiceChrome() {},
    refreshMemories() {},
    syncVoice() {},
  });
  const first = panel.send();
  panel.close();
  expect(panel.isWaiting).toBe(false);
  // Reopen before the aborted fetch settles, using the same live FigureState.
  panel.figure = figure;
  panel.root.hidden = false;
  panel.inputEl.value = "second question";
  const second = panel.send();
  expect(pending).toHaveLength(2);
  pending[0]!.reject(new DOMException("cancelled", "AbortError"));
  await first;
  expect(panel.isWaiting).toBe(true);
  expect(panel.inputEl.disabled).toBe(true);
  pending[1]!.reject(new DOMException("cancelled", "AbortError"));
  await second;
  expect(panel.isWaiting).toBe(false);
});
