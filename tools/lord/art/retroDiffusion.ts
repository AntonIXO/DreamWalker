const API_ROOT = "https://api.retrodiffusion.ai/v1";

/**
 * Bun's `fetch` rejects `socks5://` proxies (`UnsupportedProxyProtocol`). This
 * machine reaches Retro Diffusion only through a local SOCKS hop, so the client
 * speaks curl when `DREAMWALKER_SOCKS_PROXY` or `ALL_PROXY` is a socks URL.
 */
function socksHop(): { host: string; port: number } | null {
  const raw =
    process.env.DREAMWALKER_SOCKS_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim() ||
    "";
  const match = raw.match(/^socks5h?:\/\/([^:/]+):(\d+)/i);
  if (!match) return null;
  return { host: match[1]!, port: Number(match[2]) };
}

async function rdFetch(
  url: string,
  init: RequestInit = {},
): Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}> {
  const hop = socksHop();
  if (!hop) {
    const response = await fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      json: () => response.json().catch(() => null),
    };
  }

  const headers = new Headers(init.headers);
  const args = [
    "curl",
    "-sS",
    "--max-time",
    "180",
    "--socks5-hostname",
    `${hop.host}:${hop.port}`,
    "-w",
    "\n__RD_HTTP__%{http_code}",
    "-X",
    init.method ?? "GET",
  ];
  for (const [name, value] of headers) {
    args.push("-H", `${name}: ${value}`);
  }
  if (init.body !== undefined && init.body !== null) {
    args.push("--data-binary", "@-");
  }
  args.push(url);

  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (init.body !== undefined && init.body !== null) {
    proc.stdin.write(
      typeof init.body === "string" ? init.body : String(init.body),
    );
  }
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `socks curl ${exitCode}: ${stderr.trim() || "failed to reach Retro Diffusion"}`,
    );
  }
  const marker = stdout.lastIndexOf("\n__RD_HTTP__");
  const raw = marker >= 0 ? stdout.slice(0, marker) : stdout;
  const status = Number(
    marker >= 0 ? stdout.slice(marker + "\n__RD_HTTP__".length) : 0,
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
  };
}

async function rdDownload(url: string): Promise<ArrayBuffer> {
  const hop = socksHop();
  if (!hop) return (await fetch(url)).arrayBuffer();
  const proc = Bun.spawn(
    [
      "curl",
      "-sS",
      "--max-time",
      "180",
      "--socks5-hostname",
      `${hop.host}:${hop.port}`,
      url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [bytes, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `socks curl ${exitCode}: ${stderr.trim() || "failed to download image"}`,
    );
  }
  return bytes;
}

export interface RetroInferenceRequest {
  prompt: string;
  prompt_style: string;
  width: number;
  height: number;
  num_images: number;
  seed: number;
  input_palette?: string;
  /**
   * Style/content guides. **RD Pro only** — the live catalogue reports
   * `supports_reference_images: false` for every rd_fast/rd_plus style, and
   * `check_cost` will happily price a request it would then refuse, so the catalogue is
   * the authority here and not the dry run.
   */
  reference_images?: string[];
  /**
   * img2img conditioning, and the reason this project does not need RD Pro.
   *
   * `prompts-pixelart.md` §0 keeps a character's four portrait states looking like one
   * person by feeding the chosen S0 back as a reference. Reference images cost $0.18 an
   * image; `input_image` does the same job on rd_plus at $0.033. Must be RGB with no
   * alpha channel.
   */
  input_image?: string;
  /** 0..1, default 0.75. Lower clings harder to `input_image`. */
  strength?: number;
  extra_prompt?: string;
  tile_x?: boolean;
  tile_y?: boolean;
  /** Animation styles only. */
  frames_duration?: 4 | 6 | 8 | 10 | 12 | 16;
  /**
   * Animation styles return a **GIF** unless this is set. Always set it: the repo's PNG
   * reader will fail on a GIF far downstream with a confusing error.
   */
  return_spritesheet?: boolean;
  upscale_output_factor?: number;
  remove_bg?: boolean;
  bypass_prompt_expansion?: boolean;
  upload_outputs?: boolean;
  check_cost?: boolean;
  async?: boolean;
}

/** One entry of `GET /v1/styles/selector`, which is the authority on what is legal. */
export interface StyleInfo {
  prompt_style: string;
  name: string;
  required_model: string | null;
  required_tab: string;
  min_width: number;
  max_width: number;
  min_height: number;
  max_height: number;
  max_number_of_images: number;
  require_input_image: boolean | null;
  supports_reference_images: boolean;
}

/** Which tab a style prefix lives on, and which `/status` key reports it. */
const TAB_BY_PREFIX: Record<string, string> = {
  rd_fast: "tab:image",
  rd_plus: "tab:image",
  rd_pro: "tab:image",
  rd_mini: "tab:image",
  user: "tab:image",
  rd_animation: "tab:animation",
  rd_advanced_animation: "tab:advanced-animation",
  rd_tile: "tab:tileset",
};

const STATUS_KEY: Record<string, string | null> = {
  rd_fast: "rd_fast",
  rd_plus: "rd_plus",
  rd_pro: "rd_pro",
  rd_mini: null,
  user: "rd_pro",
  rd_animation: "animations",
  rd_advanced_animation: "animations",
  rd_tile: null,
};

/** Thrown for a request the server will reject anyway. Never retried. */
class NonRetryable extends Error {}

/**
 * The server answered, so the job was **not** accepted and **not** charged.
 *
 * This distinction is the whole safety model of `submit`. A 429 or a 400 is an answer:
 * nothing was created, so resubmitting is free and correct. A *transport* failure — the
 * socket dying after the request went out — is the ambiguous one, because the job may
 * have been accepted and billed before the response was lost. Only that case may not be
 * retried, and only that case justifies going looking for an orphaned task.
 */
export class RejectedBeforeCharge extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RejectedBeforeCharge";
  }
}

export interface RetroInferenceResult {
  request_id?: string;
  balance_cost: number;
  remaining_balance?: number;
  base64_images?: string[];
  output_urls?: string[];
  model?: string;
}

interface AsyncResponse {
  status: "accepted";
  task_id: string;
  request_id: string;
}

export interface TaskSummary {
  task_id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  created_at: string;
  result?: RetroInferenceResult;
  error?: unknown;
}

export interface EditToolInfo {
  id: string;
  balance_cost: number;
  credit_cost: number;
  is_free: boolean;
  max_input_size?: number;
  /** API clients use these; the older `fields` describes the web canvas UI. */
  api_fields?: Array<{ name?: string }>;
}

interface TaskResponse {
  status: "pending" | "running" | "succeeded" | "failed";
  result?: RetroInferenceResult;
  error?: { status_code?: number; detail?: unknown };
}

function detailOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const source = value as { detail?: unknown; message?: unknown };
    if (typeof source.message === "string") return source.message;
    if (typeof source.detail === "string") return source.detail;
    if (source.detail) return JSON.stringify(source.detail);
  }
  return "Retro Diffusion request failed";
}

export class RetroDiffusionClient {
  private styleCache: Map<string, StyleInfo> | null = null;

  constructor(private readonly token: string) {
    if (!token.startsWith("rdpk-")) {
      throw new Error("RETRO_DIFFUSION_API_KEY is missing or malformed");
    }
  }

  /**
   * One HTTP call, with retries for the failures that are worth retrying.
   *
   * Two bugs were fixed here and both cost money. The old version wrapped the whole
   * `fetch` in a `try` whose `catch` swallowed its own `throw last`, so a 400 or a 422
   * was retried three times; and it retried on *any* thrown error, including a network
   * failure that happened after the server had already accepted and charged for the job.
   * A submit must therefore run with `retries = 1` and recover through `listTasks`
   * instead — see `submit`.
   */
  private async request<T>(
    path: string,
    init: RequestInit = {},
    retries = 3,
  ): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await rdFetch(`${API_ROOT}${path}`, {
          ...init,
          headers: {
            "X-RD-Token": this.token,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
          },
        });
        const body = (await response.json()) as unknown;
        if (response.ok) return body as T;
        const message = `Retro Diffusion ${response.status}: ${detailOf(body)}`;
        // A bad request stays bad. Only rate limits and server faults are worth a retry.
        if (response.status !== 429 && response.status < 500) {
          throw new NonRetryable(message);
        }
        // Rate limited on a no-retry call: say so precisely, so the caller can resubmit
        // rather than assume a lost response and go hunting for someone else's task.
        if (retries === 1)
          throw new RejectedBeforeCharge(message, response.status);
        last = new Error(message);
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        const delay = retryAfter > 0 ? retryAfter * 1000 : 750 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        if (error instanceof NonRetryable) throw error;
        last = error;
        if (attempt === retries - 1) break;
        await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
      }
    }
    throw last;
  }

  /** Balance, so a batch can refuse to start rather than dying halfway through. */
  credits(): Promise<{ credits: number; balance: number }> {
    return this.request("/inferences/credits");
  }

  status(): Promise<{ status?: Record<string, string> }> {
    return this.request("/status");
  }

  /**
   * The live style catalogue, merged across all four tabs and cached per process.
   *
   * This is what makes a bad `--size` or `--candidates` a local error instead of a paid
   * one: every style publishes its own min/max dimensions and batch ceiling.
   */
  async styles(): Promise<Map<string, StyleInfo>> {
    if (this.styleCache) return this.styleCache;
    const tabs = [...new Set(Object.values(TAB_BY_PREFIX))];
    const merged = new Map<string, StyleInfo>();
    for (const tab of tabs) {
      const page = await this.request<{ styles?: StyleInfo[] }>(
        `/styles/selector?tab=${encodeURIComponent(tab)}`,
      );
      for (const style of page.styles ?? []) {
        merged.set(style.prompt_style, style);
      }
    }
    this.styleCache = merged;
    return merged;
  }

  /**
   * Refuse a request the catalogue says cannot work, before it is paid for.
   *
   * Replaces `assertAvailableStyle`, which was broken three ways: its model whitelist
   * rejected every animation and tileset style, it looked animations up under their own
   * prefix rather than the `animations` key, and it only ever queried `tab:image`.
   */
  async assertRequest(
    request: RetroInferenceRequest,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const prefix = request.prompt_style.split("__")[0] ?? "";
    const tab = TAB_BY_PREFIX[prefix];
    if (!tab) {
      throw new Error(
        `unknown Retro Diffusion style family ${prefix} — expected one of ${Object.keys(TAB_BY_PREFIX).join(", ")}`,
      );
    }

    const key = STATUS_KEY[prefix];
    if (key) {
      const health = (await this.status()).status?.[key];
      // The board reports `animations: "unknown"` while the animation styles work fine,
      // so an unknown reading is a warning rather than a wall.
      if (health && health !== "ok" && health !== "unknown" && !options.force) {
        throw new Error(`Retro Diffusion ${key} reports "${health}"`);
      }
      if (health === "unknown") {
        console.warn(
          `[rd] ${key} health is "unknown" — proceeding, the catalogue lists the style`,
        );
      }
    }

    const style = (await this.styles()).get(request.prompt_style);
    if (!style) {
      // Not fatal. The selector may return internal ids for some families (rd_fast comes
      // back as `default:rd_flux`), and the API accepts *both* forms — so a style missing
      // from the catalogue is unverifiable, not invalid. `check_cost` is the free way to
      // find out for certain, and the caller runs it next anyway.
      console.warn(
        `[rd] ${request.prompt_style} is not in the live catalogue — limits unverified`,
      );
      return;
    }
    const complain = (
      what: string,
      low: number,
      high: number,
      got: number,
    ): never => {
      throw new Error(
        `${request.prompt_style} wants ${what} ${low}..${high}, got ${got}`,
      );
    };
    if (request.width < style.min_width || request.width > style.max_width) {
      complain("width", style.min_width, style.max_width, request.width);
    }
    if (
      request.height < style.min_height ||
      request.height > style.max_height
    ) {
      complain("height", style.min_height, style.max_height, request.height);
    }
    if (request.num_images > style.max_number_of_images) {
      complain("num_images", 1, style.max_number_of_images, request.num_images);
    }
    if (style.require_input_image && !request.input_image) {
      throw new Error(`${request.prompt_style} requires an input_image`);
    }
    if (request.reference_images?.length && !style.supports_reference_images) {
      throw new Error(
        `${request.prompt_style} does not accept reference_images — use input_image + strength instead`,
      );
    }
  }

  /**
   * Submit a job and return its id, **without retrying**.
   *
   * If this throws, the job may or may not have been accepted and charged. The caller
   * must not resubmit; it should call `listTasks` and match on `created_at`.
   */
  /**
   * Submit a job and return its id, **without retrying**.
   *
   * If this throws `RejectedBeforeCharge` the server refused it and nothing was created —
   * wait and submit again. Any *other* throw is ambiguous: the job may have been accepted
   * and charged before the response was lost, so the caller must not resubmit and should
   * look for the orphan with `listTasks` instead.
   */
  async submit(
    request: RetroInferenceRequest,
  ): Promise<{ task_id: string; request_id: string }> {
    return this.request<AsyncResponse>(
      "/inferences",
      {
        method: "POST",
        body: JSON.stringify({
          ...request,
          check_cost: false,
          async: true,
          upload_outputs: true,
        }),
      },
      1,
    );
  }

  /**
   * Recent async jobs, newest first — the recovery path for a lost submission.
   *
   * RD's own `11_recover_async_tasks.py` is explicit about why this exists: if the
   * response carrying the `task_id` never arrives, the job was still accepted **and
   * charged**, so resubmitting pays twice. Find it here instead.
   */
  async listTasks(
    limit = 20,
    status?: "pending" | "running" | "succeeded" | "failed",
  ): Promise<TaskSummary[]> {
    const clamped = Math.max(1, Math.min(limit, 100));
    const query = new URLSearchParams({ limit: String(clamped) });
    if (status) query.set("status", status);
    const body = await this.request<{ tasks?: TaskSummary[] }>(
      `/inferences/tasks?${query}`,
    );
    return body.tasks ?? [];
  }

  /**
   * The canvas edit tools, with live pricing. No key required.
   *
   * Worth calling rather than hardcoding: it is the authority on which tools are free,
   * and the whole ingestion chain this project depends on — downscale, palette lock,
   * pixel correction — is free only because that catalogue says so.
   */
  editTools(): Promise<EditToolInfo[]> {
    return this.request("/edit/tools");
  }

  async poll(
    taskId: string,
    onStatus?: (status: string) => void,
  ): Promise<RetroInferenceResult> {
    for (let attempt = 0; attempt < 180; attempt++) {
      const task = await this.request<TaskResponse>(
        `/inferences/tasks/${taskId}`,
      );
      onStatus?.(task.status);
      if (task.status === "succeeded" && task.result) return task.result;
      if (task.status === "failed") {
        throw new Error(`Retro Diffusion job failed: ${detailOf(task.error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Retro Diffusion job timed out after six minutes");
  }

  estimate(request: RetroInferenceRequest): Promise<RetroInferenceResult> {
    return this.request("/inferences", {
      method: "POST",
      body: JSON.stringify({ ...request, check_cost: true, async: false }),
    });
  }

  async generate(
    request: RetroInferenceRequest,
    onStatus?: (status: string) => void,
  ): Promise<RetroInferenceResult> {
    const accepted = await this.submit(request);
    return this.poll(accepted.task_id, onStatus);
  }

  async edit(tool: string, payload: Record<string, unknown>): Promise<string> {
    const result = await this.request<{
      base64_images?: string[];
      output_urls?: string[];
    }>(`/edit/tools/${tool}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result.base64_images?.[0]) return result.base64_images[0];
    const url = result.output_urls?.[0];
    if (!url) throw new Error(`Retro Diffusion ${tool} returned no image`);
    return Buffer.from(await rdDownload(url)).toString("base64");
  }

  async images(result: RetroInferenceResult): Promise<Buffer[]> {
    const images = (result.base64_images ?? []).map((value) =>
      Buffer.from(value, "base64"),
    );
    if (images.length > 0) return images;
    for (const url of result.output_urls ?? []) {
      images.push(Buffer.from(await rdDownload(url)));
    }
    return images;
  }
}
