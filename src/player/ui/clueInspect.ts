import type { ClueDefinition } from "../../shared/content";

export class ClueInspectPanel {
  private readonly root: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly placeholder: HTMLElement;
  private readonly observation: HTMLElement;

  constructor(parent: HTMLElement, private readonly onClose: () => void) {
    this.root = document.createElement("div");
    this.root.className = "panel clue-inspect";
    this.root.hidden = true;
    this.root.innerHTML = `
      <span class="system-label">УЛИКА</span>
      <h2>Неуместный предмет</h2>
      <div class="clue-art"><img alt=""><div class="clue-placeholder">ВРЕМЕННЫЙ<br>АССЕТ</div></div>
      <p class="clue-observation"></p>
      <p class="dim">Слова на нём нет. Запиши то, чем этот предмет является для тебя.</p>
      <div class="row"><button class="ghost end" type="button">Отойти</button></div>
    `;
    parent.appendChild(this.root);
    this.image = this.root.querySelector("img")!;
    this.placeholder = this.root.querySelector(".clue-placeholder")!;
    this.observation = this.root.querySelector(".clue-observation")!;
    this.image.addEventListener("load", () => {
      this.image.hidden = false;
      this.placeholder.hidden = true;
    });
    this.image.addEventListener("error", () => {
      this.image.hidden = true;
      this.placeholder.hidden = false;
    });
    this.root.querySelector("button")!.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(clue: ClueDefinition, observation: string): void {
    this.observation.textContent = observation;
    this.placeholder.textContent = `ВРЕМЕННЫЙ АССЕТ\n${clue.marker}`;
    this.placeholder.hidden = false;
    this.image.hidden = true;
    this.image.removeAttribute("src");
    if (clue.detailImage) this.image.src = `/dream/${clue.detailImage}`;
    this.root.hidden = false;
    this.root.querySelector("button")!.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onClose();
  }
}
