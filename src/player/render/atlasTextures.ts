/**
 * Loading the baked atlas into textures.
 *
 * One PNG, one `TextureSource`, and a `Texture` per frame that points at a rectangle
 * inside it. Sharing the source is the whole reason the tilemap can be thousands of
 * sprites and still batch into a handful of draw calls.
 *
 * `scaleMode: "nearest"` is set on the source rather than per texture — pixel art that
 * gets bilinear filtering anywhere looks like a mistake, and there is no case here
 * where smoothing is wanted.
 */

import { Assets, Rectangle, Texture } from "pixi.js";

import { validateAtlasManifest, type AtlasManifest } from "../../shared/dream";

export interface AtlasTextures {
  manifest: AtlasManifest;
  /** Public sheet URL and dimensions, also used by DOM portrait crops. */
  imageUrl: string;
  sheetWidth: number;
  sheetHeight: number;
  /** Frame name -> texture. */
  frames: Map<string, Texture>;
  /** Role -> textures, in the order the manifest listed them. */
  roles: Map<string, Texture[]>;
  tileSize: number;
}

let assetsReady = false;

export async function loadAtlas(baseUrl: string): Promise<AtlasTextures> {
  const manifestResponse = await fetch(`${baseUrl}/atlas.json`);
  if (!manifestResponse.ok) {
    throw new Error(
      `no atlas at ${baseUrl}/atlas.json — run \`bun run lord build <slug>\` first`,
    );
  }
  const manifest = validateAtlasManifest(await manifestResponse.json());

  // Once per page. A second init throws; hot reload would otherwise blow up here.
  if (!assetsReady) {
    await Assets.init({ texturePreference: { resolution: 1 } });
    assetsReady = true;
  }

  const sheet: Texture = await Assets.load({
    src: `${baseUrl}/${manifest.image}`,
    // Vite serves the atlas with a cache-busting query in dev; keep the alias stable.
    alias: "dream-atlas",
    data: { scaleMode: "nearest" },
  });
  sheet.source.scaleMode = "nearest";

  const frames = new Map<string, Texture>();
  for (const [name, frame] of Object.entries(manifest.frames)) {
    frames.set(
      name,
      new Texture({
        source: sheet.source,
        frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
        label: name,
      }),
    );
  }

  const roles = new Map<string, Texture[]>();
  for (const [role, names] of Object.entries(manifest.roleFrames)) {
    const list = names.map((name) => {
      const texture = frames.get(name);
      if (!texture)
        throw new Error(`atlas role "${role}" names missing frame "${name}"`);
      return texture;
    });
    roles.set(role, list);
  }

  return {
    manifest,
    imageUrl: `${baseUrl}/${manifest.image}`,
    sheetWidth: sheet.source.width,
    sheetHeight: sheet.source.height,
    frames,
    roles,
    tileSize: manifest.tileSize,
  };
}

/**
 * Picks between a role's variants by position, so the choice is stable: the same tile
 * looks the same across a reload, and a heartbeat rewriting a neighbouring room does
 * not make this one flicker.
 */
export function variantFor(textures: Texture[], x: number, y: number): Texture {
  if (textures.length === 1) return textures[0]!;
  const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  return textures[hash % textures.length]!;
}

/**
 * Optional PNGs that must not block boot: missing art falls back to atlas silhouettes.
 */
export async function loadOptionalTexture(
  url: string,
  alias: string,
  scaleMode: "nearest" | "linear" = "nearest",
): Promise<Texture | null> {
  const texture = await Assets.load<Texture | undefined>(
    {
      src: url,
      alias,
      data: { scaleMode },
    },
    {
      strategy: "skip",
      onError: (error) =>
        console.warn(`[dream] optional image skipped: ${url}`, error),
    },
  );
  if (!texture) return null;
  texture.source.scaleMode = scaleMode;
  texture.source.autoGenerateMipmaps = false;
  return texture;
}

/** Load optional author-time PNGs without adding them to the indexed terrain atlas. */
export async function loadExternalTextures(
  baseUrl: string,
  sources: Array<{ id: string; path: string }>,
  options: {
    concurrency?: number;
    scaleMode?: "nearest" | "linear";
  } = {},
): Promise<Map<string, Texture>> {
  const textures = new Map<string, Texture>();
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const scaleMode = options.scaleMode ?? "nearest";
  let cursor = 0;

  // `Assets.load` caches each file, but feeding the browser a hundred independent PNG
  // decodes through one Promise.all can still exhaust ImageBitmap/decoder resources.
  // Keep a small bounded pool: art is optional, but "optional" must not mean that a
  // valid room silently falls back to grey tiles because its neighbours loaded at once.
  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
      while (cursor < sources.length) {
        const source = sources[cursor++]!;
        const url = `${baseUrl}/${source.path}`;
        const texture = await loadOptionalTexture(
          url,
          `dream-external:${source.id}`,
          scaleMode,
        );
        if (texture) textures.set(source.id, texture);
      }
    }),
  );
  return textures;
}
