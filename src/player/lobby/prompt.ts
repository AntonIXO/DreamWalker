/**
 * One line under the sanitar's feet: a verb, not a mystery colour.
 * Also holds the start screen logo, slogan, and language switcher.
 */

import {
  getLocale,
  onLocaleChange,
  setLocale,
  t,
  type SupportedLocale,
} from "../../shared/i18n";

export class LobbyPrompt {
  private readonly root: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly sloganEl: HTMLElement;
  private readonly langRuBtn: HTMLButtonElement;
  private readonly langEnBtn: HTMLButtonElement;
  private hintUntil = 8;
  private hinted = false;
  private unsubscribeLocale: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "lobby-chrome";
    this.root.innerHTML = `
      <div class="lobby-stamp">
        <img
          class="lobby-logo"
          src="/logo.jpg"
          alt="Dream Walker"
          width="512"
          height="512"
        />
        <p class="lobby-slogan"></p>
        <div class="lobby-lang-picker">
          <button class="lobby-lang-btn" data-lang="ru" type="button">RU</button>
          <button class="lobby-lang-btn" data-lang="en" type="button">EN</button>
        </div>
      </div>
      <div class="lobby-hint"></div>
      <div class="lobby-prompt" hidden></div>
    `;
    parent.appendChild(this.root);
    this.hintEl = this.root.querySelector(".lobby-hint")!;
    this.promptEl = this.root.querySelector(".lobby-prompt")!;
    this.sloganEl = this.root.querySelector(".lobby-slogan")!;
    this.langRuBtn = this.root.querySelector(
      '.lobby-lang-btn[data-lang="ru"]',
    )!;
    this.langEnBtn = this.root.querySelector(
      '.lobby-lang-btn[data-lang="en"]',
    )!;

    this.langRuBtn.addEventListener("click", () => this.handleLangSelect("ru"));
    this.langEnBtn.addEventListener("click", () => this.handleLangSelect("en"));

    this.render();
    this.hintEl.classList.add("visible");

    this.unsubscribeLocale = onLocaleChange(() => {
      this.render();
    });
  }

  private handleLangSelect(locale: SupportedLocale): void {
    setLocale(locale);
  }

  private render(): void {
    const locale = getLocale();
    this.sloganEl.textContent = t("lobby.slogan");
    if (!this.hinted) {
      this.hintEl.textContent = t("lobby.hint");
    }
    this.langRuBtn.classList.toggle("active", locale === "ru");
    this.langEnBtn.classList.toggle("active", locale === "en");
  }

  setPrompt(text: string | null): void {
    if (!text) {
      this.promptEl.hidden = true;
      this.promptEl.textContent = "";
      return;
    }
    this.promptEl.hidden = false;
    this.promptEl.textContent = text;
  }

  dismissHint(): void {
    if (this.hinted) return;
    this.hinted = true;
    this.hintUntil = 0;
    this.hintEl.classList.remove("visible");
  }

  update(deltaSeconds: number): void {
    if (this.hinted || this.hintUntil <= 0) return;
    this.hintUntil -= deltaSeconds;
    if (this.hintUntil <= 0) this.dismissHint();
  }

  hide(): void {
    this.root.hidden = true;
  }

  destroy(): void {
    this.unsubscribeLocale?.();
    this.root.remove();
  }
}
