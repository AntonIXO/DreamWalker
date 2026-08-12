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
  Assets,
  Container,
  CullerPlugin,
  Graphics,
  extensions,
  type Texture,
} from "pixi.js";

import { validateDreamArtifact, type DreamArtifact } from "../shared/dream";
import { REQUIRED_TILE_ROLES, TILE_ROLE } from "../shared/tilecodes";
import { loadAtlas, loadExternalTextures } from "./render/atlasTextures";
import { ChamberBackdropLayer } from "./render/chamberBackdrops";
import { TileFoundry } from "./render/foundry";
import {
  Camera,
  DEFAULT_CAMERA,
  OUTDOOR_VIEW_TILES,
  outdoorHeight,
} from "./render/camera";
import { DebugOverlay } from "./render/debugOverlay";
import { Shiver } from "./render/shiver";
import { TilemapView } from "./render/tilemap";
import { ActorLayer, WalkerSprite } from "./render/walkerView";
import { Cycle, Journal } from "./game/cycle";
import { WordNotebook } from "./game/wordNotebook";
import { Action, Input } from "./game/input";
import { findTarget } from "./game/interact";
import { updateFigures } from "./game/figures";
import { installPopulation } from "./game/patch";
import {
  createPlayer,
  playerTile,
  updatePlayer,
  walkFrame,
} from "./game/player";
import {
  createWorld,
  resetWorld,
  roomAt,
  tileAt,
  warpAtTile,
  type WorldState,
} from "./game/world";
import { Heartbeat } from "./mind/heartbeat";
import { ObservationLog } from "./mind/observation";
import { createMind, forgetCycle } from "./mind";
import { inhabitDream } from "./mind/remote";
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

type AppPhase = "lobby" | "enteringDream" | "dream";

const DREAM_URL = "/dream";

extensions.add(CullerPlugin);

/** Every atlas role the tiles in these regions actually call for, after a patch. */
function rolesIn(world: WorldState, roomIds: Iterable<string>): Set<string> {
  const roles = new Set<string>();
  for (const id of roomIds) {
    const room = world.roomById.get(id);
    if (!room) continue;
    for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
      for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
        const role = TILE_ROLE[tileAt(world, x, y)];
        if (role && role !== "void") roles.add(role);
      }
    }
  }
  return roles;
}

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

async function loadArtifact(): Promise<DreamArtifact> {
  const response = await fetch(`${DREAM_URL}/dream.json`);
  if (!response.ok) {
    throw new Error(
      "No dream is published on this server. Build one:<br><br>" +
        "<code>bun run lord init my-dream</code><br>" +
        "<code>bun run lord secret my-dream</code><br>" +
        "<code>bun run lord layout my-dream</code><br>" +
        "<code>bun run lord art my-dream</code><br>" +
        "<code>bun run lord figures my-dream</code><br>" +
        "<code>bun run lord build my-dream</code>",
    );
  }
  return validateDreamArtifact(await response.json());
}

async function boot(): Promise<void> {
  const artifact = await loadArtifact();
  const atlas = await loadAtlas(DREAM_URL);
  const apparatusUrl = new URL("../../assets/autofag.png", import.meta.url)
    .href;
  const apparatusTexture = await Assets.load<Texture | undefined>(
    {
      src: apparatusUrl,
      alias: "lobby-apparatus",
      data: { scaleMode: "nearest" },
    },
    {
      strategy: "skip",
      onError: (error) =>
        console.warn("[dream] lobby apparatus skipped", error),
    },
  );
  if (apparatusTexture) apparatusTexture.source.scaleMode = "nearest";
  const clueTextures = await loadExternalTextures(
    DREAM_URL,
    artifact.content.clues.flatMap((clue) =>
      clue.worldImage ? [{ id: clue.id, path: clue.worldImage }] : [],
    ),
  );
  const backdropTextures = await loadExternalTextures(
    DREAM_URL,
    artifact.content.chambers.flatMap((chamber) =>
      chamber.graphics.backdropImage
        ? [{ id: chamber.id, path: chamber.graphics.backdropImage }]
        : [],
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

  // Anything the Lord baked is already here; the foundry only ever adds what they did not.
  const foundry = new TileFoundry(artifact, atlas);
  foundry.ensureAll(REQUIRED_TILE_ROLES);

  const tilemap = new TilemapView(world, atlas);
  worldRoot.addChild(tilemap.root);
  await app.renderer.prepare.upload(tilemap.root);

  const chamberBackdrops = new ChamberBackdropLayer(world, backdropTextures);
  worldRoot.addChild(chamberBackdrops.root);

  const actors = new ActorLayer(atlas, clueTextures);
  worldRoot.addChild(actors.root);

  /**
   * Clips the world to one room while the player is inside a building.
   *
   * Interiors share the overworld's tile grid, laid out side by side in a band nobody is
   * meant to see whole (see `Warp` in `shared/dream.ts`). Framing the room centres it but
   * does not hide its neighbours, because a house is smaller than a browser window — so
   * without this you stand in your kitchen looking into the two next door. A child of
   * `worldRoot`, so it inherits the camera transform for free.
   */
  // A stencil mask must remain visible to Pixi's render pipeline. Once assigned as a
  // mask, Pixi excludes the Graphics itself from the colour pass; `visible = false`
  // would instead disable the stencil too and leave only the canvas background indoors.
  const roomMask = new Graphics({ label: "interior-mask", eventMode: "none" });
  worldRoot.addChild(roomMask);
  let maskedRoomId: string | null = null;

  let player = createPlayer(world);
  const playerSprite = new WalkerSprite(atlas, "player");
  actors.add(playerSprite);

  const camera = new Camera(
    cameraRoot,
    world.tileSize,
    app.screen.width,
    app.screen.height,
    DEFAULT_CAMERA,
  );
  const shiver = new Shiver(camera);

  const cycle = new Cycle(artifact);
  const journal = new Journal(artifact.slug);
  const wordNotebook = new WordNotebook(artifact.slug);
  const mindMemory = new MindMemory(artifact.slug);
  const hud = new Hud(uiLayer);
  hud.setLobbyMode(true);
  const thinking = new ModelThinkingIndicator(uiLayer);
  const transition = new EnterTransition(uiLayer);

  const observations = new ObservationLog();
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
    // enforced: the sleeper may rearrange anything the player cannot currently see.
    () => camera.visibleTiles(),
  );

  const noteShard = (shardId: string): void => {
    mindMemory.learnShard(shardId);
    observations.noteLearned(shardId);
    const shard = artifact.shards.find((candidate) => candidate.id === shardId);
    if (shard) journal.add(cycle.number, shard.hint);
  };

  const dialogue = new DialoguePanel(uiLayer, mind, thinking, artifact, atlas, {
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
    onShard: noteShard,
    onMemorySpent: () => {
      journal.add(cycle.number, "Ты оставил в этом сне часть себя.");
    },
    onJournal: (figure, text) => {
      journal.addPerson(cycle.number, figure.id, figure.name, text);
    },
    onResonance: (declaration) => {
      dialogue.close();
      finale.openResonance(declaration);
    },
  });

  const debug = new DebugOverlay(uiLayer, world, heartbeat);
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
      onEnded: (kind) => {
        input.setCaptured(true);
        journal.add(
          cycle.number,
          kind === "match"
            ? "Ты назвал тайну сна."
            : kind === "walk-away"
              ? "Ты ушёл, не забрав тайну."
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
      await transition.play();
      if (mode === "live" && !populationInstalled) {
        hud.whisper("Сон вспоминает, кто здесь живёт…", 10);
        const population = await thinking.run(
          "Населяет сон персонажами и деталями",
          () => inhabitDream(artifact.slug),
        );
        const installed = installPopulation(world, population);
        foundry.ensureAll(rolesIn(world, installed.affectedRooms));
        tilemap.refreshAll();
        await app.renderer.prepare.upload(tilemap.root);
        actors.syncFigures(world.figures, world.tileSize);
        actors.syncInterests(world.interests, world.tileSize);
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
      camera.setWorldSize(
        world.width,
        outdoorHeight(world.rooms, world.height),
      );
      camera.fit(OUTDOOR_VIEW_TILES.w, OUTDOOR_VIEW_TILES.h);
      camera.cutTo(player.x, player.y);
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

  const lobby = new LobbySession(
    uiLayer,
    artifact,
    atlas,
    camera,
    {
      onTerminal: () => {
        input.setCaptured(true);
        connect.open();
      },
      onControls: () => {
        input.setCaptured(true);
        controls.open();
      },
      onEnterDream: requestEntry,
    },
    apparatusTexture ?? null,
  );
  cameraRoot.addChild(lobby.scene.root);
  await app.renderer.prepare.upload(lobby.scene.root);
  lobby.setMind(mindSettings);

  /**
   * Window size changed: the integer zoom that fitted the old window may now crop a
   * room or leave it as a postage stamp. Re-fit the current space and snap so the
   * view does not sit against one edge.
   */
  const layoutView = (): void => {
    camera.resize(app.screen.width, app.screen.height);
    if (phase === "lobby" || phase === "enteringDream") {
      camera.setWorldSize(lobby.definition.width, lobby.definition.height);
      camera.fit(lobby.definition.width, lobby.definition.height);
      camera.cutTo(lobby.walker.x, lobby.walker.y);
      return;
    }
    const tile = playerTile(player, world);
    const room = roomAt(world, tile.x, tile.y);
    if (room?.region === "interior") {
      camera.frame(room, true);
      return;
    }
    camera.setWorldSize(world.width, outdoorHeight(world.rooms, world.height));
    camera.fit(OUTDOOR_VIEW_TILES.w, OUTDOOR_VIEW_TILES.h);
    camera.cutTo(player.x, player.y);
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
      journal.add(
        cycle.number,
        `Ты сжёг воспоминание «${memoryText}», чтобы удержать сон.`,
      );
    },
  });

  heartbeat.onBeat((outcome) => {
    // The sleeper may have made something the Lord never baked art for. Mint it before the
    // redraw, or the new ground appears as a hole (§6, "разум подкинул — он тут хозяин").
    foundry.ensureAll(rolesIn(world, outcome.affectedRooms));
    tilemap.refreshRooms(outcome.affectedRooms);
    chamberBackdrops.sync();
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
      resetWorld(world);
      heartbeat.applyCyclePlan(plan);
      observations.reset();
      heartbeat.resetCycle();
      forgetCycle(mind);
      player = createPlayer(world);
      tilemap.clipTo(null);
      maskedRoomId = null;
      worldRoot.mask = null;
      roomMask.clear();
      tilemap.refreshAll();
      chamberBackdrops.sync();
      await app.renderer.prepare.upload(tilemap.root);

      cycle.restart();
      lastWarpId = null;
      camera.cutTo(player.x, player.y);
      const tile = playerTile(player, world);
      const room = roomAt(world, tile.x, tile.y);
      if (room) world.visited.add(room.id);
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
    tilemap,
    chamberBackdrops,
    atlas,
    lobby,
    get phase(): AppPhase {
      return phase;
    },
    restartCycle,
    get player(): typeof player {
      return player;
    },
  };

  const startTile = playerTile(player, world);
  const startRoom = roomAt(world, startTile.x, startTile.y);
  if (startRoom) world.visited.add(startRoom.id);

  let prompt: string | null = null;
  /** The warp we arrived on, so stepping out of a door does not immediately re-enter it. */
  let lastWarpId: string | null = null;

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
      finale.isOpen;
    // Pixi's ticker and renderer stay alive. Only the game clock is paused while network
    // latency, a cycle transition, or the finale owns the simulation.
    const simulationPaused = mind.waiting || restarting || finale.isOpen;
    hud.setMuted(held);

    if (!held && !simulationPaused) {
      updatePlayer(player, world, input.axis(), delta);
      if (player.refusedDoorId) observations.noteRefusal(player.refusedDoorId);
    }

    const tile = playerTile(player, world);
    const room = roomAt(world, tile.x, tile.y);
    if (room) world.visited.add(room.id);
    if (!simulationPaused) observations.tick(delta, room?.id ?? null);
    if (!simulationPaused) {
      updateFigures(
        world,
        cycle.progress,
        delta,
        dialogue.currentFigureId,
        camera.visibleTiles(),
      );
    }

    // Stepping onto a doorway puts you somewhere else on the same grid. A hard cut, the
    // way a Game Boy doorway works — panning across the gap between a town and the room
    // behind its front door would show the seam that the single-grid trick relies on
    // nobody seeing.
    const warp =
      held || simulationPaused ? null : warpAtTile(world, tile.x, tile.y);
    if (warp && warp.id !== lastWarpId) {
      lastWarpId = warp.id;
      player.x = warp.toX * world.tileSize + world.tileSize / 2;
      player.y = warp.toY * world.tileSize + world.tileSize / 2;
      camera.cutTo(player.x, player.y);
      shiver.trigger(0.3);
      world.visited.add(warp.toRoomId);
    } else if (!warp) {
      // Cleared only once you are off the pad, or you would bounce straight back.
      lastWarpId = null;
    }

    // Outdoors the camera follows; indoors it frames the room. Not a flourish — interiors
    // are laid out side by side in a reserved band of the one grid, so a following camera
    // shows you the neighbours' living rooms. Framing is also simply how a Game Boy
    // interior behaves, which is the other reason it is right.
    if (room?.region === "interior") {
      camera.frame(room);
      if (maskedRoomId !== room.id) {
        maskedRoomId = room.id;
        tilemap.clipTo(room.rect);
        const size = world.tileSize;
        roomMask
          .clear()
          .rect(
            room.rect.x * size,
            room.rect.y * size,
            room.rect.w * size,
            room.rect.h * size,
          )
          .fill(0xffffff);
        // Neighbouring interiors can share a 16-tile chunk, so hiding whole chunks is
        // not enough. Pixi uses this Graphics as a stencil and omits its white fill from
        // the colour pass while it is assigned as the mask.
        worldRoot.mask = roomMask;
      }
    } else {
      if (camera.roomId !== null) {
        camera.fit(OUTDOOR_VIEW_TILES.w, OUTDOOR_VIEW_TILES.h);
      }
      camera.follow(player.x, player.y, delta);
      if (maskedRoomId !== null) {
        maskedRoomId = null;
        tilemap.clipTo(null);
        worldRoot.mask = null;
        roomMask.clear();
      }
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
      else if (finale.isOpen) finale.close();
      else dialogue.close();
    }

    if (input.consume(Action.HEARTBEAT)) {
      void thinking.run("Перестраивает сон", () => heartbeat.force());
    }

    if (input.consume(Action.GRANT)) {
      // Debug convenience: hand over every key so locked doors can be walked through
      // while testing the map, without pretending the game has an inventory yet.
      for (const door of world.doors)
        if (door.keyId) world.keysHeld.add(door.keyId);
      for (const edge of artifact.map.graph.edges) {
        if (edge.door === "leverLock") world.leversPulled.add(edge.id);
        if (edge.door === "puzzleLock") world.puzzlesSolved.add(edge.id);
      }
      hud.whisper("Двери больше не спорят. (отладка)");
    }

    const target = held || simulationPaused ? null : findTarget(world, player);
    const atFinale = room?.id === artifact.map.graph.endId;
    prompt = target?.prompt ?? (atFinale ? "сердце сна — назвать тайну" : null);

    if (!simulationPaused && input.consume(Action.INTERACT)) {
      if (target?.kind === "figure") {
        dialogue.open(target.figure);
      } else if (target?.kind === "world") {
        void thinking
          .run("Рассматривает деталь мира", () =>
            mind.examine({
              x: target.x,
              y: target.y,
              roomId: room?.id ?? null,
              interestId: target.interestId,
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

    // --- draw
    playerSprite.update(player.x, player.y, player.facing, walkFrame(player));
    actors.syncFigures(world.figures, world.tileSize);
    actors.syncInterests(world.interests, world.tileSize);

    hud.update(
      {
        title: artifact.title,
        roomName: room?.name ?? "",
        cycleNumber: cycle.number,
        remainingSeconds: cycle.remainingSeconds,
        journalCount: journal.size,
        whisper: prompt,
      },
      delta,
    );
    debug.update(tile.x, tile.y);

    input.endFrame();
  });
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  showBootError("The dream did not open", message);
});
