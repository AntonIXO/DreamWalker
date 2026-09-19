/**
 * What else can be done with a person — or a thing.
 *
 * `E` is not touched: a figure still opens the conversation, and a returning player
 * relearns nothing. This is a second key, and it shows **every row always** — the
 * ones that cannot be done carry their reason, struck through. Hiding them would make
 * blackmail a secret instead of a cost, and §8's flat register carries a struck line
 * far better than it carries an absent feature.
 *
 * Object rows come from `availableActions`. talk/press/lead/kill stay on figures.
 *
 * `kill` is deliberately two decisions, not one. §0 of the bible is about a dream where
 * «действие даётся тяжело», and the one irreversible thing in the game should not be a
 * single keypress next to «заговорить».
 */

import { t } from "../../shared/i18n";
import type { ActionRingRow } from "../game/interact";
import type { FigureState } from "../game/world";

export type { ActionRingRow };

export type ActionRingSubject =
  | { kind: "figure"; figure: FigureState }
  | { kind: "object"; id: string; name: string };

export interface ActionRingCallbacks {
  onPick(subject: ActionRingSubject, row: ActionRingRow): void;
  onClose(): void;
  onWords?(subject: ActionRingSubject): void;
}

export class ActionRing {
  private readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly wordsEl: HTMLButtonElement;
  private subject: ActionRingSubject | null = null;
  private options: ActionRingRow[] = [];
  private confirming: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: ActionRingCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel verb-ring action-ring";
    this.root.hidden = true;
    this.root.innerHTML = `
      <span class="system-label verb-system-label"></span>
      <h2 class="verb-who"></h2>
      <ol class="verb-list"></ol>
      <p class="dim verb-hint"></p>
      <button class="action-words ghost" type="button" hidden></button>
    `;
    parent.appendChild(this.root);
    this.labelEl = this.root.querySelector(".verb-system-label")!;
    this.nameEl = this.root.querySelector(".verb-who")!;
    this.listEl = this.root.querySelector(".verb-list")!;
    this.hintEl = this.root.querySelector(".verb-hint")!;
    this.wordsEl = this.root.querySelector(".action-words")!;
    this.wordsEl.addEventListener("click", () => {
      const subject = this.subject;
      if (!subject) return;
      this.close();
      this.callbacks.onWords?.(subject);
    });
    this.root.addEventListener("keydown", (event) => this.onKey(event));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(subject: ActionRingSubject, options: ActionRingRow[]): void {
    if (options.length === 0) return;
    this.subject = subject;
    this.options = options;
    this.confirming = null;
    this.nameEl.textContent =
      subject.kind === "figure" ? subject.figure.name : subject.name;
    this.labelEl.textContent = t("actionRing.title");
    this.hintEl.textContent = t("actionRing.hint");
    this.wordsEl.hidden = !this.callbacks.onWords || subject.kind !== "object";
    this.wordsEl.textContent = t("controls.key_inventory");
    this.render();
    this.root.hidden = false;
    this.root.tabIndex = -1;
    this.root.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.subject = null;
    this.confirming = null;
    this.callbacks.onClose();
  }

  private render(): void {
    this.listEl.replaceChildren();
    for (const [index, option] of this.options.entries()) {
      const row = document.createElement("li");
      row.className = option.refusal ? "verb refused" : "verb";
      const label =
        this.confirming === index ? t("actionRing.confirm") : option.label;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost verb-action";
      button.textContent = `${index + 1} — ${label}`;
      button.disabled = !!option.refusal;
      button.addEventListener("click", () => this.choose(index));
      row.appendChild(button);
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
    this.choose(index);
  }

  private choose(index: number): void {
    const option = this.options[index]!;
    const subject = this.subject;
    if (!subject || !option || option.refusal) return;

    if (option.confirm && this.confirming !== index) {
      this.confirming = index;
      this.render();
      return;
    }
    this.close();
    this.callbacks.onPick(subject, option);
  }
}

/** @deprecated name kept so older imports compile; use ActionRing. */
export { ActionRing as VerbRing };
export type VerbRingCallbacks = ActionRingCallbacks;
