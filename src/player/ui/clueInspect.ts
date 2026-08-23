import type { ClueDefinition } from "../../shared/content";
import { t } from "../../shared/i18n";
import { setMarkdown } from "./markdown";

export class ClueInspectPanel {
  private readonly root: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly placeholder: HTMLElement;
  private readonly observation: HTMLElement;
  private readonly systemLabelEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly closeBtnEl: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel clue-inspect";
    this.root.hidden = true;
    this.root.innerHTML = `
      <span class="system-label clue-system-label"></span>
      <h2 class="clue-title"></h2>
      <div class="clue-art"><img alt=""><div class="clue-placeholder"></div></div>
      <p class="clue-observation"></p>
      <p class="dim clue-note"></p>
      <div class="row"><button class="ghost end" type="button"></button></div>
    `;
    parent.appendChild(this.root);
    this.systemLabelEl = this.root.querySelector(".clue-system-label")!;
    this.titleEl = this.root.querySelector(".clue-title")!;
    this.noteEl = this.root.querySelector(".clue-note")!;
    this.closeBtnEl = this.root.querySelector("button")!;
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
    this.closeBtnEl.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(clue: ClueDefinition, observation: string): void {
    this.systemLabelEl.textContent = t("ui.system_label_clue");
    this.titleEl.textContent = t("clueInspect.title");
    this.noteEl.textContent = t("clueInspect.note");
    this.closeBtnEl.textContent = t("ui.step_back");

    setMarkdown(this.observation, observation);
    this.placeholder.textContent = `${t("clueInspect.placeholder")}\n${clue.marker}`;
    this.placeholder.hidden = false;
    this.image.hidden = true;
    this.image.removeAttribute("src");
    if (clue.detailImage) this.image.src = `/dream/${clue.detailImage}`;
    this.root.hidden = false;
    this.closeBtnEl.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onClose();
  }
}
