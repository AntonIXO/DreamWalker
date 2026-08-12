import type { DreamArtifact } from "../../shared/dream";
import type { WordNotebook } from "../game/wordNotebook";
import type { DreamMind } from "../mind/types";
import type { ModelThinkingIndicator } from "./modelThinking";

export interface FinaleCallbacks {
  onOpen(): void;
  onClose(): void;
  onEnded(kind: "match" | "resonance" | "walk-away"): void;
}

export class FinalePanel {
  private readonly root: HTMLElement;
  private readonly form: HTMLElement;
  private readonly inputs: HTMLInputElement[] = [];
  private readonly reply: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private busy = false;
  private ended = false;

  constructor(
    parent: HTMLElement,
    private readonly mind: DreamMind,
    private readonly thinking: ModelThinkingIndicator,
    private readonly artifact: DreamArtifact,
    private readonly notebook: WordNotebook,
    private readonly callbacks: FinaleCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel finale";
    this.root.hidden = true;
    this.root.innerHTML = `
      <span class="system-label">СЕРДЦЕ СНА</span>
      <h2>Двенадцать слов</h2>
      <p>Аппарат знает шесть позиций. Расставь остальные — порядок является частью ключа.</p>
      <div class="mnemonic-slots"></div>
      <p class="finale-reply"></p>
      <div class="row">
        <button class="finale-submit" type="button">Забрать битки</button>
        <button class="finale-leave ghost" type="button">Уйти, не забрав</button>
        <button class="finale-close ghost" type="button">Назад</button>
      </div>
    `;
    parent.appendChild(this.root);
    this.form = this.root.querySelector(".mnemonic-slots")!;
    const suggestions = document.createElement("datalist");
    suggestions.id = "notebook-word-suggestions";
    this.root.appendChild(suggestions);
    artifact.content.mnemonic.knownSlots.forEach((word, index) => {
      const slot = document.createElement("label");
      slot.className = `mnemonic-slot ${word ? "known" : "hidden"}`;
      slot.innerHTML = `<span>${index + 1}</span>`;
      if (word) {
        const fixed = document.createElement("strong");
        fixed.textContent = word;
        slot.appendChild(fixed);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.maxLength = 24;
        input.setAttribute("list", suggestions.id);
        slot.appendChild(input);
        this.inputs.push(input);
      }
      this.form.appendChild(slot);
    });
    this.reply = this.root.querySelector(".finale-reply")!;
    this.submit = this.root.querySelector(".finale-submit")!;
    this.submit.addEventListener("click", () => void this.judge());
    this.root.querySelector(".finale-leave")!.addEventListener("click", () => {
      this.showEnding(
        "Ты уходишь без ключа. Пациент проснётся бедным только во сне.",
        "walk-away",
      );
    });
    this.root
      .querySelector(".finale-close")!
      .addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get isWaiting(): boolean {
    return this.busy;
  }

  open(): void {
    this.ended = false;
    this.reply.textContent = "";
    this.form.hidden = false;
    this.submit.hidden = false;
    const suggestions = this.root.querySelector("datalist")!;
    suggestions.replaceChildren(
      ...this.notebook.words
        .filter(Boolean)
        .map((word) =>
          Object.assign(document.createElement("option"), { value: word }),
        ),
    );
    this.inputs.forEach((input, index) => {
      input.disabled = false;
      input.value = this.notebook.words[index] ?? "";
    });
    this.root.hidden = false;
    this.inputs[0]?.focus();
    this.callbacks.onOpen();
  }

  openResonance(declaration: string): void {
    this.root.hidden = false;
    this.form.hidden = true;
    this.submit.hidden = true;
    this.showEnding(
      `${declaration}\n\nДва разума входят в резонанс. Сон обрывается вместе с ними.`,
      "resonance",
    );
    this.callbacks.onOpen();
  }

  private fullPhrase(): string[] {
    let hiddenIndex = 0;
    return this.artifact.content.mnemonic.knownSlots.map(
      (known) =>
        known ?? this.inputs[hiddenIndex++]!.value.trim().toLowerCase(),
    );
  }

  private async judge(): Promise<void> {
    if (this.busy || this.inputs.some((input) => !input.value.trim())) return;
    this.busy = true;
    this.submit.disabled = true;
    this.inputs.forEach((input) => (input.disabled = true));
    this.reply.textContent = "Аппарат проверяет порядок…";
    try {
      const result = await this.thinking.run("Проверяет сид-фразу", () =>
        this.mind.judge(this.fullPhrase()),
      );
      this.reply.textContent = result.reply;
      if (result.verdict === "match") {
        this.ended = true;
        this.callbacks.onEnded("match");
      }
    } catch (error) {
      this.reply.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.submit.disabled = false;
      this.inputs.forEach((input) => (input.disabled = false));
    }
  }

  private showEnding(text: string, kind: "resonance" | "walk-away"): void {
    this.ended = true;
    this.reply.textContent = text;
    this.reply.style.whiteSpace = "pre-line";
    this.form.hidden = true;
    this.submit.hidden = true;
    this.callbacks.onEnded(kind);
  }

  close(): void {
    if (this.root.hidden || this.ended) return;
    if (this.busy) this.mind.abort();
    this.root.hidden = true;
    this.callbacks.onClose();
  }
}
