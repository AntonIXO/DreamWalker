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
import {
  getLocale,
  onLocaleChange,
  setLocale,
  t,
  type SupportedLocale,
} from "../../shared/i18n";
import type { JournalEntry } from "../game/cycle";
import { describeMind, type MindSettings } from "../mind/settings";
import { renderMarkdown } from "./markdown";

export interface MenuCallbacks {
  onStart(): void;
  onControls(): void;
  onConnect(): void;
  onLocaleChange?: (locale: SupportedLocale) => void;
}

export class StartMenu {
  private readonly root: HTMLElement;
  private readonly mindEl: HTMLElement;
  private readonly startEl: HTMLButtonElement;
  private readonly controlsEl: HTMLButtonElement;
  private readonly connectEl: HTMLButtonElement;
  private readonly journalEl: HTMLElement;
  private readonly langRuEl: HTMLButtonElement;
  private readonly langEnEl: HTMLButtonElement;
  private cachedJournalEntries: readonly JournalEntry[] = [];
  private cachedSettings: MindSettings | null = null;
  private unsubscribeLocale: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly artifact: DreamArtifact,
    private readonly callbacks: MenuCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel menu";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="row" style="justify-content: flex-end; margin-bottom: 0.5rem;">
        <div class="lang-picker" style="display: flex; gap: 0.25rem;">
          <button class="lang-btn ghost" data-lang="ru" type="button">RU</button>
          <button class="lang-btn ghost" data-lang="en" type="button">EN</button>
        </div>
      </div>
      <h2 class="menu-title"></h2>
      <p class="menu-contract"></p>
      <div class="menu-journal"></div>
      <div class="row">
        <button class="menu-start" type="button"></button>
        <button class="menu-controls ghost" type="button"></button>
        <button class="menu-connect ghost" type="button"></button>
      </div>
      <p class="menu-mind"></p>
    `;
    parent.appendChild(this.root);

    this.mindEl = this.root.querySelector(".menu-mind")!;
    this.startEl = this.root.querySelector(".menu-start")!;
    this.controlsEl = this.root.querySelector(".menu-controls")!;
    this.connectEl = this.root.querySelector(".menu-connect")!;
    this.journalEl = this.root.querySelector(".menu-journal")!;
    this.langRuEl = this.root.querySelector('.lang-btn[data-lang="ru"]')!;
    this.langEnEl = this.root.querySelector('.lang-btn[data-lang="en"]')!;

    this.startEl.addEventListener("click", () => this.callbacks.onStart());
    this.controlsEl.addEventListener("click", () =>
      this.callbacks.onControls(),
    );
    this.connectEl.addEventListener("click", () => this.callbacks.onConnect());

    this.langRuEl.addEventListener("click", () => this.handleLangSelect("ru"));
    this.langEnEl.addEventListener("click", () => this.handleLangSelect("en"));

    this.render();
    this.unsubscribeLocale = onLocaleChange((locale) => {
      this.render();
      this.callbacks.onLocaleChange?.(locale);
    });
  }

  private handleLangSelect(locale: SupportedLocale): void {
    setLocale(locale);
  }

  private render(): void {
    const locale = getLocale();
    this.langRuEl.classList.toggle("active", locale === "ru");
    this.langEnEl.classList.toggle("active", locale === "en");
    this.langRuEl.style.opacity = locale === "ru" ? "1" : "0.5";
    this.langEnEl.style.opacity = locale === "en" ? "1" : "0.5";

    this.root.querySelector<HTMLElement>(".menu-title")!.textContent =
      this.artifact.title;
    this.root.querySelector<HTMLElement>(".menu-contract")!.textContent =
      this.artifact.genreContract;

    this.controlsEl.textContent = t("menu.controls");
    this.connectEl.textContent = t("menu.connection");

    if (this.cachedSettings) {
      this.setMind(this.cachedSettings);
    }
    this.setJournal(this.cachedJournalEntries);
  }

  /** Called at open and whenever the connection panel changes something. */
  setMind(settings: MindSettings): void {
    this.cachedSettings = settings;
    this.mindEl.textContent = t("menu.mind_prefix", {
      mind: describeMind(settings),
    });
  }

  /**
   * §5 — the notebook is the only thing that crosses a cycle, so seeing it here is what
   * tells a returning player that the dream remembers them even though its figures do not.
   */
  setJournal(entries: readonly JournalEntry[]): void {
    this.cachedJournalEntries = entries;
    if (entries.length === 0) {
      this.journalEl.replaceChildren();
      this.startEl.textContent = t("menu.enter_dream");
      return;
    }

    this.startEl.textContent = t("menu.return_to_dream");
    const recent = entries.slice(-4);
    this.journalEl.innerHTML = `
      <h3>${t("menu.already_been_here")}</h3>
      <ul class="notes">${recent
        .map((entry) => `<li>${renderMarkdown(entry.text)}</li>`)
        .join("")}</ul>
    `;
  }

  private active = false;

  get isOpen(): boolean {
    return this.active;
  }

  open(): void {
    this.active = true;
    this.render();
    this.setVisible(true);
  }

  close(): void {
    this.active = false;
    this.root.hidden = true;
  }

  setVisible(visible: boolean): void {
    if (visible && !this.active) return;
    this.root.hidden = !visible;
    if (visible) this.startEl.focus();
  }

  destroy(): void {
    this.unsubscribeLocale?.();
    this.root.remove();
  }
}
