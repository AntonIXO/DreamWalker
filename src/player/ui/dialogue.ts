/**
 * Talking to a figure of the dream.
 *
 * A free-text box, because §3 makes the *wording* the whole game: a precise question
 * buys more and costs more cover than a vague one, so the player has to weigh sentences
 * rather than pick from a list. Options would remove the only decision that matters.
 *
 * The panel is thin. It sends what was typed to the `DreamMind` and prints what comes
 * back, including the tell — which is rendered as the figure's own line, not as a
 * warning, because the moment it looks like a UI alert it stops being a conversation.
 */

import type { FigureState } from "../game/world";
import type { DreamMind, TurnResponse } from "../mind/types";

export interface DialogueCallbacks {
  onOpen(figure: FigureState): void;
  onClose(): void;
  onTell(figure: FigureState, quoted: string): void;
  onShard(shardId: string): void;
  onMemorySpent(memoryId: string): void;
  onJournal(figure: FigureState, text: string): void;
  onResonance(declaration: string): void;
}

export class DialoguePanel {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly memoryEl: HTMLSelectElement;
  private figure: FigureState | null = null;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private readonly mind: DreamMind,
    private readonly callbacks: DialogueCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "dialogue";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="dialogue-name"></div>
      <div class="dialogue-log"></div>
      <form class="dialogue-form">
        <input class="dialogue-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="что ты скажешь" maxlength="240" />
        <select class="dialogue-memory" aria-label="Предложить воспоминание">
          <option value="">не отдавать воспоминание</option>
        </select>
      </form>
      <div class="dialogue-hint">Esc — отойти</div>
    `;
    parent.appendChild(this.root);

    this.nameEl = this.root.querySelector(".dialogue-name")!;
    this.logEl = this.root.querySelector(".dialogue-log")!;
    this.inputEl = this.root.querySelector(".dialogue-input")!;
    this.memoryEl = this.root.querySelector(".dialogue-memory")!;

    this.root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get isWaiting(): boolean {
    return this.busy;
  }

  get currentFigureId(): string | null {
    return this.figure?.id ?? null;
  }

  private refreshMemories(): void {
    const previous = this.memoryEl.value;
    this.memoryEl.replaceChildren(new Option("не отдавать воспоминание", ""));
    for (const memory of this.mind.availableMemories()) {
      this.memoryEl.add(new Option(`отдать: ${memory.text}`, memory.id));
    }
    this.memoryEl.value = [...this.memoryEl.options].some(
      (option) => option.value === previous,
    )
      ? previous
      : "";
  }

  open(figure: FigureState): void {
    this.figure = figure;
    this.root.hidden = false;
    this.nameEl.textContent = figure.name;
    this.logEl.replaceChildren();
    for (const line of this.mind.conversation(figure.id)) {
      this.line(
        line.text,
        line.speaker === "sanitar" ? "said-by-you" : "said-by-them",
      );
    }
    this.refreshMemories();
    this.inputEl.value = "";
    this.inputEl.focus();
    this.callbacks.onOpen(figure);
  }

  close(): void {
    if (this.root.hidden) return;
    if (this.busy) this.mind.abort();
    this.root.hidden = true;
    this.figure = null;
    this.inputEl.blur();
    this.callbacks.onClose();
  }

  private line(text: string, className: string): HTMLElement {
    const node = document.createElement("p");
    node.className = className;
    node.textContent = text;
    this.logEl.appendChild(node);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return node;
  }

  private async send(): Promise<void> {
    const figure = this.figure;
    const utterance = this.inputEl.value.trim();
    if (!figure || !utterance || this.busy) return;

    this.busy = true;
    this.inputEl.value = "";
    this.inputEl.disabled = true;
    this.memoryEl.disabled = true;
    const offeredMemoryId = this.memoryEl.value || null;
    this.line(utterance, "said-by-you");

    // A figure taking a moment to answer is in character, but a panel that looks frozen
    // is not. The placeholder becomes the reply rather than sitting above it, so the
    // wait reads as this person thinking and never as a line they said.
    const pending = this.line("…", "said-by-them pending");

    let response: TurnResponse;
    try {
      response = await this.mind.turn(
        { figureId: figure.id, utterance, offeredMemoryId },
        (partial) => {
          if (this.figure !== figure) return;
          pending.textContent = partial || "…";
        },
      );
    } catch (error) {
      pending.className = "said-by-them";
      console.error(error);
      this.busy = false;
      this.inputEl.disabled = false;
      this.memoryEl.disabled = false;
      this.inputEl.focus();
      return;
    }

    // Walking away mid-answer is a legitimate move, and a model turn is slow enough to
    // make it a common one. Whatever they were going to say is lost, as it should be.
    if (this.figure !== figure) {
      this.busy = false;
      this.inputEl.disabled = false;
      this.memoryEl.disabled = false;
      return;
    }

    pending.textContent = response.reply;
    pending.className = "said-by-them";

    // A tell is already woven into the reply. Keeping it as metadata makes the cause
    // journalable without producing the unexplained yellow second sentence the old UI did.
    if (response.tell) {
      this.callbacks.onTell(figure, response.tell.quoted);
    }

    if (response.yieldedShardId)
      this.callbacks.onShard(response.yieldedShardId);

    if (response.journalEntry)
      this.callbacks.onJournal(figure, response.journalEntry);
    if (
      offeredMemoryId &&
      !this.mind
        .availableMemories()
        .some((memory) => memory.id === offeredMemoryId)
    ) {
      this.callbacks.onMemorySpent(offeredMemoryId);
    }

    if (response.resonance) {
      this.callbacks.onResonance(response.resonance.declaration);
    }

    this.busy = false;
    this.inputEl.disabled = false;
    this.memoryEl.disabled = false;
    this.refreshMemories();
    this.inputEl.focus();
  }

  destroy(): void {
    this.root.remove();
  }
}
