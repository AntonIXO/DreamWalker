import { describe, expect, test } from "bun:test";
import { InventoryPanel, type InventoryModel } from "./inventory";

function setup() {
  const requests: Array<{
    text: string;
    selected: string | null;
    resolve(value: { reply: string }): void;
    reject(error: Error): void;
  }> = [];
  const actions: string[] = [];
  let cancellations = 0;
  let closed = 0;
  const model: InventoryModel = {
    held: [
      {
        id: "cup",
        name: "Чашка",
        status: "Мокрая",
        canExamine: true,
        canDrop: true,
      },
    ],
    nearby: [],
  };
  // Rendering is incidental here; exercise the panel's real command/cancel lifecycle.
  const panel = Object.create(InventoryPanel.prototype);
  Object.assign(panel, {
    root: { hidden: false, setAttribute() {}, querySelectorAll: () => [] },
    model,
    selectedId: "cup",
    signature: "",
    busy: false,
    generation: 0,
    previousFocus: null,
    input: { value: "отдай её Турышеву", disabled: false, focus() {} },
    submitButton: { disabled: false },
    cancelButton: { hidden: true, focus() {} },
    examineButton: { disabled: false },
    dropButton: { disabled: false },
    reply: { hidden: true, textContent: "", dataset: {} },
    render: () => panel.syncControls(),
    callbacks: {
      onClose: () => closed++,
      onCancel: () => cancellations++,
      onCommand: (text: string, selected: string | null) =>
        new Promise<{ reply: string }>((resolve, reject) =>
          requests.push({ text, selected, resolve, reject }),
        ),
      onAction: (action: string, objectId: string) => {
        actions.push(`${action}:${objectId}`);
      },
    },
  });
  return {
    panel,
    requests,
    actions,
    cancellations: () => cancellations,
    closed: () => closed,
  };
}

describe("inventory command lifecycle", () => {
  test("submits the selected live object once and prevents parallel commands", async () => {
    const { panel, requests } = setup();
    const pending = panel.sendCommand();
    await panel.sendCommand();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.selected).toBe("cup");
    expect(requests[0]?.text).toBe("отдай её Турышеву");
    expect(panel.isWaiting).toBe(true);
    expect(panel.input.disabled).toBe(true);
    requests[0]!.resolve({ reply: "Турышев взял чашку." });
    await pending;
    expect(panel.isWaiting).toBe(false);
    expect(panel.reply.textContent).toContain("Турышев взял чашку.");
  });

  test("closing and reopening cannot apply a late response or unlock a new command", async () => {
    const { panel, requests, cancellations, closed } = setup();
    const old = panel.sendCommand();
    panel.close();
    expect(cancellations()).toBe(1);
    expect(closed()).toBe(1);
    panel.root.hidden = false;
    panel.input.value = "осмотри чашку";
    const current = panel.sendCommand();
    requests[0]!.resolve({ reply: "old response" });
    await old;
    expect(panel.isWaiting).toBe(true);
    expect(panel.input.disabled).toBe(true);
    expect(panel.reply.textContent).not.toContain("old response");
    requests[1]!.resolve({ reply: "new response" });
    await current;
    expect(panel.reply.textContent).toContain("new response");
  });

  test("cancel invalidates late success and leaves the panel ready for a new command", async () => {
    const { panel, requests, cancellations } = setup();
    const old = panel.sendCommand();
    panel.cancel();
    expect(panel.isOpen).toBe(true);
    expect(panel.isWaiting).toBe(false);
    expect(cancellations()).toBe(1);
    requests[0]!.resolve({ reply: "late action" });
    await old;
    expect(panel.reply.textContent).toContain("отменено");
    expect(panel.reply.textContent).not.toContain("late action");
  });

  test("refresh after a successful give does not cancel its own in-flight command", async () => {
    const { panel, requests, cancellations } = setup();
    const pending = panel.sendCommand();
    panel.refresh({ held: [], nearby: [] });
    expect(panel.isWaiting).toBe(true);
    expect(cancellations()).toBe(0);
    requests[0]!.resolve({ reply: "Чашку забрали." });
    await pending;
    expect(panel.selectedObjectId).toBeNull();
    expect(panel.reply.textContent).toContain("Чашку забрали.");
  });

  test("an explicit command can run without a selected object; blank text cannot", async () => {
    const { panel, requests } = setup();
    panel.refresh({ held: [], nearby: [] });
    panel.input.value = "   ";
    await panel.sendCommand();
    expect(requests).toHaveLength(0);
    panel.input.value = "возьми книгу со стола";
    const pending = panel.sendCommand();
    expect(requests[0]?.selected).toBeNull();
    requests[0]!.resolve({ reply: "Книга в руках." });
    await pending;
  });

  test("quick actions enforce supplied capability and cannot act on removed selections", async () => {
    const { panel, actions } = setup();
    panel.model.held[0].canDrop = false;
    await panel.quickAction("drop");
    expect(actions).toEqual([]);
    await panel.quickAction("examine");
    expect(actions).toEqual(["examine:cup"]);
    panel.refresh({ held: [], nearby: [] });
    await panel.quickAction("examine");
    expect(actions).toEqual(["examine:cup"]);
  });

  test("failed callbacks restore controls and show a retryable error", async () => {
    const { panel, requests } = setup();
    const pending = panel.sendCommand();
    requests[0]!.reject(new Error("transport failed"));
    await pending;
    expect(panel.isWaiting).toBe(false);
    expect(panel.input.disabled).toBe(false);
    expect(panel.reply.dataset.error).toBe("true");
    expect(panel.reply.textContent).toContain("Попробуйте ещё раз");
  });
});
