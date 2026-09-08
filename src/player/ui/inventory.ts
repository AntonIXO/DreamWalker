/** A live view of carried things and nearby targets, with one command at a time. */
export interface InventoryItem {
  id: string;
  name: string;
  status: string;
  thumbnailUrl?: string | null;
  canExamine?: boolean;
  canDrop?: boolean;
  containerId?: string | null;
}

export interface InventoryModel {
  held: InventoryItem[];
  nearby: InventoryItem[];
  roomName?: string;
  locale?: "ru" | "en";
}

export interface InventoryCallbacks {
  onClose(): void;
  onCommand(
    text: string,
    selectedObjectId: string | null,
  ): Promise<{ reply: string }>;
  onAction(
    action: "examine" | "drop",
    objectId: string,
  ): void | { reply?: string } | Promise<void | { reply?: string }>;
  onCancel?(): void;
}

const COPY = {
  ru: {
    title: "Вещи",
    label: "С собой и рядом",
    carried: "С собой",
    nearby: "Рядом",
    emptyHeld: "Вы пока ничего не несёте.",
    emptyNearby: "Поблизости нет доступных вещей.",
    selection: "Выбранная вещь",
    noSelection: "Выберите вещь или назовите её в команде.",
    examine: "Осмотреть",
    drop: "Положить у ног",
    close: "Закрыть · Esc",
    cancel: "Отменить",
    command: "Что сделать?",
    placeholder: "Например: отдай её Турышеву",
    submit: "Сделать",
    examples: ["Передай это человеку рядом", "Положи это в открытую сумку"],
    waiting: "Действие выполняется…",
    cancelled: "Действие отменено.",
    done: "Готово.",
    failed: "Не удалось выполнить действие. Попробуйте ещё раз.",
    inside: "внутри",
    record: "ЗАПИСЬ",
  },
  en: {
    title: "Things",
    label: "Carried and nearby",
    carried: "Carrying",
    nearby: "Nearby",
    emptyHeld: "You are not carrying anything yet.",
    emptyNearby: "No accessible objects nearby.",
    selection: "Selected object",
    noSelection: "Choose an object or name it in your command.",
    examine: "Examine",
    drop: "Put down",
    close: "Close · Esc",
    cancel: "Cancel",
    command: "What do you want to do?",
    placeholder: "For example: give it to Turyshev",
    submit: "Do it",
    examples: ["Give this to the person nearby", "Put this into the open bag"],
    waiting: "Carrying out the action…",
    cancelled: "Action cancelled.",
    done: "Done.",
    failed: "The action could not be completed. Try again.",
    inside: "inside",
    record: "NOTE",
  },
};

export class InventoryPanel {
  private readonly root: HTMLElement;
  private readonly heldList: HTMLElement;
  private readonly nearbyList: HTMLElement;
  private readonly selectedName: HTMLElement;
  private readonly selectedStatus: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly examineButton: HTMLButtonElement;
  private readonly dropButton: HTMLButtonElement;
  private readonly reply: HTMLElement;
  private readonly examples: HTMLElement;
  private model: InventoryModel = { held: [], nearby: [] };
  private selectedId: string | null = null;
  private signature = "";
  private busy = false;
  private generation = 0;
  private previousFocus: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: InventoryCallbacks,
  ) {
    this.root = document.createElement("section");
    this.root.className = "panel inventory-panel";
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.innerHTML = `
      <header class="panel-title-row inventory-header">
        <div><span class="system-label inventory-label"></span><h2 class="inventory-title"></h2></div>
        <button class="ghost inventory-close" type="button"></button>
      </header>
      <p class="inventory-room dim"></p>
      <div class="inventory-columns">
        <section><h3 class="inventory-held-heading"></h3><div class="inventory-list inventory-held"></div></section>
        <section><h3 class="inventory-nearby-heading"></h3><div class="inventory-list inventory-nearby"></div></section>
      </div>
      <div class="inventory-selection">
        <span class="system-label inventory-selection-label"></span>
        <strong class="inventory-selected-name"></strong><p class="inventory-selected-status dim"></p>
        <div class="inventory-quick"><button class="ghost inventory-examine" type="button"></button><button class="ghost inventory-drop" type="button"></button></div>
      </div>
      <form class="inventory-form">
        <label class="inventory-command-label"><span></span><input class="inventory-command" type="text" maxlength="600" autocomplete="off" spellcheck="false"></label>
        <div class="inventory-examples"></div>
        <div class="inventory-command-actions"><button class="inventory-submit" type="submit"></button><button class="ghost inventory-cancel" type="button" hidden></button></div>
      </form>
      <p class="inventory-reply" role="status" aria-live="polite" aria-atomic="true" hidden></p>
    `;
    parent.appendChild(this.root);
    this.heldList = this.root.querySelector(".inventory-held")!;
    this.nearbyList = this.root.querySelector(".inventory-nearby")!;
    this.selectedName = this.root.querySelector(".inventory-selected-name")!;
    this.selectedStatus = this.root.querySelector(
      ".inventory-selected-status",
    )!;
    this.input = this.root.querySelector(".inventory-command")!;
    this.submitButton = this.root.querySelector(".inventory-submit")!;
    this.cancelButton = this.root.querySelector(".inventory-cancel")!;
    this.examineButton = this.root.querySelector(".inventory-examine")!;
    this.dropButton = this.root.querySelector(".inventory-drop")!;
    this.reply = this.root.querySelector(".inventory-reply")!;
    this.examples = this.root.querySelector(".inventory-examples")!;
    this.root
      .querySelector(".inventory-close")!
      .addEventListener("click", () => this.close());
    this.cancelButton.addEventListener("click", () => this.cancel());
    this.examineButton.addEventListener(
      "click",
      () => void this.quickAction("examine"),
    );
    this.dropButton.addEventListener(
      "click",
      () => void this.quickAction("drop"),
    );
    this.input.addEventListener("input", () => this.syncControls());
    this.root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.sendCommand();
    });
    this.root.addEventListener("keydown", (event) => this.onKey(event));
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }
  get isWaiting(): boolean {
    return this.busy;
  }
  get selectedObjectId(): string | null {
    return this.selectedId;
  }
  private get copy() {
    return COPY[this.model.locale ?? "ru"];
  }

  refresh(model: InventoryModel): void {
    const signature = JSON.stringify(model);
    if (signature === this.signature) return;
    this.model = model;
    this.signature = signature;
    // An accepted command can remove its own item. Let its response settle rather
    // than cancelling a completed give/drop as the live inventory refreshes.
    if (!this.busy && !this.selectedItem()) this.selectedId = null;
    if (this.isOpen) this.render();
  }

  open(initialObjectId: string | null = null): void {
    if (this.busy) return;
    if (!this.isOpen)
      this.previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    this.selectedId = initialObjectId ?? this.selectedId;
    if (!this.selectedItem())
      this.selectedId =
        this.model.held[0]?.id ?? this.model.nearby[0]?.id ?? null;
    this.root.hidden = false;
    this.setReply("");
    this.render();
    this.input.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    const waiting = this.busy;
    this.generation++;
    this.busy = false;
    this.root.hidden = true;
    this.syncControls();
    if (waiting) this.callbacks.onCancel?.();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
    this.callbacks.onClose();
  }

  cancel(): void {
    if (!this.busy) return;
    this.generation++;
    this.busy = false;
    this.syncControls();
    this.setReply(this.copy.cancelled);
    this.callbacks.onCancel?.();
    this.input.focus();
  }

  private selectedItem(): InventoryItem | null {
    return (
      [...this.model.held, ...this.model.nearby].find(
        (item) => item.id === this.selectedId,
      ) ?? null
    );
  }

  private select(id: string): void {
    if (this.busy) return;
    this.selectedId = id;
    this.render();
    this.input.focus();
  }

  private render(): void {
    const previouslyFocused = document.activeElement;
    const hadPanelFocus =
      previouslyFocused instanceof HTMLElement &&
      this.root.contains(previouslyFocused);
    const focusedItemId =
      previouslyFocused instanceof HTMLElement
        ? previouslyFocused.dataset.itemId
        : undefined;
    const copy = this.copy;
    this.root.setAttribute("aria-label", copy.title);
    const text = (selector: string, value: string) => {
      this.root.querySelector(selector)!.textContent = value;
    };
    text(".inventory-title", copy.title);
    text(".inventory-label", copy.label);
    text(".inventory-close", copy.close);
    text(".inventory-room", this.model.roomName ?? "");
    text(
      ".inventory-held-heading",
      `${copy.carried} · ${this.model.held.length}`,
    );
    text(
      ".inventory-nearby-heading",
      `${copy.nearby} · ${this.model.nearby.length}`,
    );
    text(".inventory-selection-label", copy.selection);
    text(".inventory-command-label > span", copy.command);
    this.input.placeholder = copy.placeholder;
    this.submitButton.textContent = copy.submit;
    this.cancelButton.textContent = copy.cancel;
    this.examineButton.textContent = copy.examine;
    this.dropButton.textContent = copy.drop;
    this.renderList(this.heldList, this.model.held, copy.emptyHeld);
    this.renderList(this.nearbyList, this.model.nearby, copy.emptyNearby);
    const selected = this.selectedItem();
    this.selectedName.textContent = selected?.name ?? copy.noSelection;
    this.selectedStatus.textContent = selected?.status ?? "";
    this.examples.replaceChildren();
    for (const example of copy.examples) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost inventory-example";
      button.textContent = example;
      button.addEventListener("click", () => {
        if (this.busy) return;
        this.input.value = example;
        this.syncControls();
        this.input.focus();
      });
      this.examples.appendChild(button);
    }
    this.syncControls();
    if (
      hadPanelFocus &&
      previouslyFocused instanceof HTMLElement &&
      !previouslyFocused.isConnected
    ) {
      const replacement = focusedItemId
        ? [
            ...this.root.querySelectorAll<HTMLButtonElement>(".inventory-item"),
          ].find((button) => button.dataset.itemId === focusedItemId)
        : undefined;
      (replacement ?? (this.busy ? this.cancelButton : this.input)).focus();
    }
  }

  private renderList(
    list: HTMLElement,
    items: InventoryItem[],
    empty: string,
  ): void {
    list.replaceChildren();
    if (items.length === 0) {
      const note = document.createElement("p");
      note.className = "inventory-empty dim";
      note.textContent = empty;
      list.appendChild(note);
      return;
    }
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inventory-item";
      button.dataset.itemId = item.id;
      button.setAttribute("aria-pressed", String(item.id === this.selectedId));
      const art = document.createElement("span");
      art.className = "inventory-item-art";
      art.setAttribute("aria-hidden", "true");
      art.textContent = "◇";
      if (item.thumbnailUrl) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = item.thumbnailUrl;
        image.addEventListener("error", () => image.remove());
        art.appendChild(image);
      }
      const details = document.createElement("span");
      details.className = "inventory-item-copy";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const status = document.createElement("span");
      status.className = "inventory-item-status";
      status.textContent = item.status;
      details.append(name, status);
      if (item.containerId) {
        const container = [...this.model.held, ...this.model.nearby].find(
          (candidate) => candidate.id === item.containerId,
        );
        const inside = document.createElement("span");
        inside.className = "inventory-item-container";
        inside.textContent = container
          ? `${this.copy.inside}: ${container.name}`
          : this.copy.inside;
        details.appendChild(inside);
      }
      button.append(art, details);
      button.addEventListener("click", () => this.select(item.id));
      list.appendChild(button);
    }
  }

  private syncControls(): void {
    const selected = this.selectedItem();
    this.root.setAttribute("aria-busy", String(this.busy));
    this.input.disabled = this.busy;
    this.submitButton.disabled = this.busy || !this.input.value.trim();
    this.cancelButton.hidden = !this.busy;
    this.examineButton.disabled = this.busy || !selected?.canExamine;
    this.dropButton.disabled = this.busy || !selected?.canDrop;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      ".inventory-item, .inventory-example",
    ))
      button.disabled = this.busy;
  }

  private setReply(text: string, failed = false): void {
    this.reply.hidden = !text;
    this.reply.textContent = text ? `${this.copy.record} — ${text}` : "";
    this.reply.dataset.error = String(failed);
  }

  private async sendCommand(): Promise<void> {
    const text = this.input.value.trim();
    if (!this.isOpen || this.busy || !text) return;
    const selectedId = this.selectedItem()?.id ?? null;
    await this.run(() => this.callbacks.onCommand(text, selectedId));
  }

  private async quickAction(action: "examine" | "drop"): Promise<void> {
    const selected = this.selectedItem();
    if (
      !this.isOpen ||
      this.busy ||
      !selected ||
      !(action === "examine" ? selected.canExamine : selected.canDrop)
    )
      return;
    await this.run(() => this.callbacks.onAction(action, selected.id));
  }

  private async run(
    task: () => void | { reply?: string } | Promise<void | { reply?: string }>,
  ): Promise<void> {
    const generation = ++this.generation;
    this.busy = true;
    this.syncControls();
    this.setReply(this.copy.waiting);
    this.cancelButton.focus();
    try {
      const result = await task();
      if (generation !== this.generation || !this.isOpen) return;
      this.setReply(result?.reply ?? this.copy.done);
    } catch (error) {
      if (generation !== this.generation || !this.isOpen) return;
      const aborted = error instanceof Error && error.name === "AbortError";
      this.setReply(aborted ? this.copy.cancelled : this.copy.failed, !aborted);
    } finally {
      if (generation === this.generation && this.isOpen) {
        this.busy = false;
        if (!this.selectedItem()) this.selectedId = null;
        this.render();
        this.input.focus();
      }
    }
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.busy) this.cancel();
      else this.close();
    } else if (event.key === "Tab") {
      const focusable = [
        ...this.root.querySelectorAll<HTMLElement>(
          "button:not(:disabled):not([hidden]), input:not(:disabled)",
        ),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === this.root)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  destroy(): void {
    this.close();
    this.root.remove();
  }
}
