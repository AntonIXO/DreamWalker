# DREAM WALKER — промпты на генерацию пиксель-арта

Под Retro Diffusion (`rd-tile`, `rd-plus`, `rd-pro` через Replicate или свой API) и PixelLab. Промпты на английском — модели обучены на нём. Комментарии на русском.

---

## 0. Главный технический приём: состояния через референс, а не через промпт

Основная беда генеративного пиксель-арта — **персонаж в четырёх состояниях выглядит как четыре разных персонажа**. Решается не промптом, а порядком вызовов:

```
1. Генеришь состояние 0 (нейтраль). Отбираешь из 4 вариантов вручную.
2. Отобранное подаёшь как reference image в RD Pro.
3. Состояния 1, 2, 3 генеришь ТЕМ ЖЕ промптом,
   меняя ровно один слот — [STATE].
4. Seed фиксируешь. Палитру фиксируешь. Референс фиксируешь.
```

Меняется одно предложение из пятнадцати — модель не имеет повода перерисовать лицо. Это и есть разница между «сделано» и «нагенерено».

То же для комнат: одна комната = один seed, все ракурсы и все объекты от одного референса.

---

## 1. МАСТЕР-СТИЛЬ (константа, вклеивается в каждый промпт)

### 1.1. Префикс стиля

```
pixel art, 32px grid aligned, limited palette of 28 colors,
heavy ordered dithering in gradients, clean hard pixel edges, no anti-aliasing,
washed-out bleached lighting, pale bone-cream background value,
palette: deep indigo, violet, teal-cyan, olive, sand, bone-cream, dried-blood accent,
1998 PlayStation dream emulator aesthetic, low fidelity but high intention,
```

### 1.2. Правило шва — несущее

Из референса: у существа каждое крыло по своей логике — проволочный граф, мотыльковая органика, потрескавшаяся земля, геометрические осколки. Это закон мира, и он идёт в каждый промпт:

```
assembled from incompatible materials, technical wireframe grafted onto organic
tissue, mineral fused with flesh, the seam between materials is deliberately
visible and unhidden,
```

### 1.3. Правило тона — Кровосток

```
mundane banal object rendered with excessive reverence and detail,
deadpan, not spooky, unsettling through inappropriateness not through horror,
```

### 1.4. Негативный промпт (везде один)

```
anti-aliasing, blur, soft gradients, smooth shading, 3d render, vector art,
modern indie darling aesthetic, cute, chibi, anime eyes, neon cyberpunk,
oversaturated, glowing rim light, lens flare, watermark, text, signature,
symmetrical composition, centered subject, clean professional game asset,
photorealistic, painterly, airbrush
```

`symmetrical` и `centered` в негативе намеренно — центрованная композиция мгновенно выдаёт генерацию.

### 1.5. Технические параметры

| Тип | Модель | Размер | Заметки |
|---|---|---|---|
| Портрет | `rd-pro` | 128×128 | reference image обязателен со 2-го состояния |
| Спрайт на карте | `pixellab` | 32×48 | 4 направления, 2 кадра |
| Тайлсет комнаты | `rd-tile` | 32×32, tileset mode | palette lock, smart transitions |
| Ключевой объект | `rd-plus` | 48×48 или 64×64 | те, что дают линк |
| Мета-пространство | `rd-pro` | 256×144 | одна картинка, не тайлы |

Палитру зафиксировать **одним `.hex` файлом до начала работы** и подавать в Palette Control. Это главное, что отличает игру от коллажа.

---

## 2. ПЕРСОНАЖИ

### 2.1. Шаблон портрета

```
[СТИЛЬ 1.1]
portrait bust, three-quarter view, off-center composition, looking at viewer,
[ОПИСАНИЕ ПЕРСОНАЖА],
[STATE],
[СТИЛЬ 1.3]
```

### 2.2. Четыре слота [STATE] — одинаковы для всех фигур

```
S0  neutral, occupied with own business, eyes not on viewer, mid-gesture
S1  turned toward viewer, listening, one eyebrow raised, mouth slightly open
S2  wary, direct eye contact, head tilted back a fraction, jaw set
S3  knows. absolutely calm pleasant face, полностью neutral mouth,
    eyes locked on viewer and not moving, pupils slightly too small
```

**S3 — самый важный ассет в игре.** Не злой, не страшный. Вежливый и не моргающий. Если S3 читается как «злодей» — брак, перегенерировать. Он должен читаться как «она поняла и говорит про погоду».

### 2.3. Промпты по фигурам

**КИРИЛЛ** — младший брат, 25 снов, не умирает насовсем
```
teenage boy, shaved almost bald, oversized hoodie, thin neck,
cocky posture that collapses under pressure, a fresh scrape on cheekbone
that he does not remember getting,
```

**ПАПА** — авторитетная чушь с полной серьёзностью
```
middle-aged man, sport instructor build gone soft, tracksuit jacket,
weathered face, absolutely certain expression, holding an object
he is about to explain incorrectly,
```

**МАМА** — наводит порядок силой
```
woman in her forties, practical clothing, hair pinned back,
holding a coil of barbed wire the way one holds a shopping bag,
expression of someone who has already decided,
```

**БАБУШКА НАДЯ** — носитель запрета, иногда оказывается мамой
```
elderly woman, headscarf, market bag, disapproving mouth,
her face contains a second face underneath at 20 percent opacity,
[СТИЛЬ 1.2]
```

**ЛЁША ГНЕДКОВ** — ближайший друг, убит и жив одновременно
```
young man, friendly open face, one half of the portrait rendered in
full warm palette, the other half in cold desaturated grave palette,
the vertical seam down the middle is sharp and unhidden,
[СТИЛЬ 1.2]
```

**НИЛЮФАР** — первая любовь, отвергла, потом стала обычной
```
young woman, dark hair, walking past, seen from below as if she is elevated,
looking down at viewer without interest, ordinary clothing rendered
with disproportionate reverence and detail,
[СТИЛЬ 1.3]
```

**ТУРЫШЕВ** — старый друг, пути разошлись, остался бухать
```
young man same age as viewer, tracksuit, bench posture, beer in hand,
face of someone who stopped, courtyard behind him, orange bench slats,
warm and slightly out of focus around the edges,
```

**АНТОН** — фигура-самообраз пациента
```
young man, the protagonist's own face, but rendered at half the detail
level of every other portrait, as if he cannot picture himself clearly,
eyes are the only fully detailed feature,
```

**ГЛАЗ, СМОТРЯЩИЙ ВНИЗ** — последняя дверь
```
single enormous eye set in a rough textured mass like a moth thorax or
pine cone, deep indigo and violet scales, five asymmetric wings each of a
completely different material: cyan wireframe graph with node points,
purple moth wing with eyespots, cracked olive dry earth, angular sand-colored
geometric shards, striped segmented carapace,
thin ochre curved rays radiating from the center,
tiny floating colored droplet figures at the left edge,
looking down at viewer,
[СТИЛЬ 1.2]
```

*Референс из чата — это он. Подавай картинку как reference image.*

**УБИЙЦА** — единственный, кто действительно ищет
```
man seen through a windshield at dusk, face mostly in shadow,
only the hands on the wheel are fully rendered, headlights blooming,
[СТИЛЬ 1.3]
```

**ДОЛЖНИКИ** — абсурдное обвинение, кусок мяса как бомба
```
group of three men in a doorway, close crowding composition,
one holds a piece of raw meat at chest height with complete seriousness,
the meat is the most detailed object in the frame,
[СТИЛЬ 1.3]
```

**КРИПТО-БРО** — тот, кто кинул, и тот, кто вывел кошелёк
```
young man in expensive-cheap streetwear, station platform behind him,
train departure board with wrong numbers, smiling with full sincerity,
```

**ХУДОЖНИК** — говорит, но слышен только смех
```
charismatic man mid-gesture explaining his work, mouth open,
the mouth is rendered at half resolution compared to the rest of the face,
crowd silhouettes laughing around him,
```

**ТЁТЯ** — та, что может не заметить
```
middle-aged woman sitting, facing three-quarters away, absorbed,
peripheral and unremarkable, rendered slightly softer than everything else
as if the dream did not bother finishing her,
```

### 2.4. Спрайты на карте

```
[СТИЛЬ 1.1]
top-down game character sprite, 32x48, 4-directional,
[ОПИСАНИЕ ПЕРСОНАЖА, сокращённое до силуэта],
strong readable silhouette, minimal internal detail,
2-frame walk cycle, flat top-down perspective
```

Силуэт важнее лица. Каждая фигура узнаётся с одного взгляда, как в Undertale.

---

## 3. КОМНАТЫ

### 3.1. Шаблон тайлсета

```
[СТИЛЬ 1.1]
top-down game tileset, 32x32 tiles, seamless transitions between materials,
[МАТЕРИАЛЫ КОМНАТЫ],
low contrast, muted, background layer readability priority,
floors clearly distinct from walls at a glance
```

⚠️ Для тайлов **убирай `[СТИЛЬ 1.2]`** — правило шва только для объектов и лиц. Тайлсет по этому правилу станет нечитаемым, и игрок перестанет отличать проход от стены. Плотность — там, где смотрят долго. Фон отступает.

### 3.2. Промпты по опорным комнатам

**01. Отель, готический холл**
```
cathedral-scale hotel lobby, endless rows of coat check racks receding into
haze, vaulted stone ceiling, rope hanging from the vault, discarded trousers
on the floor, bone-cream light from above, indigo pooling in lower corners,
scale is wrong, doors are three times too large
```

**02. Школа, кабинет русского**
```
soviet-era classroom, pale green oil paint to waist height, linoleum,
fluorescent tubes with green cast, one desk turned to face the wall,
enormous window along the back wall, a pear tree pressing against the glass
with ripe yellow fruit rendered in warm saturated palette,
the pear tree is the only warm thing in the frame
```

**03. Горы, стартаперы и учёные**
```
mountain slope, wide deep perspective, top of frame bleached to near white,
olive and sand lower half, a small sphere on a thin metal rod standing in
midair over a drop, business cards scattered on snow, surveying tripod
```

**04. Дача Гнедковых**
```
russian country house interior, warm wood, kerosene color temperature,
long shadows, floor hatch to cellar, gas stove, a section of wall that
slides aside, preserve jars on shelves, cozy exactly enough to be worse
```

**05. Шестёрочка**
```
russian discount supermarket interior, flat white overhead light,
checkout lanes, a shelf for abandoned items long enough to lie on,
promotional shelf where price tags are illegible smears,
everything correctly colored except one aisle
```

**06. Канава, гаражи, подворотни**
```
concrete drainage ditch overgrown with weeds, garage rows with peeling paint,
manhole cover, dusk, everything blue-grey, single warm headlight far away,
tight claustrophobic composition, walls pressing from both sides
```

**07. Бассейн и односторонний лифт**
```
swimming pool changing room, wet tile, caustic light patterns rippling on
ceiling, women's underwear and towels hanging on wall hooks,
numberless lockers, elevator doors with only an UP button
```

**08. Квартира, в которой живут другие**
```
familiar apartment layout with wrong colors, wallpaper two shades too pink,
someone else's slippers, a huge paper phallus mounted on the wall as if it
were a normal decoration, window showing a man on a phone outside
```

**09. Хакатон**
```
hackathon venue, rows of tables, power strips, laptops, flat office light,
blue lanyards, many small monitor light sources, a large countdown screen
where the digits do not change
```

**10. Комната с гробами**
```
dim room with two open coffins, single directional shaft of light,
near-monochrome indigo and bone, a crack high on the wall containing small
sealed packets and a cloth printed with codes, museum placard
```

**11. Еврейский город**
```
ordinary small cafe storefront three meters deep, and behind it a full night
city with streets and lit windows, deep indigo with points of warm light,
the city visibly losing rendered detail toward the edges, reducing to outline
```

**12. Тюрьма на овощах**
```
storage room where people sleep on heaps of cabbages and tropical fruit,
soft light, the cabbages rendered with absurd loving detail,
a hole in the fence, snow drifted against it,
[СТИЛЬ 1.3]
```

**13. Подземные залы ЦУ**
```
vast futuristic underground event hall, panel seams, cold light,
grandstand seating, a small couch with someone asleep on it,
empty and too large, resembles a corporate headquarters lobby
```

**14. Поликлиника в Калуге**
```
dental office, medical white with green cast, extracted tooth on a tray,
an open drawer containing two small capybaras and a cat batting at them
with one paw, the capybaras rendered warmer and in more detail than
anything else in the frame, nobody is looking at the drawer
```

**15. Осенний лес с гробом**
```
autumn forest path, ochre and brown, black trunks, low composition with
almost no sky visible, wet leaves, a coffin carried on shoulders
```

**16. Норвежская деревня и погреб**
```
empty norwegian village, sky the color of wet asphalt, fog, desaturated
almost to grey with one lit window, horizontal crushed composition;
and below: a black hole in the earth, tree roots descending the walls
rendered simultaneously as wood and as nervous tissue with visible seam,
ladder missing its lower rungs,
[СТИЛЬ 1.2]
```

**17. Душ, из которого нельзя выйти**
```
shower stall, steam, tile, cramped, a completely ordinary door with a
completely ordinary handle rendered perfectly normally
```

**18. Купол без стен**
```
winter field, a geodesic dome frame with no walls remaining, white emptiness,
animals as small color patches dancing mechanically, barbed wire suspended
in midair in a circle where there are no posts, emptiest composition
```

**19. Двор и оранжевые лавочки**
```
russian residential courtyard, late summer, long shadows, new orange bench
slats, fresh paving, an entrance door, the only room with a nearly normal
palette, shadows falling as if from more than one sun
```

**20. Офис Сбера**
```
corporate office room with computers, one ultrawide monitor and one CRT
monitor running Morrowind, cold fluorescent light, glass partitions
```

**21. Комната Нилюфар**
```
small bedroom with a window and a view, bed, ordinary and calm,
rendered with more care and softer light than any other room in the game
```

**22. Крейсер**
```
warship deck converted for a celebration, tables, a small stage,
sea horizon, grey steel and festive cloth in wrong combination
```

**23. Нигерия, конференция**
```
soviet-built building with columns in west african daylight,
a hotel designed as large but built small, conference hall interior,
people standing in VR headsets, old corridor, figures in an alley
```

**24. Дом, где тебе объясняют, что ты должен**
```
cramped apartment doorway, three men crowding, kitchen behind,
a piece of raw meat on the table lit like an altar object,
[СТИЛЬ 1.3]
```

**25. Метро и поезд, который не тот**
```
metro platform, departure board with impossible destinations,
a crowd waiting, a cardboard box on the floor that a voice is coming from,
tunnel mouth too dark
```

### 3.3. Мета-пространства

Не тайлсеты — **по одной картинке 256×144** на каждое.

**М1. Корни**
```
[СТИЛЬ 1.1] [СТИЛЬ 1.2]
descending shaft lined with tree roots that are simultaneously wood and
nerve tissue, pulsing, converging perspective downward, snow beginning to
flow slowly from above like an avalanche that changed its mind
```

**М2. Мясная геометрия**
```
[СТИЛЬ 1.1] [СТИЛЬ 1.2]
fragments of different rooms floating in cream void, each fragment with a
ragged one-pixel edge, two fragments visibly fusing together at a raw seam,
flesh grafted to architectural blueprint
```

**М3. Склад оставленного**
```
[СТИЛЬ 1.1]
warehouse shelving holding objects left behind, half of them rendered as
finished pixel art and half as untextured grey boxes and flat color blocks,
a progress bar suspended in the air that is not moving
```

**М4. Развилка, где ты остался**
```
[СТИЛЬ 1.1]
a single hand reaching upward, fingers closed around nothing,
cream empty background, no horizon, no floor, the hand rendered at the
highest detail density in the entire game, a ripple spreading upward from
the point the fingers are gripping
```

---

## 4. Батч-скрипт

```python
import os, json, requests

STYLE = ("pixel art, 32px grid aligned, limited palette of 28 colors, "
         "heavy ordered dithering in gradients, clean hard pixel edges, "
         "no anti-aliasing, washed-out bleached lighting, pale bone-cream "
         "background value, palette: deep indigo, violet, teal-cyan, olive, "
         "sand, bone-cream, dried-blood accent, 1998 PlayStation dream "
         "emulator aesthetic, low fidelity but high intention")

SEAM  = ("assembled from incompatible materials, technical wireframe grafted "
         "onto organic tissue, mineral fused with flesh, the seam between "
         "materials is deliberately visible and unhidden")

TONE  = ("mundane banal object rendered with excessive reverence and detail, "
         "deadpan, not spooky, unsettling through inappropriateness")

NEG   = ("anti-aliasing, blur, soft gradients, smooth shading, 3d render, "
         "vector art, cute, chibi, anime eyes, neon cyberpunk, oversaturated, "
         "glowing rim light, watermark, text, symmetrical composition, "
         "centered subject, photorealistic, painterly")

STATES = {
  0: "neutral, occupied with own business, eyes not on viewer, mid-gesture",
  1: "turned toward viewer, listening, one eyebrow raised, mouth slightly open",
  2: "wary, direct eye contact, head tilted back a fraction, jaw set",
  3: ("knows. absolutely calm pleasant face, completely neutral mouth, "
      "eyes locked on viewer and not moving, pupils slightly too small"),
}

def portrait(char_id, desc, state, seed, ref=None):
    p = (f"{STYLE}, portrait bust, three-quarter view, off-center composition, "
         f"looking at viewer, {desc}, {STATES[state]}, {TONE}")
    body = {"prompt": p, "negative_prompt": NEG, "width": 128, "height": 128,
            "seed": seed, "palette": open("palette.hex").read().split(),
            "model": "rd-pro", "num_outputs": 4 if state == 0 else 1}
    if ref: body["reference_image"] = ref     # ← ключ к консистентности
    r = requests.post(API, json=body, headers=HDR).json()
    return r["output"]

# Пайплайн: S0 → выбираешь руками → он становится референсом для S1..S3
for cid, desc in characters.items():
    seed = stable_seed(cid)
    variants = portrait(cid, desc, 0, seed)
    chosen = curate(variants)               # человек в петле, не пропускать
    for s in (1, 2, 3):
        portrait(cid, desc, s, seed, ref=chosen)
```

Шаг `curate()` — не бюрократия. Человек, тыкающий в лучший из четырёх, и есть замена паинтоверу.

---

## 5. Приёмка: когда перегенерировать

Брак, если:

- **Композиция по центру и симметрична.** Мгновенно выдаёт генерацию
- **Пиксели не по сетке** — рябь, полупиксели, замыленный край
- **Цвет вне палитры.** Проверять скриптом, не глазом
- **S3 читается как злодей.** Он вежливый и не моргает. Не злой
- **Шов замаскирован.** Материалы должны сталкиваться, а не перетекать
- **Тайл красивее, чем нужно.** Фон обязан отступать. Если разглядываешь пол — брак
- **Ассет «страшный».** Тон плоский. Не страшное — неуместное
- **Четыре состояния — четыре разных лица.** Значит, референс не подцепился

## 6. Порядок работы

1. Палитра `.hex`, 28 цветов. **До всего остального.**
2. **Один персонаж, четыре состояния.** Пока S3 не читается как «поняла и говорит про погоду» — дальше не идти. Это тест всей игры ценой одного портрета.
3. Тайлсет одной комнаты. Проверить читаемость в движении, не на скриншоте.
4. Остальные 13 персонажей.
5. Комнаты по мере того, как их подключают в код.
6. Мета-пространства последними — они дороже всех и без игры бессмысленны.
