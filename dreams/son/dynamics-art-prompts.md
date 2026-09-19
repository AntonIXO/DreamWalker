# Living-object artwork

Generated with the built-in ImageGen tool on 2026-09-19. Source images were inspected
first. These are precise cleanup plates and object-state sprites; room geometry did not
change. Original images remain recoverable from Git. M9 uses the apartment backdrop,
which contains no painted cupboard at the live cupboard position and needed no cleanup.

## Cleanup plates

The five edited files are in `content/assets/rooms/`:

- `10-komnata-s-grobami.png`
- `15-osennii-les-s-grobom.png`
- `05-shesterochka.png`
- `06-kanava-garazhi-podvorotni.png`
- `13-podzemnye-zaly-cu.png`

The first cleanup prompt was:

> Use case: precise-object-edit. Asset type: existing top-down pixel-art game room
> backdrop, exact-layout cleanup plate. Edit the supplied image, do not redesign or
> reinterpret the room. Remove ONLY the two large wooden coffins with their lids in the
> upper-left quadrant, leaving their purple rugs, candle and flower stand in place;
> restore the portions of rugs and stone floor previously hidden by the coffins. Also
> remove ONLY the pale patterned loose cloth spread on the bottom-left wooden stand
> (restore the bare stand underneath), the black rotary phone at bottom-center (keep its
> little table), and the small tied pale packets on the floor at bottom-right (keep the
> urn and bench). Those removed objects are separately rendered movable game sprites
> and must not remain painted into the background. Preserve every wall, wall crack,
> floor grout line, doorway, threshold, rug, column, remaining furniture, lighting
> direction and shadow outside edited objects; preserve the exact image framing,
> dimensions, pixel-art density and palette. Inpaint unobtrusively with the same
> hand-pixelated stone/rug/wood textures. Do not add hatches, doors, labels, UI,
> characters, new decorations, blurry areas, flat rectangle masks or color blocks.
> Output just the edited background image.

The other four used this prefix:

> Use case: precise-object-edit. Asset type: an existing top-down pixel-art game room
> backdrop, precise-layout cleanup plate. Edit this exact supplied image, do not redesign.

Then the respective edit instruction:

- Forest: Remove ONLY the dark wooden coffin in the upper middle, including its cast
  shadow, and the loose framed group photograph at upper-right including its leaning
  stand and candles immediately touching the stand. Seamlessly continue the autumn
  dirt-and-leaf ground behind them. Keep the Aztec toilet/pyramid, every tree trunk,
  root, leaf-bank, puddle and the west/east/south open paths in their exact positions.
- Shop: Remove ONLY the entire personal-belongings metal shelf at the TOP LEFT (the
  shelf with backpacks, shopping bags and hanging cloth, to the LEFT of the stacked
  red baskets); also remove the small red loose shopping basket on the floor in the
  lower-left quadrant. Restore the grey wall and tiled floor behind these removed
  objects. Keep every grocery aisle, all grocery refrigerators, cash registers, lower
  shelves, the red stack of baskets, and all four wall/doorway anchors exactly as they are.
- Ditch: Remove ONLY the brown/green backpack on the wet asphalt left of center, and
  its cast shadow. Seamlessly continue the same wet asphalt, small puddles and scattered
  grit behind it. Preserve every garage, gate, wall, drainpipe, large manhole on the right,
  tire track, lit lamp and every passage exactly in place.
- Underground hall: Remove ONLY the brown backpack, bottle and fruit bowl at the LOWER
  RIGHT beside the bleachers (keep the low cabinet/table underneath them). Also remove
  ONLY the standalone tiny sofa and its rug/table/bottle in the UPPER LEFT of the open
  central floor, restoring the empty tile grid there; that sofa is a movable gameplay
  object. Preserve the bleachers, walls, all four doors, central podium and lighting
  exactly in place.

And this suffix:

> The removed things will be rendered as independent interactive sprites. Preserve
> exact composition, framing, aspect ratio, pixel-grid crispness, palette, original
> lighting, and all unmentioned details. Inpaint only the removed objects with coherent
> existing textures. No new objects, characters, text, doors, hatches, blur, geometric
> mask blocks, UI or watermark. Return only the complete cleaned background.

## Coffin states

Closed image replaces `content/assets/objects/10-komnata-s-grobami--groby.png` and
`content/assets/objects/15-osennii-les-s-grobom--grob.png`. Open state is
`content/assets/objects/coffin-open.png`. Both use a 1024×1536 RGBA canvas with actual
alpha transparency and the same external silhouette. The player can occupy the empty
interior; collision and ground size remain authored independently of image resolution.

Closed-state prompt, with the forest room supplied as a style reference:

> Use case: stylized-concept. Asset type: a single isolated top-down coffin game sprite
> on genuine transparent background. Input image is ONLY a style and material reference,
> not an edit target. Extract/recreate the dark red-brown wooden coffin motif as a clean
> usable sprite. One CLOSED coffin, vertical orientation with head at top and foot at
> bottom, beveled traditional six-sided silhouette, brass side handles, small pale
> understated emblem on the lid, dark brown wood with burgundy grain and narrow
> gold-brown edge. Camera directly overhead with only a tiny south-side lip, matching a
> classic top-down pixel RPG. The entire coffin must fit in the central 80% of a portrait
> 2:3 canvas; no cropped edges. Crisp deliberately visible square pixel clusters, limited
> 20-color palette, 64 by 96 logical pixel-art detail presented at an integer upscale.
> Transparent RGBA background, no shadow plate, no floor, no rug, no room, no text, no
> people, no scene, no checkerboard painted into image. Produce exactly one closed
> coffin sprite.

Open-state prompt, with that closed sprite supplied as the edit target:

> Use case: precise-object-edit. Edit target: the supplied transparent CLOSED coffin
> game sprite. Make its OPEN, EMPTY state by removing ONLY the top lid inside the
> existing outer rim. Reveal a dark burgundy padded interior, with a small pale folded
> pillow at the top/head and enough visible empty interior for a game character to lie
> in. Keep the EXACT same canvas 1024x1536, external silhouette, pixel-art grid, outer
> wooden rim, four brass handles, scale, framing, top-down camera and placement. The lid
> is completely removed out of view; do not draw a second object or lid to the side, do
> not enlarge the silhouette. Genuine transparent alpha background must stay
> transparent; preserve background transparency and no added glow. It must be an
> aligned alternate animation frame so switching closed/open never shifts the coffin
> body. No person, no writing, no skulls, no floor, no checkerboard painted into image,
> no new furniture. Only replace the lid surface with open empty inner padding.
