/**
 * The way in.
 *
 * §8 makes a dream something you are sent a link to, so the first screen is doing more
 * work than a title card: it is the moment a stranger decides whether to walk into
 * someone else's head. It names the dream, states the genre contract — which is the one
 * promise the world makes about what a miracle looks like here (§6) — and says plainly
 * which mind is going to be on the other side.
 *
 * It also carries the journal across (§5). Coming back to a dream you have already been
 * inside is not a fresh start, and the menu should not pretend otherwise.
 */

import type { DreamArtifact } from "../../shared/dream";
import type { JournalEntry } from "../game/cycle";
import { describeMind, type MindSettings } from "../mind/settings";
import { renderMarkdown } from "./markdown";

export interface MenuCallbacks {
  onStart(): void;
  onControls(): void;
  onConnect(): void;
}

export class StartMenu {
  private readonly root: HTMLElement;
  private readonly mindEl: HTMLElement;
  private readonly startEl: HTMLButtonElement;
  private readonly journalEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    artifact: DreamArtifact,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel menu";
    this.root.hidden = true;
    this.root.innerHTML = `
      <h2 class="menu-title"></h2>
      <p class="menu-contract"></p>
      <div class="menu-journal"></div>
      <div class="row">
        <button class="menu-start" type="button">Войти в сон</button>
        <button class="menu-controls ghost" type="button">Управление</button>
        <button class="menu-connect ghost" type="button">Подключение</button>
      </div>
      <p class="menu-mind"></p>
    `;
    parent.appendChild(this.root);

    this.root.querySelector<HTMLElement>(".menu-title")!.textContent =
      artifact.title;
    this.root.querySelector<HTMLElement>(".menu-contract")!.textContent =
      artifact.genreContract;

    this.mindEl = this.root.querySelector(".menu-mind")!;
    this.startEl = this.root.querySelector(".menu-start")!;
    this.journalEl = this.root.querySelector(".menu-journal")!;

    this.startEl.addEventListener("click", () => this.callbacks.onStart());
    this.root
      .querySelector(".menu-controls")!
      .addEventListener("click", () => this.callbacks.onControls());
    this.root
      .querySelector(".menu-connect")!
      .addEventListener("click", () => this.callbacks.onConnect());
  }

  /** Called at open and whenever the connection panel changes something. */
  setMind(settings: MindSettings): void {
    this.mindEl.textContent = `Разум сна: ${describeMind(settings)}`;
  }

  /**
   * §5 — the notebook is the only thing that crosses a cycle, so seeing it here is what
   * tells a returning player that the dream remembers them even though its figures do not.
   */
  setJournal(entries: readonly JournalEntry[]): void {
    if (entries.length === 0) {
      this.journalEl.replaceChildren();
      this.startEl.textContent = "Войти в сон";
      return;
    }

    this.startEl.textContent = "Вернуться в сон";
    const recent = entries.slice(-4);
    this.journalEl.innerHTML = `
      <h3>Ты уже был здесь</h3>
      <ul class="notes">${recent
        .map((entry) => `<li>${renderMarkdown(entry.text)}</li>`)
        .join("")}</ul>
    `;
  }

  /**
   * Being the active screen and being on screen are two different things: the controls
   * and the connection form open *over* the menu, and while they are up the menu hides
   * itself but time is still stopped. Conflating the two either stacks two panels in the
   * same place or lets the cycle start burning behind a settings form.
   */
  private active = false;

  get isOpen(): boolean {
    return this.active;
  }

  open(): void {
    this.active = true;
    this.setVisible(true);
  }

  close(): void {
    this.active = false;
    this.root.hidden = true;
  }

  setVisible(visible: boolean): void {
    // Never reappear once the player has gone in. Panels call this when they close, and
    // they close during play too — the menu is not a pause screen.
    if (visible && !this.active) return;
    this.root.hidden = !visible;
    if (visible) this.startEl.focus();
  }

  destroy(): void {
    this.root.remove();
  }
}
