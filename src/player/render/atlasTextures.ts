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

/** Load optional author-time PNGs without adding them to the indexed terrain atlas. */
export async function loadExternalTextures(
  baseUrl: string,
  sources: Array<{ id: string; path: string }>,
): Promise<Map<string, Texture>> {
  const textures = new Map<string, Texture>();
  await Promise.all(
    sources.map(async ({ id, path }) => {
      const texture: Texture = await Assets.load({
        src: `${baseUrl}/${path}`,
        alias: `dream-external:${id}`,
        data: { scaleMode: "nearest" },
      });
      texture.source.scaleMode = "nearest";
      textures.set(id, texture);
    }),
  );
  return textures;
}
