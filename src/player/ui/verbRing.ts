/**
 * What else can be done with a person.
 *
 * `E` is not touched: a figure still opens the conversation, and a returning player
 * relearns nothing. This is a second key, and it shows **all four rows always** — the
 * ones that cannot be done carry their reason, struck through. Hiding them would make
 * blackmail a secret instead of a cost, and §8's flat register carries a struck line
 * far better than it carries an absent feature.
 *
 * The digits belong to the panel rather than to `Input`, the way `DialoguePanel`'s form
 * does: it captures input while open and reads its own `keydown`. So `Action` grows by
 * exactly one member instead of five.
 *
 * `kill` is deliberately two decisions, not one. §0 of the bible is about a dream where
 * «действие даётся тяжело», and the one irreversible thing in the game should not be a
 * single keypress next to «заговорить».
 */

import type { VerbOption, Verb } from "../../shared/verbs";
import type { FigureState } from "../game/world";

export interface VerbRingCallbacks {
  onPick(figure: FigureState, verb: Verb): void;
  onClose(): void;
}

export class VerbRing {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private figure: FigureState | null = null;
  private options: VerbOption[] = [];
  private confirming: Verb | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: VerbRingCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel verb-ring";
    this.root.hidden = true;
    this.root.innerHTML = `
      <span class="system-label">ЗАПИСЬ</span>
      <h2 class="verb-who"></h2>
      <ol class="verb-list"></ol>
      <p class="dim">1–4 — выбрать · Esc — отойти</p>
    `;
    parent.appendChild(this.root);
    this.nameEl = this.root.querySelector(".verb-who")!;
    this.listEl = this.root.querySelector(".verb-list")!;
    this.root.addEventListener("keydown", (event) => this.onKey(event));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(figure: FigureState, options: VerbOption[]): void {
    if (options.length === 0) return;
    this.figure = figure;
    this.options = options;
    this.confirming = null;
    this.nameEl.textContent = figure.name;
    this.render();
    this.root.hidden = false;
    this.root.tabIndex = -1;
    this.root.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.figure = null;
    this.confirming = null;
    this.callbacks.onClose();
  }

  private render(): void {
    this.listEl.replaceChildren();
    for (const [index, option] of this.options.entries()) {
      const row = document.createElement("li");
      row.className = option.refusal ? "verb refused" : "verb";
      const label = this.confirming === option.verb ? "точно?" : option.label;
      row.textContent = `${index + 1} — ${label}`;
      if (option.refusal) {
        const why = document.createElement("span");
        why.className = "dim";
        why.textContent = ` ${option.refusal}`;
        row.appendChild(why);
      }
      this.listEl.appendChild(row);
    }
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= this.options.length) {
      return;
    }
    event.preventDefault();
    const option = this.options[index]!;
    const figure = this.figure;
    if (!figure || option.refusal) return;

    // Everything but a kill goes straight through. A kill asks once, in the same flat
    // register, and the second press is the commitment — there is no undo after it.
    if (option.verb === "kill" && this.confirming !== "kill") {
      this.confirming = "kill";
      this.render();
      return;
    }
    this.close();
    this.callbacks.onPick(figure, option.verb);
  }
}
