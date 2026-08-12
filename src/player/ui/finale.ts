import type { FinaleResult } from "../../shared/ai";
import type { DreamMind } from "../mind/types";

export interface FinaleCallbacks {
  onOpen(): void;
  onClose(): void;
  onEnded(kind: "match" | "resonance" | "walk-away"): void;
}

export class FinalePanel {
  private readonly root: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly reply: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private busy = false;
  private ended = false;

  constructor(
    parent: HTMLElement,
    private readonly mind: DreamMind,
    private readonly callbacks: FinaleCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel finale";
    this.root.hidden = true;
    this.root.innerHTML = `
      <h2>Сердце сна</h2>
      <p>Собери из найденного один вывод. Тайна существовала до твоего прихода.</p>
      <label class="field">
        <span>Что произошло на самом деле?</span>
        <textarea class="finale-input" maxlength="800" rows="5"></textarea>
      </label>
      <p class="finale-reply"></p>
      <div class="row">
        <button class="finale-submit" type="button">Назвать</button>
        <button class="finale-leave ghost" type="button">Уйти, не забрав</button>
        <button class="finale-close ghost" type="button">Назад</button>
      </div>
    `;
    parent.appendChild(this.root);
    this.input = this.root.querySelector(".finale-input")!;
    this.reply = this.root.querySelector(".finale-reply")!;
    this.submit = this.root.querySelector(".finale-submit")!;
    this.submit.addEventListener("click", () => void this.judge());
    this.root.querySelector(".finale-leave")!.addEventListener("click", () => {
      this.showEnding(
        "Ты уходишь, оставляя тайну внутри. Оба разума переживают эту ночь.",
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
    this.root.hidden = false;
    this.input.focus();
    this.callbacks.onOpen();
  }

  openResonance(declaration: string): void {
    this.root.hidden = false;
    this.input.hidden = true;
    this.submit.hidden = true;
    this.showEnding(
      `${declaration}\n\nДва разума входят в резонанс. Сон обрывается вместе с ними.`,
      "resonance",
    );
    this.callbacks.onOpen();
  }

  private async judge(): Promise<void> {
    const diagnosis = this.input.value.trim();
    if (!diagnosis || this.busy) return;
    this.busy = true;
    this.submit.disabled = true;
    this.input.disabled = true;
    this.reply.textContent = "Сон слушает…";
    try {
      const result: FinaleResult = await this.mind.judge(diagnosis);
      this.reply.textContent = result.reveal
        ? `${result.reply}\n\n${result.reveal}`
        : result.reply;
      this.reply.style.whiteSpace = "pre-line";
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
      this.input.disabled = false;
    }
  }

  private showEnding(text: string, kind: "resonance" | "walk-away"): void {
    this.ended = true;
    this.reply.textContent = text;
    this.reply.style.whiteSpace = "pre-line";
    this.input.hidden = true;
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
