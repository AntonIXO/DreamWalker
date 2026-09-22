# Son: architecture and object art

The visual pass replaces the identical street spacing with authored gaps of 7–29
tiles and walkable bends. Sixteen interiors use chamfered, slanted, bow-shaped or
apsidal outlines. These are real walk-mask changes: the floor painting is clipped
to the same cells that stop the walker. Room identities, rifts and lock policies
remain part of the existing catalogue.

Four floor materials and four transparent 16-frame sheets live in
`content/assets/style/`. `frames.json` records the inspected, alpha-bounded regions
of the original generated sheets; no per-object copies or runtime generation are
needed. Asset references use `#frame=x,y,w,h,sheetWidth,sheetHeight`. The loader,
inventory thumbnails and Lord publisher understand these regions.

The sources were generated with the imagegen tool, using explicit camera, palette,
grid, transparency and object constraints from the
[OpenAI image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting?model=gpt-image-2.5).
The subject matter comes from `dream-walker-anton/rooms.md` and the objects in
`dream-walker-bible.md`: orange benches, cloakroom tags, Sailfish phone, dented
laptop, CRT, the blue slug, cooker, giant chocolate egg, coffin and ordinary
furniture. Fourteen additional furnishings are physical, examinable objects.

`rooms/art-direction.ts` owns material selection, sprite bindings, footprints,
furnishings and entrance clearance. Object images retain their aspect ratio and
are anchored to the bottom of the collision footprint. Their upper portion may
rise above that footprint; fixed furniture and movable things share the actor
depth sort. Floor decorations stay below actors. The slug breathes on its authored
six-second cycle; screen luminance varies gently. Reduced-motion mode keeps both
still.

The Lord publishes all source sheets with `bun run lord build son`. Exact known
save versions migrate to the new room origins, floor masks and object dimensions,
retaining inventory, dialogue history, journals, cycle state and door decisions.
Do not broaden compatibility by slug alone; update the target fingerprint when
changing authored data.

Checks cover connector connectivity and continuous seams, actor-sized arrival
clearance, added furniture against thresholds and figure slots, real walking
through the curved courtyard–hotel route, and save migration with preserved object
ground contacts. Browser review should include the courtyard, hotel, school and
pool, plus taking and dropping an object and a reload.
