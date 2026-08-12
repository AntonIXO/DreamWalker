/**
 * What the keys do.
 *
 * A game with a free-text box has to say this out loud. Every other top-down game can
 * assume WASD and be right; this one takes the keyboard away mid-sentence and gives it
 * back, so the player needs somewhere to check what `E` was for without leaving the dream.
 *
 * Labels come from `keyFor`, which reads the real binding table in `game/input.ts`. A
 * rebinding therefore updates this panel rather than making it lie, and renaming an action
 * breaks the build here instead of at play time.
 */

import { Action, keyFor, type ActionName } from "../game/input";

interface Row {
  key: string;
  what: string;
}

const bound = (action: ActionName, what: string): Row => ({
  key: keyFor(action),
  what,
});

const PLAYING: Row[] = [
  { key: "WASD · ←↑↓→", what: "идти" },
  bound(Action.INTERACT, "заговорить, посмотреть"),
  bound(Action.CANCEL, "отойти, закрыть"),
  bound(Action.HELP, "это окно"),
];

/**
 * Kept visibly apart from the rest. These change the world or lie about it, and a player
 * who cannot tell them from the real controls will hit one by accident and then never
 * trust what they saw afterwards.
 */
const DEBUG: Row[] = [
  bound(Action.DEBUG, "карта, граф миссии, журнал правок"),
  bound(Action.HEARTBEAT, "разбудить спящего сейчас"),
  bound(Action.GRANT, "выдать все ключи"),
];

/** §3, said plainly once. The fork is the game, and a player who misses it plays nothing. */
const TALKING: string[] = [
  "Говори словами, а не выбором из списка. Формулировка — и есть ход.",
  "Точный вопрос даёт больше и оставляет след. Осторожный безопасен и пуст.",
  "Если фигура переспросила про твоё слово — она заметила. Другого предупреждения не будет.",
];

function rowsHtml(list: readonly Row[]): string {
  return list
    .map(
      (row) =>
        `<div class="keys-row"><kbd>${row.key}</kbd><span>${row.what}</span></div>`,
    )
    .join("");
}

export interface ControlsCallbacks {
  /** Fired when the panel closes, so whatever opened it can come back. */
  onClose(): void;
}

export class ControlsPanel {
  private readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: ControlsCallbacks = { onClose: () => {} },
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel controls";
    this.root.hidden = true;
    this.root.innerHTML = `
      <h2>Управление</h2>
      <div class="keys">${rowsHtml(PLAYING)}</div>
      <h3>Разговор</h3>
      <ul class="notes">${TALKING.map((line) => `<li>${line}</li>`).join("")}</ul>
      <h3>Служебное</h3>
      <div class="keys dim">${rowsHtml(DEBUG)}</div>
      <div class="row">
        <button class="controls-close ghost end" type="button">Закрыть</button>
      </div>
    `;
    parent.appendChild(this.root);

    this.root
      .querySelector(".controls-close")!
      .addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.callbacks.onClose();
  }

  toggle(): void {
    if (this.root.hidden) this.open();
    else this.close();
  }

  destroy(): void {
    this.root.remove();
  }
}
