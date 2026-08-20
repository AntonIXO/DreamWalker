/**
 * The player.
 *
 * §8: one server, one dream. This app fetches exactly one artifact from /dream/ and
 * plays it. It generates nothing — the world was authored by a person with the `lord`
 * CLI. The only thing that changes it at runtime is the heartbeat, and everything the
 * heartbeat does goes through `game/patch.ts`.
 */

import "pixi.js/prepare";
import {
  Application,
  Container,
  CullerPlugin,
  extensions,
  type Texture,
} from "pixi.js";

import { validateDreamArtifact, type DreamArtifact } from "../shared/dream";
import { sonPack } from "../../dreams/son/pack";
import { LOCK_STARTED_AT } from "../../dreams/son/meta";
import {
  loadAtlas,
  loadExternalTextures,
  loadOptionalTexture,
} from "./render/atlasTextures";
import { Camera, DEFAULT_CAMERA, FOLLOW_VIEW_TILES } from "./render/camera";
import { DebugOverlay } from "./render/debugOverlay";
import { DreamFx } from "./render/dreamFx";
import { RoomScene } from "./render/roomScene";
import { Shiver } from "./render/shiver";
import { ActorLayer, WalkerSprite } from "./render/walkerView";
import { Cycle, Journal } from "./game/cycle";
import { WordNotebook } from "./game/wordNotebook";
import { Action, Input } from "./game/input";
import { updateFigures } from "./game/figures";
import {
  applyPatch,
  applyPopulationAssignments,
  applyPopulationRetargets,
  installPopulation,
} from "./game/patch";
import { playerTile, walkFrame } from "./game/player";
import { DreamSession } from "./game/session";
import { createWorld, currentRoom, resetWorld, visitCount } from "./game/world";
import { computePressure, type DreamPressure } from "./game/pressure";
import { MEMORY_EXHAUSTION } from "./game/exhaustion";
import { addExhaustion } from "./game/world";
import { learnLeverage, leverageOn } from "./game/fates";
import { Heartbeat } from "./mind/heartbeat";
import { ObservationLog } from "./mind/observation";
import { createMind, forgetCycle } from "./mind";
import { inhabitDream } from "./mind/remote";
import { fallbackPopulation } from "../shared/population";
import { clueIdForShard } from "../shared/yield";
import { MindMemory } from "./mind/memory";
import { loadMindSettings } from "./mind/settings";
import { LobbySession } from "./lobby/session";
import { EnterTransition } from "./lobby/transition";
import { ConnectPanel } from "./ui/connect";
import { ControlsPanel } from "./ui/controls";
import { DialoguePanel } from "./ui/dialogue";
import { Hud } from "./ui/hud";
import { FinalePanel } from "./ui/finale";
import { MemoryPanel } from "./ui/memories";
import { JournalPanel } from "./ui/journal";
import { ModelThinkingIndicator } from "./ui/modelThinking";

import { WordNotebookPanel } from "./ui/wordNotebook";
import { ClueInspectPanel } from "./ui/clueInspect";
import { VerbRing } from "./ui/verbRing";

type AppPhase = "lobby" | "enteringDream" | "dream";

const DREAM_URL = "/dream";

extensions.add(CullerPlugin);

function showBootError(title: string, detail: string): void {
  const node = document.getElementById("boot-error");
  if (!node) return;
  node.hidden = false;
  const heading = document.createElement("h1");
  heading.textContent = title;
  const body = document.createElement("p");
  body.innerHTML = detail;
  node.replaceChildren(heading, body);
}

function loadArtifact(): DreamArtifact {
  return validateDreamArtifact(sonPack.artifact());
}

async function boot(): Promise<void> {
  const artifact = loadArtifact();
  const atlas = await loadAtlas(DREAM_URL);
  // Cut-out originals: same pixels as the PNG, background already punched.
  const figureArt: Array<{ id: string; url: string }> = [
    {
      id: "glaz",
      url: new URL("../../assets/figures/glaz.png", import.meta.url).href,
    },
    {
      id: "kripto-bro",
      url: new URL("../../assets/figures/autofag.png", import.meta.url).href,
    },
  ];
  const figureTextures = new Map<string, Texture>();
  const figurePortraitUrls = new Map<string, string>();
  await Promise.all(
    figureArt.map(async ({ id, url }) => {
      const texture = await loadOptionalTexture(url, `figure-${id}`);
      if (!texture) return;
      figureTextures.set(id, texture);
      figurePortraitUrls.set(id, url);
    }),
  );
  const clueTextures = await loadExternalTextures(
    DREAM_URL,
    artifact.content.clues.flatMap((clue) =>
      clue.worldImage ? [{ id: clue.id, path: clue.worldImage }] : [],
    ),
  );
  const backdropTextures = await loadExternalTextures(
    DREAM_URL,
    artifact.rooms.flatMap((room) =>
      room.graphics.backdropImage
        ? [{ id: room.id, path: room.graphics.backdropImage }]
        : [],
    ),
  );

  // Object art, keyed the way RoomScene asks for it. `strategy: "skip"` means a room
  // whose objects have not been drawn yet still loads — most of them have not.
  const objectTextures = await loadExternalTextures(
    DREAM_URL,
    artifact.rooms.flatMap((room) =>
      room.props.flatMap((prop) =>
        prop.image ? [{ id: `${room.id}:${prop.id}`, path: prop.image }] : [],
      ),
    ),
  );

  const world = createWorld(artifact);
  const background =
    artifact.palette.colors[artifact.palette.roles.background] ?? "#000000";

  const pixiHost = document.getElementById("pixi-container")!;
  const app = new Application();
  await app.init({
    background,
    resizeTo: pixiHost,
    // Integer backing-store scale only. 1.25× / 1.5× dpr shimmers 16px tiles.
    resolution: Math.max(1, Math.round(window.devicePixelRatio || 1)),
    autoDensity: true,
    antialias: false,
    roundPixels: true,
    preference: ["webgl", "canvas"],
    powerPreference: "high-performance",
    eventMode: "none",
    eventFeatures: {
      move: false,
      globalMove: false,
      click: false,
      wheel: false,
    },
    culler: { updateTransform: true },
  });
  pixiHost.appendChild(app.canvas);
  app.resize();
  document.title = `${artifact.title} — Dream Walker`;

  const uiLayer = document.getElementById("ui-layer")!;

  // One camera root, two scenes. The lobby and the dream share the Application;
  // only one of them is visible.
  const cameraRoot = new Container({
    label: "camera-root",
    isRenderGroup: true,
    eventMode: "none",
    interactiveChildren: false,
  });
  app.stage.addChild(cameraRoot);

  // Everything the dream camera moves lives under here; UI does not. One render
  // group so the zoom/pan is applied on the GPU instead of per tile sprite.
  const worldRoot = new Container({
    label: "world",
    isRenderGroup: true,
    eventMode: "none",
    interactiveChildren: false,
    visible: false,
  });
  cameraRoot.addChild(worldRoot);

  // One room is drawn at a time. There is no mask and no clip: a room is its own
  // container at its own origin, so its neighbours are not merely hidden, they are not
  // in the scene at all.
  const rooms = new RoomScene(
    artifact,
    atlas,
    backdropTextures,
    objectTextures,
  );
  worldRoot.addChild(rooms.root);
  // A meta-space's picture has no edges and must not move with the camera.
  app.stage.addChild(rooms.overlay);

  const actors = new ActorLayer(atlas, clueTextures, figureTextures);
  worldRoot.addChild(actors.root);

  const playerSprite = new WalkerSprite(atlas, "player");
  actors.add(playerSprite);

  const tileSize = artifact.rooms[0]?.tileSize ?? 16;
  const camera = new Camera(
    cameraRoot,
    tileSize,
    app.screen.width,
    app.screen.height,
    DEFAULT_CAMERA,
  );
  const shiver = new Shiver(camera);
  const dreamFx = new DreamFx(
    app.stage,
    app.screen.width,
    app.screen.height,
    artifact.palette,
  );
  shiver.onTrigger = (intensity) => dreamFx.burst(intensity);
  const transition = new EnterTransition(uiLayer);

  const cycle = new Cycle(artifact);
  const journal = new Journal(artifact.slug);
  const wordNotebook = new WordNotebook(artifact.slug);
  const mindMemory = new MindMemory(artifact.slug);
  const hud = new Hud(uiLayer);
  hud.setLobbyMode(true);
  const observations = new ObservationLog();
  world.exhaustion = mindMemory.exhaustion;

  /**
   * Walking, doors, links and meta-spaces.
   *
   * Everything that used to be inline in this ticker as a warp block lives here now,
   * because there are four ways out of a room instead of one.
   */
  const session = new DreamSession(
    world,
    rooms,
    camera,
    shiver,
    {
      onEnterRoom: (room, visits) => {
        world.visited.add(room.id);
        const mood = world.population?.roomMoods[room.id];
        // The second visit is the one that is worse, so that is when the room says so.
        const line =
          visits > 1 && room.revisit.escalates && room.revisit.note
            ? room.revisit.note
            : (mood ?? room.atmosphere);
        if (line) hud.whisper(line, 4);
      },
      onRefused: (doorId) => observations.noteRefusal(doorId),
      whisper: (text) => hud.whisper(text, 4),
      cycleNumber: () => cycle.number,
      knownClueIds: () => wordNotebook.observedIds,
    },
    transition,
    sonPack.scripts,
  );

  const figuresHere = (): typeof world.figures =>
    world.figures.filter(
      (figure) =>
        rooms.shown.has(figure.roomId) || figure.roomId === world.currentRoomId,
    );
  const interestsHere = (): typeof world.interests =>
    world.interests.filter(
      (interest) =>
        rooms.shown.has(interest.roomId) ||
        interest.roomId === world.currentRoomId,
    );

  const thinking = new ModelThinkingIndicator(uiLayer);
  const mindSettings = await loadMindSettings();
  const mind = createMind(
    world,
    {
      cycleNumber: () => cycle.number,
      journal: () => journal.all().map((entry) => entry.text),
    },
    mindMemory,
  );
  const heartbeat = new Heartbeat(
    world,
    mind,
    observations,
    artifact.heartbeat,
    // §6's guarantee, as a question the heartbeat asks rather than a shape the camera
    // enforced: the sleeper may rearrange anything the sanitar is not looking at. Both
    // halves matter once a floor is larger than the screen — the room alone would put
    // most of the dream off limits.
    () => ({ roomId: world.currentRoomId, rect: camera.visibleTiles() }),
  );

  const pressureNow = (): DreamPressure =>
    computePressure({
      figures: world.figures,
      cycleNumber: cycle.number,
      maxCycles: artifact.cycle.maxCycles,
      beats: observations.snapshot(world).beatsThisCycle,
      visitsHere: visitCount(world, world.currentRoomId),
    });

  const noteShard = (shardId: string): void => {
    mindMemory.learnShard(shardId);
    observations.noteLearned(shardId);
    const shard = artifact.shards.find((candidate) => candidate.id === shardId);
    if (shard) journal.add(cycle.number, shard.hint);
    const clueId = clueIdForShard(shardId);
    if (clueId && artifact.content.clues.some((clue) => clue.id === clueId)) {
      wordNotebook.observe(clueId);
    }
  };

  const dialogue = new DialoguePanel(
    uiLayer,
    mind,
    thinking,
    artifact,
    atlas,
    {
      onOpen: (figure) => {
        input.setCaptured(true);
        observations.noteApproach(figure.id);
        const roomName =
          world.roomById.get(figure.roomId)?.name ?? "неизвестное место";
        journal.addPerson(
          cycle.number,
          figure.id,
          figure.name,
          `${figure.activity}. Встречен: ${roomName}.`,
        );
      },
      onClose: () => input.setCaptured(false),
      onTell: (figure, quoted) => {
        // §3: a tell is only useful if the player can go back and see what caused it.
        journal.addPerson(
          cycle.number,
          figure.id,
          figure.name,
          `Заметил чужого по словам «${quoted}».`,
          "tell",
        );
      },
      onKnows: (figure) => {
        // The picture agreeing with the face. This used to fire on the тонус counter
        // wrapping — arithmetic nobody could see; now it fires when somebody has you.
        shiver.trigger(1);
        dreamFx.surge();
        journal.addPerson(
          cycle.number,
          figure.id,
          figure.name,
          "Понял и молчит.",
          "tell",
        );
      },
      onShard: noteShard,
      onMemorySpent: () => {
        addExhaustion(world, MEMORY_EXHAUSTION);
        mindMemory.setExhaustion(world.exhaustion);
        session.noteMemorySpent();
        journal.add(cycle.number, "Ты оставил в этом сне часть себя.");
        // «Пустота» — nothing left to spend, so the sanitar stays. Not dead; stuck.
        if (mindMemory.availableMemories().length === 0) {
          input.setCaptured(true);
          finale.openVoid();
        }
      },
      onJournal: (figure, text) => {
        journal.addPerson(cycle.number, figure.id, figure.name, text);
      },
      leverageOn: (figureId) => leverageOn(world, figureId),
      onLeverage: (aboutFigureId, leverageId) => {
        if (!learnLeverage(world, aboutFigureId, leverageId)) return;
        const about = world.figures.find((f) => f.id === aboutFigureId);
        journal.addPerson(
          cycle.number,
          aboutFigureId,
          about?.name ?? aboutFigureId,
          "Про него сказали лишнее.",
          "tell",
        );
        hud.whisper("Ты теперь знаешь про него то, чего знать не должен.", 5);
      },
      onPressed: (figure, outcome) => {
        applyPatch(
          world,
          {
            kind: "markFigure",
            figureId: figure.id,
            fate: outcome,
            quoted: null,
            reason: "sanitar:press",
          },
          cycle.number,
        );
        observations.noteFate(figure.id, "press");
        journal.addPerson(
          cycle.number,
          figure.id,
          figure.name,
          outcome === "broken"
            ? "Замолчал насовсем."
            : "Отдал и говорит иначе.",
          "tell",
        );
      },
      onResonance: (declaration) => {
        dialogue.close();
        finale.openResonance(declaration);
      },
      exhaustion: () => world.exhaustion,
    },
    figurePortraitUrls,
  );

  const verbRing = new VerbRing(uiLayer, {
    onClose: () => input.setCaptured(false),
    onPick: (figure, verb) => {
      if (verb === "talk" || verb === "press") {
        dialogue.open(figure, verb === "press");
        return;
      }
      const result = applyPatch(
        world,
        {
          kind: "markFigure",
          figureId: figure.id,
          fate: verb === "kill" ? "dead" : "led",
          // A kill has no words. The Eye quoting nothing back is stronger than a line.
          quoted: null,
          reason: `sanitar:${verb}`,
        },
        cycle.number,
      );
      if (!result.ok) return;
      observations.noteFate(figure.id, verb);
      if (verb === "kill") {
        shiver.trigger(1);
        dreamFx.surge();
        hud.whisper("Он больше не там, где был.", 5);
        journal.addPerson(
          cycle.number,
          figure.id,
          figure.name,
          "Его больше нет.",
          "tell",
        );
      } else {
        hud.whisper(`${figure.name} идёт за тобой.`, 4);
        journal.addPerson(cycle.number, figure.id, figure.name, "Идёт следом.");
      }
      // Kill and lead change who is standing here, not the walls. Invalidating the
      // room destroyed the painting and left a black hole until you walked away
      // and back.
    },
  });

  const debug = new DebugOverlay(
    uiLayer,
    world,
    heartbeat,
    pressureNow,
    () => dreamFx.debugState,
    () => camera.visibleTiles(),
  );
  const input = new Input();
  input.attach();
  const journalPanel = new JournalPanel(uiLayer, journal, {
    onClose: () => input.setCaptured(false),
  });
  const wordNotebookPanel = new WordNotebookPanel(uiLayer, wordNotebook, () =>
    input.setCaptured(false),
  );
  const clueInspect = new ClueInspectPanel(uiLayer, () =>
    input.setCaptured(false),
  );

  const finale = new FinalePanel(
    uiLayer,
    mind,
    thinking,
    artifact,
    wordNotebook,
    {
      onOpen: () => input.setCaptured(true),
      onClose: () => input.setCaptured(false),
      whatWasPaid: () => {
        const memories = mindMemory.spentMemoryTexts().map((text) => text);
        const fates = world.fateHistory.map((record) => {
          const name =
            world.baseFigures.find((f) => f.id === record.figureId)?.name ??
            record.figureId;
          const what =
            record.fate === "dead"
              ? "убит"
              : record.fate === "broken"
                ? "замолчал"
                : record.fate === "gone"
                  ? "уведён"
                  : record.fate === "leveraged"
                    ? "сломан"
                    : "";
          return what ? `${name} — ${what}, цикл ${record.cycle}.` : "";
        });
        return [...memories, ...fates].filter(Boolean);
      },
      onEnded: (kind) => {
        input.setCaptured(true);
        journal.add(
          cycle.number,
          kind === "match"
            ? "Ты назвал тайну сна."
            : kind === "empty"
              ? "Фраза была верна. Кошелёк был пуст."
              : kind === "unfinished"
                ? "Он проснулся раньше, чем ты собрал фразу."
                : kind === "void"
                  ? "Отдавать больше нечего."
                  : kind === "walk-away"
                    ? "Ты ушёл, не забрав тайну."
                    : kind === "locked"
                      ? "Фраза была верна. Замок ещё считает вверх."
                      : "Фигура назвала тебя чужим.",
        );
      },
    },
  );

  let phase: AppPhase = "lobby";
  let pendingEntry: "live" | "training" | null = null;
  let populationInstalled = false;
  let populationLoading = false;

  const releaseLobbyPanel = (): void => {
    if (phase === "lobby") lobby.panelClosed();
    input.setCaptured(false);
  };

  const controls = new ControlsPanel(uiLayer, {
    onClose: releaseLobbyPanel,
  });
  const connect = new ConnectPanel(uiLayer, {
    onChange: (settings) => lobby.setMind(settings),
    onClose: releaseLobbyPanel,
  });

  const enterDream = async (mode: "live" | "training"): Promise<void> => {
    if (phase !== "lobby" || populationLoading) return;
    populationLoading = true;
    phase = "enteringDream";
    input.setCaptured(true);
    try {
      const deal =
        mode === "live" && !populationInstalled
          ? inhabitDream(artifact.slug, artifact)
          : Promise.resolve(fallbackPopulation(artifact, { shuffle: true }));
      if (mode === "live" && !populationInstalled) {
        hud.whisper("Сон вспоминает, кто здесь живёт…", 10);
      }
      await transition.play();
      if (!populationInstalled) {
        const population = await thinking.run(
          "Населяет сон персонажами и деталями",
          () => deal,
        );
        installPopulation(world, population);
        if (population.source === "fallback") {
          hud.whisper("Сон отвечает сам, без модели.", 6);
        }
        for (const room of world.rooms) rooms.invalidate(room.id);
        session.enterRoomImmediate();
        session.noteCycleReset();
        actors.syncFigures(figuresHere(), tileSize, world, camera.zoom);
        actors.syncInterests(interestsHere(), tileSize, world);
        populationInstalled = true;
      }
      controls.close();
      connect.close();
      memories.close();
      journalPanel.close();
      wordNotebookPanel.close();
      clueInspect.close();
      lobby.teardown();
      worldRoot.visible = true;
      session.enterRoomImmediate();
      hud.setLobbyMode(false);
      phase = "dream";
      input.setCaptured(false);
    } catch (error) {
      console.error("[population]", error);
      phase = "lobby";
      hud.whisper("Сон не смог вспомнить всех. Попробуй ещё раз.", 6);
      input.setCaptured(false);
      lobby.panelClosed();
    } finally {
      populationLoading = false;
    }
  };

  const requestEntry = (mode: "live" | "training"): void => {
    if (!mindMemory.hasInitialMemories) {
      pendingEntry = mode;
      input.setCaptured(true);
      memories.open();
      return;
    }
    void enterDream(mode);
  };

  const lobby = new LobbySession(uiLayer, artifact, atlas, camera, {
    onTerminal: () => {
      input.setCaptured(true);
      connect.open();
    },
    onControls: () => {
      input.setCaptured(true);
      controls.open();
    },
    onEnterDream: requestEntry,
  });
  cameraRoot.addChild(lobby.scene.root);
  // Deliberately not awaited. `prepare.upload` resolves on a ticker tick, and a
  // backgrounded tab has no `requestAnimationFrame` — so awaiting it means the game
  // never finishes booting until the tab is looked at, and `window.dreamWalker` is
  // never exposed. Pre-uploading textures is an optimisation; boot is not.
  void (app.renderer as { prepare?: { upload?: (target: unknown) => Promise<unknown> } }).prepare?.upload?.(lobby.scene.root);
  lobby.setMind(mindSettings);

  /**
   * Window size changed: the integer zoom that fitted the old window may now crop a
   * room or leave it as a postage stamp. Re-fit the current space and snap so the
   * view does not sit against one edge.
   */
  const layoutView = (): void => {
    camera.resize(app.screen.width, app.screen.height);
    dreamFx.resize(app.screen.width, app.screen.height);
    if (phase === "lobby" || phase === "enteringDream") {
      camera.setWorldSize(lobby.definition.width, lobby.definition.height);
      camera.fit(lobby.definition.width, lobby.definition.height);
      camera.cutTo(lobby.walker.x, lobby.walker.y);
      return;
    }
    const room = currentRoom(world);
    camera.setWorldSize(room.width, room.height);
    if (room.camera === "follow") {
      camera.fit(FOLLOW_VIEW_TILES.w, FOLLOW_VIEW_TILES.h);
    } else {
      camera.fit(room.width, room.height);
    }
    camera.cutTo(session.player.x, session.player.y);
    rooms.resizeOverlay(app.screen.width, app.screen.height);
  };
  layoutView();
  app.renderer.on("resize", layoutView);

  const memories = new MemoryPanel(uiLayer, mindMemory, {
    onReady: () => void enterDream(pendingEntry ?? "live"),
    onClose: (wasOnboarding) => {
      if (wasOnboarding && phase === "lobby") releaseLobbyPanel();
      else input.setCaptured(false);
    },
    onTimeBought: (memoryText) => {
      cycle.extend(120_000);
      addExhaustion(world, MEMORY_EXHAUSTION);
      mindMemory.setExhaustion(world.exhaustion);
      session.noteMemorySpent();
      journal.add(
        cycle.number,
        `Ты сжёг воспоминание «${memoryText}», чтобы удержать сон.`,
      );
    },
  });

  heartbeat.onBeat((outcome) => {
    // Only geometry needs a rebuild. `show()` here used to hide the rest of the
    // street and leave a black square until you left and came back.
    let geometry = false;
    for (const entry of outcome.entries) {
      if (!entry.result.ok) continue;
      if (
        entry.patch.kind !== "shiftWalls" &&
        entry.patch.kind !== "sealDoor" &&
        entry.patch.kind !== "openDoor" &&
        entry.patch.kind !== "retypeDoor"
      ) {
        continue;
      }
      geometry = true;
      for (const roomId of entry.result.affectedRooms) rooms.invalidate(roomId);
    }
    if (geometry) session.enterRoomImmediate();
    shiver.trigger(Math.min(1, outcome.affectedRooms.length / 2));
    for (const note of outcome.notes) journal.add(cycle.number, note);
    if (outcome.notes.length > 0) hud.whisper(outcome.notes[0]!);
  });

  /**
   * §5 — the dream starts again and the figures forget; the journal does not.
   *
   * Everything is restored in place from the artifact rather than rebuilt, so the
   * tilemap, the mind, the heartbeat and the debug overlay all keep pointing at the same
   * world they were given at boot. Restoring beats undoing: the artifact never changed,
   * so there is no patch history to walk backwards.
   */
  let restarting = false;
  const restartCycle = async (): Promise<void> => {
    if (restarting) return;
    restarting = true;
    try {
      // The outgoing cycle is evidence; its plan belongs to the freshly reset next one.
      const plan = await thinking.run("Перестраивает следующий цикл сна", () =>
        heartbeat.planCycleExit(),
      );
      resetWorld(world, cycle.number);
      // The places are re-laid over the restored rooms before the exit plan lands, so
      // the sleeper's patches apply to the arrangement the player is about to walk into
      // rather than to the one they just left.
      applyPopulationAssignments(world);
      applyPopulationRetargets(world);
      heartbeat.applyCyclePlan(plan);
      observations.reset();
      heartbeat.resetCycle();
      forgetCycle(mind);
      for (const room of world.rooms) rooms.invalidate(room.id);
      session.restart();
      session.noteCycleReset();

      // `endings.md` sets four cycles before the sanitar is thrown out with whatever
      // they have. The gaps in the phrase persist into the next run.
      const maxCycles = artifact.cycle.maxCycles;
      if (maxCycles !== null && cycle.number > maxCycles) {
        input.setCaptured(true);
        finale.openFailed(wordNotebook.words);
        return;
      }
      cycle.restart();
      hud.whisper("Сон начинается заново. Ты помнишь.", 5);
    } finally {
      restarting = false;
    }
  };

  // A handle on the running dream, worth having in a game that is meant to be
  // self-hosted and picked apart.
  (window as unknown as { dreamWalker: unknown }).dreamWalker = {
    app,
    world,
    heartbeat,
    observations,
    input,
    camera,
    cycle,
    journal,
    wordNotebook,
    mind,
    mindMemory,
    thinking,
    dialogue,
    finale,
    rooms,
    session,
    atlas,
    lobby,
    dreamFx,
    get pressure(): DreamPressure {
      return pressureNow();
    },
    get phase(): AppPhase {
      return phase;
    },
    restartCycle,
    get player(): typeof session.player {
      return session.player;
    },
  };

  let prompt: string | null = null;
  app.ticker.add((ticker) => {
    const delta = Math.min(ticker.deltaMS, 100) / 1000;

    // The cycle must not burn in the procedure room. Heartbeat and inhabit wait
    // until the sanitar actually lies down next to the patient.
    if (phase === "lobby" || phase === "enteringDream") {
      const panelOpen =
        connect.isOpen ||
        controls.isOpen ||
        memories.isOpen ||
        lobby.inspectOpen;
      if (input.consume(Action.DEBUG)) debug.toggle();
      if (input.consume(Action.HELP) && !connect.isOpen && !memories.isOpen) {
        if (controls.isOpen) controls.close();
        else controls.open();
      }
      if (input.consume(Action.CANCEL) && panelOpen) {
        connect.close();
        controls.close();
        memories.close();
        lobby.closeInspect();
      }
      if (phase === "lobby") lobby.update(input, delta, panelOpen);
      else camera.update(delta);
      dreamFx.setEnabled(false);
      const heldNow =
        connect.isOpen ||
        controls.isOpen ||
        memories.isOpen ||
        lobby.inspectOpen;
      input.setCaptured(heldNow || phase === "enteringDream");
      input.endFrame();
      return;
    }

    // Anything that has taken over the screen also takes the sanitar's feet. Reading the
    // controls should not walk you into a wall.
    const held =
      dialogue.isOpen ||
      controls.isOpen ||
      memories.isOpen ||
      journalPanel.isOpen ||
      wordNotebookPanel.isOpen ||
      clueInspect.isOpen ||
      verbRing.isOpen ||
      finale.isOpen;
    // Pixi's ticker and renderer stay alive. Only the game clock is paused while network
    // latency, a cycle transition, or the finale owns the simulation.
    const simulationPaused = mind.waiting || restarting || finale.isOpen;
    hud.setMuted(held);

    if (!held && !simulationPaused) {
      session.update(input.axis(), delta);
    }

    const room = currentRoom(world);
    if (!simulationPaused) observations.tick(delta, room.id);
    if (!simulationPaused) {
      updateFigures(
        world,
        cycle.progress,
        delta,
        dialogue.currentFigureId,
        world.currentRoomId,
        {
          x: session.player.x / room.tileSize,
          y: session.player.y / room.tileSize,
        },
      );
    }

    // A street map is one country: follow the walker. A single-room dream still
    // frames the authored scene.
    if (room.camera === "follow") {
      camera.follow(session.player.x, session.player.y, delta);
    } else {
      camera.frame(room);
    }

    // --- one-shot actions
    if (input.consume(Action.DEBUG)) debug.toggle();
    if (input.consume(Action.HELP)) controls.toggle();
    if (input.consume(Action.MEMORIES)) {
      if (memories.isOpen) memories.close();
      else {
        input.setCaptured(true);
        memories.open();
      }
    }
    if (input.consume(Action.JOURNAL)) {
      if (journalPanel.isOpen) journalPanel.close();
      else {
        input.setCaptured(true);
        journalPanel.open();
      }
    }
    if (input.consume(Action.WORDS)) {
      if (wordNotebookPanel.isOpen) wordNotebookPanel.close();
      else {
        input.setCaptured(true);
        wordNotebookPanel.open();
      }
    }

    // Escape peels one layer at a time, outermost first, so it never closes a
    // conversation the player only meant to look away from.
    if (input.consume(Action.CANCEL)) {
      if (controls.isOpen) controls.close();
      else if (memories.isOpen) memories.close();
      else if (journalPanel.isOpen) journalPanel.close();
      else if (wordNotebookPanel.isOpen) wordNotebookPanel.close();
      else if (clueInspect.isOpen) clueInspect.close();
      else if (verbRing.isOpen) verbRing.close();
      else if (finale.isOpen && !finale.isTrapped) finale.close();
      else if (dialogue.cancelListening()) {
        // They only meant to stop talking, not to walk away.
      } else dialogue.close();
    }

    if (input.consume(Action.HEARTBEAT)) {
      void thinking.run("Перестраивает сон", () => heartbeat.force());
    }

    if (input.consume(Action.GRANT)) {
      // Debug convenience: hand over every key so locked doors can be walked through
      // while testing the map, without pretending the game has an inventory yet.
      for (const [id, door] of world.doorById) {
        if (door.keyId) world.keysHeld.add(door.keyId);
        if (door.type === "leverLock") world.leversPulled.add(id);
        if (door.type === "puzzleLock") world.puzzlesSolved.add(id);
      }
      hud.whisper("Двери больше не спорят. (отладка)");
    }

    const target = held || simulationPaused ? null : session.target();
    const atFinale = room.id === artifact.finaleRoomId;
    prompt = target?.prompt ?? (atFinale ? "сердце сна — назвать тайну" : null);

    if (
      !simulationPaused &&
      input.consume(Action.VERBS) &&
      target?.kind === "figure"
    ) {
      input.setCaptured(true);
      verbRing.open(target.figure, target.verbs);
    }

    if (!simulationPaused && input.consume(Action.INTERACT)) {
      if (target?.kind === "figure") {
        if (!session.mayTalk(target.figure.id)) {
          hud.whisper("Ну ладно.", 2);
        } else {
          dialogue.open(target.figure);
        }
      } else if (target?.kind === "hotspot") {
        const hotspot = target.hotspot;
        if (session.use(hotspot)) {
          // A pack script handled the thing.
        } else if (hotspot.refusal) {
          // An authored refusal is the answer — «достать её нельзя, это проверено».
          hud.whisper(hotspot.refusal, 4);
        } else {
          void thinking
            .run("Рассматривает деталь мира", () =>
              mind.examine({
                x: hotspot.x,
                y: hotspot.y,
                roomId: room.id,
                interestId: hotspot.id.startsWith("interest:")
                  ? hotspot.id.slice("interest:".length)
                  : null,
                hotspotId: hotspot.id.startsWith("interest:")
                  ? null
                  : hotspot.id,
              }),
            )
            .then((result) => {
              if (result.clueObservedId) {
                const clue = artifact.content.clues.find(
                  (candidate) => candidate.id === result.clueObservedId,
                );
                if (clue) {
                  wordNotebook.observe(clue.id);
                  journal.add(
                    cycle.number,
                    `УЛИКА — осмотрен предмет-ребус ${wordNotebook.observedCount}/6.`,
                  );
                  input.setCaptured(true);
                  clueInspect.open(clue, result.reply);
                }
              } else {
                hud.whisper(`ЗАПИСЬ — ${result.reply}`, 5);
              }
              if (result.yieldedShardId) noteShard(result.yieldedShardId);
            });
        }
      } else if (target) {
        hud.whisper(target.prompt, 3);
      } else if (atFinale) {
        finale.open();
      }
    }

    // --- time
    if (!simulationPaused && cycle.update(delta)) void restartCycle();
    shiver.update(delta);
    camera.update(delta);
    dreamFx.setEnabled(true);
    dreamFx.setPreset(room.graphics.glitchPreset);
    dreamFx.setPressure(pressureNow());
    dreamFx.update(delta);

    // --- draw
    const walker = session.player;
    playerSprite.update(walker.x, walker.y, walker.facing, walkFrame(walker));
    actors.syncFigures(figuresHere(), room.tileSize, world, camera.zoom);
    actors.syncInterests(interestsHere(), room.tileSize, world);

    if (room.id === "m11-zamok-po-vremeni") {
      const elapsed = Math.max(0, Date.now() - Date.parse(LOCK_STARTED_AT));
      const days = Math.floor(elapsed / 86_400_000);
      const hours = Math.floor((elapsed % 86_400_000) / 3_600_000);
      hud.setAside(`закрыто ${days}д ${String(hours).padStart(2, "0")}ч`);
    } else {
      hud.setAside(null);
    }
    hud.update(
      {
        title: artifact.title,
        roomName: room.name,
        cycleNumber: cycle.number,
        remainingSeconds: cycle.remainingSeconds,
        journalCount: journal.size,
        whisper: prompt,
      },
      delta,
    );
    const tile = playerTile(walker, room);
    debug.update(tile.x, tile.y);

    input.endFrame();
  });
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  showBootError("The dream did not open", message);
});
