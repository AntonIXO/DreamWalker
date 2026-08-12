const API_ROOT = "https://api.retrodiffusion.ai/v1";

export interface RetroInferenceRequest {
  prompt: string;
  prompt_style: string;
  width: number;
  height: number;
  num_images: number;
  seed: number;
  input_palette?: string;
  reference_images?: string[];
  remove_bg?: boolean;
  bypass_prompt_expansion?: boolean;
  upload_outputs?: boolean;
  check_cost?: boolean;
  async?: boolean;
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
  constructor(private readonly token: string) {
    if (!token.startsWith("rdpk-")) {
      throw new Error("RETRO_DIFFUSION_API_KEY is missing or malformed");
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    retries = 3,
  ): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(`${API_ROOT}${path}`, {
          ...init,
          headers: {
            "X-RD-Token": this.token,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
          },
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (response.ok) return body as T;
        last = new Error(
          `Retro Diffusion ${response.status}: ${detailOf(body)}`,
        );
        if (response.status !== 429 && response.status < 500) throw last;
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        const delay = retryAfter > 0 ? retryAfter * 1000 : 750 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        last = error;
        if (attempt === retries - 1) break;
        await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
      }
    }
    throw last;
  }

  async assertAvailableStyle(style: string): Promise<void> {
    const model = style.split("__")[0];
    if (!model || !["rd_fast", "rd_plus", "rd_pro"].includes(model)) {
      throw new Error(`unsupported Retro Diffusion image style ${style}`);
    }
    const status = await this.request<{ status?: Record<string, string> }>(
      "/status",
    );
    if (status.status?.[model] !== "ok") {
      throw new Error(`Retro Diffusion ${model} is not currently available`);
    }
    const selector = await this.request<unknown>(
      `/styles/selector?model=${model}&tab=tab:image`,
    );
    const entries = Array.isArray(selector)
      ? selector
      : ((selector as { items?: unknown[] }).items ?? []);
    if (
      entries.length > 0 &&
      !entries.some(
        (entry) => (entry as { prompt_style?: string }).prompt_style === style,
      )
    ) {
      throw new Error(
        `Retro Diffusion style ${style} is not in the live catalog`,
      );
    }
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
    const accepted = await this.request<AsyncResponse>("/inferences", {
      method: "POST",
      body: JSON.stringify({
        ...request,
        check_cost: false,
        async: true,
        upload_outputs: true,
      }),
    });
    for (let poll = 0; poll < 180; poll++) {
      const task = await this.request<TaskResponse>(
        `/inferences/tasks/${accepted.task_id}`,
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
    return Buffer.from(await (await fetch(url)).arrayBuffer()).toString(
      "base64",
    );
  }

  async images(result: RetroInferenceResult): Promise<Buffer[]> {
    const images = (result.base64_images ?? []).map((value) =>
      Buffer.from(value, "base64"),
    );
    if (images.length > 0) return images;
    for (const url of result.output_urls ?? []) {
      images.push(Buffer.from(await (await fetch(url)).arrayBuffer()));
    }
    return images;
  }
}
