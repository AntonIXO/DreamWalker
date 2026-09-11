# DREAM WALKER — production prompts for room backdrops

These are the exact art-direction prompts for the 29 authored backgrounds in the main
`son` dream plus the waking-world procedure-room lobby. Each dream generation uses the
shared block followed by one room card. The room
cards deliberately describe more interaction capacity than the current build consumes:
canonical objects are painted into the mural, while quiet pads and secondary perimeter
details remain available for future clues, figures, carried objects, and World Mind edits.

Generation target: `gpt-image-2.5-sunburst`. The structure follows OpenAI's current
[image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting):
define the intended result and aspect ratio, name visible material/light/color details,
separate the room scene from constraints, and inspect rather than assuming camera cues
were followed exactly.

## Shared prompt — places 01–25

```text
Use case: stylized-concept
Asset type: final playable 2D game room backdrop for DREAM WALKER
Generation model requirement: GPT-Image-2.5 Sunburst (`gpt-image-2.5-sunburst`).
Primary request: create a distinctive authored environment from the room card below. The
image is the room itself, not an illustration of it and not a mood board.
Style/medium: late-1990s PlayStation dream-game pixel art; hard square pixels; visible
32 px grid logic; low-fidelity world art with high intentionality; clean hard edges;
ordered dithering; no anti-aliasing. Use one shared 28-color family: #0a0a0d, #161920,
#1b1e25, #242832, #2b2f38, #333845, #3d4351, #4a5162, #5c6678, #6b7280,
#9fb3c8, #c2b8a3, #e8e4dc, #f0c674, #8a6a3c, #5a2f2f, #241c38, #40305b,
#6f4c79, #18383b, #2e6264, #65a0a0, #37412b, #67754a, #99a56c, #8e4936,
#c4723f, #d9b75d. Washed bone-cream light, deep indigo/violet shade, restrained teal,
olive, sand and dried-blood accents. Mundane objects receive deadpan, excessive care;
unease comes from accepted inappropriateness, never from conventional horror.
Composition/framing: exact 20:11 wide landscape. Orthographic bird's-eye camera looking
straight down; no horizon, no vanishing point, no oblique or isometric perspective. Treat
the canvas as a 20-column by 11-row playable floor plan. Keep a broad, continuous,
uncluttered walkable center and clear routes between every named threshold. Put permanent
architecture and canonical objects mainly around the perimeter. Each canonical object
must have a clean silhouette and at least one adjacent approach tile. Reserve at least
six visually quiet empty 1–2 tile pads in the center and lower half for NPCs, loose items,
future clues, and world mutations. Add at most two or three low-salience, plausible
secondary interaction candidates along the perimeter; never turn the room into clutter.
Thresholds: all named exits must be unmistakably traversable openings touching the
correct canvas edge. Do not crop or hide a door, stair, lift, rift, passage, or interaction
point. A strange destination is allowed; an invisible threshold is not.
Constraints: environmental background only; no human NPCs, bodies, human silhouettes,
or player character baked into the mural. Canonical nonhuman creatures may appear only
when the room card explicitly requires them. No readable text, letters, numbers, UI, logos,
signatures, or watermark; signs and screens may contain only illegible pixel marks. Do
not center one hero object. No black vignette or decorative border.
Avoid: generic medieval dungeon, generic cave room, interchangeable grey-stone chamber,
isometric view, side view, perspective interior, maze, dense clutter, symmetrical layout,
cozy-game cuteness, neon cyberpunk, photorealism, painterly blur, soft gradients, vector
art, smooth 3D rendering.
```

## Shared prompt — meta-spaces M1–M4

```text
Use case: stylized-concept
Asset type: final playable full-frame transition-space backdrop for DREAM WALKER
Generation model requirement: GPT-Image-2.5 Sunburst (`gpt-image-2.5-sunburst`).
Style/medium: the same hard-edged late-1990s PlayStation pixel-art language and exact
28-color family used by the place backgrounds. Make incompatible materials meet at blunt,
visible seams: technical diagram against tissue, mineral against flesh, household surface
against void. Deadpan and banal, not theatrical horror.
Composition/framing: exact 16:9 landscape, full-frame spatial field, orthographic/top-down
readability, no conventional horizon. Keep a continuous calm walking field through the
middle and at least four quiet empty pads for temporary objects or future interactions.
The automatic exit is temporal, so do not invent a normal exit door. Perimeter forms may
imply routes that never quite become usable.
Constraints: no people or characters baked into the image; no readable text, letters,
numbers, UI, logos, signature, watermark, vignette, or ornamental frame.
Avoid: a normal room, a generic dungeon, cinematic monster horror, gore spectacle,
photorealism, isometric perspective, centered symmetry, blur, smooth gradients.
```

## 01 — Отель. Готический холл

```text
Scene: a cathedral-scale hotel coat-check hall where administration has replaced religion.
Endless coat racks and numbered hooks recede as flat overhead bands around the perimeter;
the building is grand yet visibly too small to contain what it claims. Bone-cream registry
light falls into indigo corners. A rope descends at the far-left upper area, discarded
trousers lie lower-left, an unreadable floor-class sign sits upper-left, a lagging old
phone rests upper-right, dense coat-check tags gather at lower-right, and a cleaner's
bucket and mop wait near the bottom-right edge. Keep four generous NPC pads and a broad
central processional aisle.
Exits: broad open passages on all four edges; a distinct one-way lift threshold near the
lower-left interior, clearly approachable without blocking the west or south route.
Mood: beautiful institutional scale that quietly says the visitor belongs to no class.
```

## 02 — Школа. Кабинет русского

```text
Scene: Soviet-era Russian classroom, pale green oil paint to waist height, tired linoleum,
fluorescent tubes with a sick green cast. Sparse desk rows leave wide walking lanes; one
desk at left is turned to face the wall. Mutable exam papers sit near it. Across the upper
wall, an enormous window admits a pear tree pressing ripe warm-yellow fruit against the
glass—the only saturated warmth, clearly unreachable. A gym mat with an implausibly made
bed occupies the lower-right perimeter. Leave the lower center empty for two figures and
future classroom objects.
Exits: broad classroom passages on top, bottom, left, and right edges, each visually open.
Mood: boredom mixed with doom; humiliatingly ordinary, not haunted-house scary.
```

## 03 — Горы. Стартаперы и учёные

```text
Scene: exposed high mountain slope rendered as a top-down traversable plateau. Bleached
snow and wet olive rock form a clear central trail. In the upper-center a small globe-like
centroid stands on a thin metal rod over a sharp drop; scattered business cards sit left,
a surveying theodolite waits at right, and a rock with one unnaturally saw-cut face lies
lower-left. Suggest a collapsing rock passage along the right boundary and a damp forest
route beyond it. Keep two group-sized empty staging areas—one larger than the other—for
startup people and fewer scientists, without drawing them.
Exits: traversable mountain passages on west, east, and south edges; no north exit.
Mood: thin air, wind, jitter, and institutional ambition with no mass.
```

## 04 — Дача Гнедковых

```text
Scene: warm Russian country-house kitchen belonging to absent hosts. Old wood, kerosene
light, preserves, curtains, and two domestic levels implied without perspective. A gas
stove in the upper-left looks ordinary but vents like a punctured lung; a phone with one
contact sits upper-center; a clean rectangular piece of wall has been slid aside at
upper-right to reveal black space; a blue sticky slug waits by stairs on the left. The
home is exactly cozy enough to worsen the unease. Keep the middle open for visitors and
future household items; include one empty counter and one clear floor corner.
Exits: broad openings on top, left, and right edges; the shifted wall and cellar/stair
features remain separate interactable landmarks, not fake edge exits.
Mood: familiar house at night, calm advice about a possible explosion.
```

## 05 — Шестёрочка

```text
Scene: cheap Russian discount supermarket under flat white fluorescence. Checkout lanes
and stocked shelves hug the perimeter. Along upper-left is a metal shelf for abandoned
bags long and wide enough for a person to sleep on, with an unreadable placard; nearby an
unstable promotional price tag. A shopping basket with indistinct contents waits lower-
left; a security desk and pepper-spray hook occupy the right side, but no guard is shown.
One aisle may be colored wrong. Keep a broad store-floor arena and two separate figure
approach lanes for future commotion.
Exits: broad open passages on top, right, and bottom edges; the west edge stays solid.
Mood: boiled-chicken fluorescent color, routine retail violence just outside the frame.
```

## 06 — Канава, гаражи, подворотни

```text
Scene: wet concrete drainage ditch between rows of peeling garages at dusk. The ditch is
a long readable walking basin, not a cave. A heavy backpack lies left of center, a large
sewer hatch occupies the right side, unexplained tire tracks cross the lower-middle, and
one empty muddy depression marks where a stranger could fall. Rain strikes everything
except the ditch. Warm vehicle light arrives early on a garage wall from off-screen.
Leave clear hiding/staging pockets for Kirill, a pursuer, and future doubling enemies,
without drawing anyone; keep the main escape lane open.
Exits: broad openings on top, right, and bottom edges; west wall closed.
Mood: the darkest dynamic room, arithmetic danger on revisits rather than gore.
```

## 07 — Бассейн и односторонний лифт

```text
Scene: Soviet swimming-pool changing room seen straight down. Wet pale tile, still blue-
grey pool water in a large central-lower rectangle, caustic marks, numberless lockers, and
wall hooks holding ordinary towels and women's underwear along the upper perimeter. An
elevator alcove with a single unlabeled upward control sits upper-left; an empty hook and
wet patch indicate the missing towel. Keep walkable dry strips around all four sides of
the pool, two quiet figure pads, and empty locker-front pads for future objects.
Exits: only the one-way lift threshold near the lower-left interior; every outer edge is
visibly closed so the trap reads honestly.
Mood: shame, tiled reverberation, water too still to be comfortable.
```

## 08 — Квартира, в которой живут другие

```text
Scene: a familiar compact apartment whose colors and ownership are wrong. Wallpaper is
two shades too pink; other people's slippers and photos occupy Anton's habitual places.
An oversized crude folded-paper wall sculpture is displayed solemnly at left, framed
foreign photographs line the upper wall, a small electrical shimmer hangs in the center,
and a kettle that has already boiled sits on the right. A window suggests the outside
darkens when opened. Furniture stays peripheral and the central floor remains navigable;
leave two clear resident pads and several empty personal-object pads.
Exits: broad passages on all four edges, visibly open and mutually connected.
Mood: return without possession; everyone accepts the single obscene detail as décor.
```

## 09 — Хакатон, третий по счёту

```text
Scene: modest Saint Petersburg hackathon venue with flat office light. Long tables,
power strips and damaged laptops form peripheral islands rather than barriers. A frozen
demo/countdown display sits upper-center; identical headphones rest upper-right; pink
hashish is displayed like an ordinary retail sample at right; a small pile of already-
paid cash lies lower-center. Blue lanyards and empty chairs imply the same returning
people without depicting them. Preserve a broad central collaboration floor with two
team-sized empty table ends and multiple future demo-object pads.
Exits: broad open thresholds on all four edges.
Mood: recognizably mundane and almost honest; exhausted repetition, no tech glamour.
```

## 10 — Комната с гробами

```text
Scene: austere near-monochrome room containing two open coffins on the left, lit by one
bone-colored shaft. The coffins are ordinary furniture-scale, not a horror tableau. A
high narrow wall crack sits near the upper-middle with tiny sealed packets visible inside;
a coded but unreadable cloth lies lower-left, more packets lower-right, and an old phone
lower-center. Keep the middle and right-middle clear for two figures, clue retrieval,
future evidence, and an unobstructed approach to every object.
Exits: broad open passages only on west and south edges; north and east remain solid.
Mood: graph-bottom stillness, museum care applied to banal burial equipment.
```

## 11 — Еврейский город

```text
Scene: a tiny ordinary café threshold opens into an entire secret night city. From above,
compact streets, shuttered façades and warm windows form perimeter blocks around a clear
central plaza; rendered detail deliberately falls away into outline at the edges. A bench-
sized unbranded surprise egg sits lower-left, sound-sensitive streetlamps line the right,
an unreadable schedule of safe hours rests near center-left, and shutters cover everything.
Leave a generous meeting square and multiple empty shopfront pads for future objects.
Exits: broad openings on all four edges; the café-scale west threshold remains visibly
smaller in architectural language while still covering the playable opening.
Mood: thematic heart of hiding from detection, domestic night rather than fantasy bazaar.
```

## 12 — Тюрьма на овощах

```text
Scene: improvised prison/storage yard where sleeping platforms are heaps of cabbages and
tropical fruit, rendered with absurd loving detail. A large produce bed fills left-middle
without blocking routes; a snow-drifted escape hole breaks the upper fence; a five-meter
shelf stands upper-right; a bean sack rests lower-right; an empty chair seen from behind
waits near center for the unnoticed aunt figure, but no person is baked in. Keep an easy,
obvious escape lane and several empty pads for more food, contraband, and inmates.
Exits: broad openings on all four edges in addition to the small canonical fence hole,
which must remain a separate interactable feature.
Mood: absurdly easy confinement, clean daylight, no prison melodrama.
```

## 13 — Подземные залы ЦУ

```text
Scene: enormous futuristic underground event hall resembling a corporate headquarters.
Panel seams and cold light define modular wall sections that could silently rearrange.
Grandstand seating occupies the right perimeter; a small couch-shaped sleeping place is
left of center; Japanese cider sits upper-left, a fruit-and-vodka backpack lower-right,
and ointment containers near center, all unbranded. Keep a very large empty central event
floor with quiet anchor pads for new demonstrations, props, and figures.
Exits: broad open passages on all four edges, each integrated as a movable wall aperture.
Mood: clean, too large, and acoustically empty; Portal-like reconfiguration without comedy.
```

## 14 — Поликлиника в Калуге

```text
Scene: provincial dental office with medical white and green cast. A dental chair and
instrument arm occupy the lower-left; an extracted tooth sits alone on a tray at upper-
right. Beside it, an open ordinary cabinet drawer contains two tiny capybaras and one cat
batting at them with a paw, warmer and more detailed than anything else. Everyone treats
this as routine. A clear lane across
the room is absurdly wide enough for cyclists. Keep two figure pads and spare tray/cabinet
pads for future medical interactions.
Exits: broad openings on top, right, and bottom edges; west edge closed.
Mood: endless drill sound implied; everyone ignores the cabinet.
```

## 15 — Осенний лес с гробом

```text
Scene: wet ochre autumn forest path with black trunks and almost no sky, viewed directly
from above. A closed coffin rests in the upper-middle with clear carrying space around it;
an Aztec-pyramid-shaped toilet with glimpses of Soviet pool tile sits upper-left; leaves
that do not match footsteps scatter center; an unreadable class-teacher photograph waits
upper-right. Keep the main forest path broad, with two group-sized clearings and empty
ground patches for new memorial objects.
Exits: traversable forest passages on west, east, and south edges; north remains dense.
Mood: funny and unbearable at once, never gothic cemetery horror.
```

## 16 — Норвежская деревня и погреб

```text
Scene: empty Norwegian village under wet-asphalt sky, reduced almost to grey, with one
warm window. The top-down village lane stays wide. A black root-lined cellar mouth with a
ladder missing lower rungs occupies lower-left; a small patch of snow flows like liquid
near center; clear empty standing pads at upper-right and lower-center are reserved for a
father and Kirill without drawing them. Roots meet nervous-tissue diagrams at an exposed,
unhidden seam. Add one unused shed threshold for future interaction.
Exits: broad passages on west, east, and south edges; north is solid village fabric.
Mood: maximum spatial swing and quiet exposure, not folklore horror.
```

## 17 — Душ, из которого нельзя выйти

```text
Scene: one cramped but fully playable shower room enlarged into a 20×11 overhead plan.
Ordinary wet tile, steam marks, drain channels and a perfectly normal closed shower door
on the upper-left wall. A plain valve and one subtly wrong tile sit upper-center. The
absurdity is that the door is unremarkable and cannot be used. Keep most of the floor
empty, continuous and static, with several dry pads for future toiletries or figures.
Exits: broad apparent passages on all four edges matching the runtime links, but design
each as another identical shower threshold so none promises actual escape; the canonical
ordinary door remains a separate interactable object.
Mood: maximal static trap, aggressively normal, no blood, chains, or horror props.
```

## 18 — Купол без стен

```text
Scene: near-empty winter field containing the skeletal frame of a geodesic dome whose
walls have vanished. The dome occupies the upper-middle without blocking the field. A
circle of barbed wire hangs unsupported at upper-left; a small silent wolf, bear, and a
few other animals stand in mechanical dance positions on the right, with additional empty
markers reserved for future creatures; an
unbroken snowy interaction field extends below. Leave the center exceptionally empty and
preserve multiple pads for future animals, objects, and a mother's intervention.
Exits: broad snow paths on west, east, and south edges; north fades into closed white field.
Mood: white absence and matter-of-fact impossible containment.
```

## 19 — Двор и оранжевые лавочки

```text
Scene: late-summer Russian residential courtyard, fresh paving, restrained greenery and
one apartment entrance with intercom at upper-right. Two unmistakable orange-slat benches
sit along left and lower-right perimeter; an ordinary bottle rests beside one bench and a
neatly overfilled bin near the other. Keep a broad central meeting square plus six quiet
staging pads and a few uncluttered curb/corner candidates for future interactions.
Exits: broad open pavement routes centered on top, bottom, left, and right edges; the
apartment/intercom remains a separate visible interactable entrance.
Mood: the one nearly normal safe room, warm late-summer light; long shadows disagree as if
cast by more than one sun.
```

## 20 — Офис Сбера

```text
Scene: cold corporate office with glass partitions and practical desks. An ultrawide
monitor with illegible corporate blocks sits upper-left; a bulky CRT showing an abstract
old fantasy-game landscape sits upper-middle; a lift alcove occupies upper-right; an
ordinary closed corridor door is centered high; lanyard badges rest lower-right. Keep the
central office floor open, preserve two workstation-adjacent figure pads, and leave spare
desk surfaces for future devices and paperwork. No company name or recognizable branding.
Exits: broad open passages on all four edges, visually distinct from the closed corridor
door and the lift landmark.
Mood: 15 kHz CRT whine and air conditioning implied; a tiny private refuge inside work.
```

## 21 — Комната Нилюфар

```text
Scene: small ordinary bedroom, calmer and drawn with softer care than any other place. A
bed occupies the left, a broad upper window gives a distant city view, a normal door on
the upper-right may be open or closed, and folded dance-group belongings sit lower-right.
Nothing signals importance. Keep the middle quiet, with two conversation pads and several
empty personal-object surfaces for future interactions.
Exits: broad openings on top, left, and right edges; bottom edge is visibly closed.
Mood: warm room tone, emotionally neutral, no soundtrack and no romantic symbolism.
```

## 22 — Крейсер

```text
Scene: grey warship deck converted for a family celebration. A small stage and microphone
stand upper-center; laid tables occupy the left perimeter; life rings and folded festive
cloth occupy the right; dark water runs alarmingly close along the left edge. Industrial
steel and domestic tablecloths meet without being harmonized. Keep a broad deck aisle,
two clear stage-queue pads, and open areas for future guests and carried objects.
Exits: broad deck passages on top, left, and right edges; south is closed by ship structure.
Mood: effortless exclusion during a cheerful meal, not naval combat.
```

## 23 — Нигерия. Конференция

```text
Scene: Soviet-built modernist conference building in West African daylight. Monumental
columns occupy upper-left; VR headsets on stands sit right-middle; an unreadable badge
rests near center-left; a scale model/portal of a hotel whose interior is smaller than its
exterior sits upper-center. Tropical heat, old marble corridor, and one peripheral alley
all coexist without a montage seam. Keep a clear conference floor and several empty demo,
networking, and future-object pads.
Exits: broad openings only on top and left edges; right and bottom remain architectural.
Mood: bad PA echo, defeated air conditioning, geography treated as routine.
```

## 24 — Дом, где тебе объясняют, что ты должен

```text
Scene: cramped apartment kitchen and doorway under a storm. Cocoa sits left-middle; a
piece of raw meat is displayed with altar-like care at lower-center while still plainly
being meat; a cardboard voice box sits right-middle; a slow old phone camera lies lower-
right. Empty floor positions on both sides of the doorway reserve room for three accusers
to crowd closer over time, but no people appear. Keep a narrow yet continuous escape lane
and a few spare domestic surfaces for future evidence.
Exits: broad openings only on top and left edges; northward storm access and the interior
door must be visually distinct.
Mood: contentless accusation, ordinary room tone, no cinematic menace.
```

## 25 — Метро и поезд, который не тот

```text
Scene: cold metro platform seen straight down. A departure board with illegible changing
marks runs along the upper-middle; an old phone frozen at an unlabeled progress bar lies
near center; a cardboard box that could contain a voice sits left-middle; abandoned bags
gather right-middle. Rails/tunnel geometry stays peripheral so the platform remains a
clear navigable floor. Reserve a large empty waiting zone for a synchronized crowd and
several bag-sized future interaction pads, without drawing anyone.
Exits: broad open passages on all four edges, each distinct from the dark tunnel mouth.
Mood: the routine announcement that everyone waited for the wrong thing.
```

## M1 — Корни

```text
Scene: a descending field of roots simultaneously made of wood and nervous tissue. Some
roots carry the familiar apartment wallpaper as a bluntly grafted surface; pale impulses
can travel along them. Thickness varies from arm to corridor. The forms pulse around an
open central path rather than filling it. Snow begins to flow slowly from one edge as if
an avalanche changed its mind. Leave quiet pads for carried or forgotten objects.
Mood: no threat at all, which makes departure urgent; the sleeper's giant nervous system.
```

## M2 — Мясная геометрия

```text
Scene: hygienically clean architectural space built from raw flesh that obeys strict right
angles, door openings and stair-code geometry. A tooth the size of a cabinet occupies one
corner; a bus-sized slug-shaped recess waits at the perimeter but contains no creature.
Moisture moves upward; walls appear able to settle by one pixel and snap back. Preserve a
wide orthogonal central route and several empty interaction pads. Visible seams must keep
blueprint, masonry and tissue separate rather than blending them into gore.
Mood: warm, wet, recently cleaned, physiologically uncomfortable but deadpan.
```

## M3 — Склад оставленного

```text
Scene: the supermarket's abandoned-bag shelf repeated toward an impossible horizonless
depth. Shelves hold backpacks, bean sacks, an unflashed phone, a dented laptop, sleeping
bag, towel and many empty grey placeholder boxes; half the objects look finished and half
remain flat blocks. Keep a long clear central aisle and empty shelf/floor positions for
every object the player may later drop. A distant empty chair faces away, reserving the
aunt's place without depicting her.
Mood: maximum static; stretched fluorescent hum and delayed echo made visible in spacing.
```

## M4 — Развилка, где ты остался

```text
Scene: cream void with two identical orange courtyard benches facing each other across a
small open walking field. One bench has an ordinary bottle and terrestrial scuff marks;
the other has a helmet and modest space apparatus arranged as casually as groceries.
Reserve an empty sitting/standing pad at each bench for two versions of the same figure,
but draw no person. Nothing else moves or explains the absent planet. Keep asymmetry in
small wear and object placement despite the mirrored premise.
Mood: one unresolved 2019 fork; courtyard ambience exists on one side, vacuum on the other.
```

## L0 — Процедурная 3 (lobby)

Use the shared place prompt, but replace its composition and text constraints with this
lobby-specific card:

```text
Scene: the waking-world procedure room where a sanitar prepares to enter a patient's
dream. Institutional psychiatry, improvised neuroscience, and cheap office equipment are
assembled without hiding their seams. Along the north wall from left to right: a long
workbench with small instruments and a deliberately blank front plate; a medical cross
panel; a control locker; an old terminal with a dark screen; closed double ward doors.
Along the south-left: a simple patient bed. Immediately to its right, reserve an empty
2×4-tile footprint for the existing live patient-and-dream-apparatus sprite—paint only
floor, cable sockets, and a faint equipment shadow there, never a patient or machine. A
worn rectangular carpet occupies the lower-middle; a small seed packet sits near its top
edge. Keep the broad middle floor clear for the playable sanitar and preserve approach
space in front of terminal, locker, patient bed, apparatus pad, and ward door.
Composition/framing: exact 18:13 landscape, a strict vertical 90-degree orthographic
bird's-eye floor plan, 18 columns by 13 rows. The room perimeter is closed except for a
broad entrance threshold across the lower wall and a smaller technical threshold in the
middle. No horizon, wall elevation, vanishing point, oblique, or isometric view.
Lighting/mood: flat bone-cream clinical light; deep indigo machinery and violet shadow;
warm rust and dried-blood accents. A workplace, not a shrine: routine robbery presented
as ordinary medical procedure.
Text: no generated words or labels; leave the plaques/screens blank for deterministic UI.
Constraints: environmental background only; no people, patient, sanitar, body, human
silhouette, player sprite, or large apparatus in the reserved pad. Do not block the central
circulation or the five hotspot approaches. No logos, letters, numbers, signature,
watermark, vignette, or ornamental frame.
```

### L0 targeted edit pass — more insanity, cringe, and trash

```text
Use Image 1 as the approved lobby layout and edit target. Preserve the exact 18×13 floor
plan, 90-degree camera, room boundary, lower entrance, furniture footprints, bed, carpet,
open central circulation, and completely empty patient/apparatus pad. Change only the
perimeter set dressing and material logic.

Turn the procedure room into improvised Russian psychiatric medicine assembled by people
who consider every absurdity normal: a three-litre pickle jar used as an IV reservoir;
medical tubing spliced into garden hose with electrical tape; a supermarket baggage shelf
repurposed as a surgical tray; an open dental drawer containing two calm capybaras while a
cat reaches toward them; one wall peeled open to expose thick roots wired into a
motherboard; an office printer feeding blank paper directly into a floor drain; a dangling
obsolete CRT connected to a kitchen gas stove control; mismatched extension cords and
taped cable junctions; a tiny geodesic dome used as a wastebasket; a traffic light above
the ward doors showing two colors at once; an empty coat-check rack with thousands of
brass tags; an ordinary piece of raw meat presented solemnly under a desk lamp; seed husks,
discount-store wrappers, and crumbling meat-colored insulation confined to wall edges.

Keep the center visually quiet and all five hotspot approaches clear. Keep the apparatus
rectangle empty except for floor sockets and a faint shadow. No person, patient, sanitar,
human silhouette, readable text, logo, UI, signature, watermark, conventional gore,
torture equipment, occult symbols, or haunted-asylum clichés. The room is ridiculous,
overly practical, and wrong—not merely grimy.
```

## Post-processing and acceptance

- Generate one image per room, never a multi-room sheet.
- Resize place murals to `320×176` and meta murals to `256×144` with a box/area filter,
  then remap to the shared 28-color palette without adding a second diffusion pass; the
  generated source already carries deliberate ordered pixel dithering.
- Preserve the lobby mural as a `1152×832` (4× logical resolution) true-color texture;
  Pixi maps it onto the exact `288×208` 18×13 world footprint. Do not palette-reduce this
  image: the high-resolution detail is intentional and nearest sampling keeps it crisp.
- Reject any result that is oblique/isometric, hides a named threshold, blocks the central
  route, bakes in people, contains readable text, or loses the room's canonical anomaly.
- Verify after reduction: silhouettes and approach spaces must still read at 1× scale.
- The final filename must remain `<room-id>.png`; `lord build son` publishes them.
