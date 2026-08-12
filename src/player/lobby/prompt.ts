/**
 * One line under the sanitar's feet: a verb, not a mystery colour.
 */

export class LobbyPrompt {
  private readonly root: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private hintUntil = 8;
  private hinted = false;

  constructor(parent: HTMLElement, hint: string) {
    this.root = document.createElement("div");
    this.root.className = "lobby-chrome";
    this.root.innerHTML = `
      <div class="lobby-hint"></div>
      <div class="lobby-prompt" hidden></div>
    `;
    parent.appendChild(this.root);
    this.hintEl = this.root.querySelector(".lobby-hint")!;
    this.promptEl = this.root.querySelector(".lobby-prompt")!;
    this.hintEl.textContent = hint;
    this.hintEl.classList.add("visible");
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
    this.root.remove();
  }
}
