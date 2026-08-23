/** ChatGPT device OAuth, or a server-configured Anthropic / OpenAI-compatible provider. */

import type { DeviceLogin } from "../../shared/ai";
import { getLocale, t } from "../../shared/i18n";
import {
  cancelDeviceLogin,
  DEFAULT_MIND_SETTINGS,
  loadMindSettings,
  logoutMind,
  startDeviceLogin,
  type MindSettings,
} from "../mind/settings";

export interface ConnectCallbacks {
  onChange(settings: MindSettings): void;
  onClose(): void;
}

function limitLine(settings: MindSettings): string {
  const window = settings.primary;
  if (!window) return "";
  const locale = getLocale();
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const reset = window.resetsAt
    ? new Date(window.resetsAt * 1000).toLocaleString(dateLocale)
    : t("connect.unknown_reset");
  return t("connect.limit_line", {
    pct: Math.round(window.usedPercent),
    reset,
  });
}

export class ConnectPanel {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly descriptionEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly loginBox: HTMLElement;
  private readonly loginInstructionsEl: HTMLElement;
  private readonly loginButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly logoutButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private settings: MindSettings = { ...DEFAULT_MIND_SETTINGS };
  private login: DeviceLogin | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: ConnectCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel connect";
    this.root.hidden = true;
    this.root.innerHTML = `
      <h2 class="connect-title"></h2>
      <p class="connect-description"></p>
      <div class="connect-account"></div>
      <div class="connect-login" hidden>
        <a class="connect-url" target="_blank" rel="noreferrer"></a>
        <button class="connect-code ghost" type="button"></button>
        <p class="connect-instructions"></p>
      </div>
      <div class="connect-status"></div>
      <div class="row">
        <button class="connect-start" type="button"></button>
        <button class="connect-cancel ghost" type="button" hidden></button>
        <button class="connect-logout ghost" type="button" hidden></button>
        <button class="connect-close ghost" type="button"></button>
      </div>
    `;
    parent.appendChild(this.root);

    this.titleEl = this.root.querySelector(".connect-title")!;
    this.descriptionEl = this.root.querySelector(".connect-description")!;
    this.statusEl = this.root.querySelector(".connect-status")!;
    this.loginBox = this.root.querySelector(".connect-login")!;
    this.loginInstructionsEl = this.root.querySelector(
      ".connect-instructions",
    )!;
    this.loginButton = this.root.querySelector(".connect-start")!;
    this.cancelButton = this.root.querySelector(".connect-cancel")!;
    this.logoutButton = this.root.querySelector(".connect-logout")!;
    this.closeButton = this.root.querySelector(".connect-close")!;

    this.loginButton.addEventListener("click", () => void this.startLogin());
    this.cancelButton.addEventListener("click", () => void this.cancelLogin());
    this.logoutButton.addEventListener("click", () => void this.logout());
    this.closeButton.addEventListener("click", () => this.close());
    this.root.querySelector(".connect-code")!.addEventListener("click", () => {
      if (this.login) void navigator.clipboard.writeText(this.login.userCode);
    });

    void this.refresh();
  }

  private say(text: string, kind: "ok" | "bad" | "" = ""): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `connect-status ${kind}`;
  }

  private render(): void {
    this.titleEl.textContent = t("connect.title");
    this.loginInstructionsEl.textContent = t("connect.instructions");
    this.loginButton.textContent = t("connect.btn_connect");
    this.cancelButton.textContent = t("connect.btn_cancel");
    this.logoutButton.textContent = t("connect.btn_logout");
    this.closeButton.textContent = t("ui.step_back");

    const account = this.root.querySelector<HTMLElement>(".connect-account")!;
    const connected = this.settings.state === "connected";
    const serverBound = this.settings.provider !== "codex";
    this.descriptionEl.textContent = serverBound
      ? this.settings.provider === "openai"
        ? t("connect.desc_openai")
        : t("connect.desc_anthropic")
      : t("connect.desc_codex");
    account.textContent = connected
      ? [
          this.settings.email,
          this.settings.planType,
          `${this.settings.model} · ${this.settings.effort}`,
          limitLine(this.settings),
        ]
          .filter(Boolean)
          .join("\n")
      : (this.settings.message ?? t("connect.model_not_connected"));
    account.style.whiteSpace = "pre-line";

    this.loginButton.hidden = connected || serverBound;
    this.logoutButton.hidden = !connected || serverBound;
    this.cancelButton.hidden = !this.login;
    this.loginBox.hidden = !this.login;
    if (this.login) {
      const link = this.root.querySelector<HTMLAnchorElement>(".connect-url")!;
      link.href = this.login.verificationUrl;
      link.textContent = this.login.verificationUrl;
      this.root.querySelector<HTMLButtonElement>(".connect-code")!.textContent =
        this.login.userCode;
    }
    this.callbacks.onChange(this.settings);
  }

  private async refresh(): Promise<void> {
    this.settings = await loadMindSettings();
    if (this.settings.state === "connected") {
      this.login = null;
      this.stopPolling();
      this.say(t("connect.status_ready"), "ok");
    } else if (this.settings.state === "incompatible") {
      this.say(
        this.settings.message ?? t("connect.status_incompatible"),
        "bad",
      );
    } else if (this.settings.state === "error") {
      this.say(this.settings.message ?? t("connect.status_error"), "bad");
    }
    this.render();
  }

  private async startLogin(): Promise<void> {
    this.loginButton.disabled = true;
    this.say(t("connect.status_preparing"));
    try {
      this.login = await startDeviceLogin();
      this.say(t("connect.status_waiting"));
      this.startPolling();
      this.render();
      window.open(this.login.verificationUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), "bad");
    } finally {
      this.loginButton.disabled = false;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.refresh(), 1500);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async cancelLogin(): Promise<void> {
    if (!this.login) return;
    try {
      await cancelDeviceLogin(this.login.loginId);
      this.login = null;
      this.stopPolling();
      await this.refresh();
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), "bad");
    }
  }

  private async logout(): Promise<void> {
    try {
      this.settings = await logoutMind();
      this.login = null;
      this.say(t("connect.status_disconnected"), "ok");
      this.render();
    } catch (error) {
      this.say(error instanceof Error ? error.message : String(error), "bad");
    }
  }

  get current(): MindSettings {
    return this.settings;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    void this.refresh();
    this.loginButton.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    if (!this.login) this.stopPolling();
    this.callbacks.onClose();
  }

  destroy(): void {
    this.stopPolling();
    this.root.remove();
  }
}
