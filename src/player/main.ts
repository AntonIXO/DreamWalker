/**
 * The player.
 *
 * §8: one server, one dream. This app fetches exactly one artifact from /dream/ and
 * plays it. It generates nothing — the world was authored by a person with the `lord`
 * CLI. The only thing that changes it at runtime is the heartbeat, and everything the
 * heartbeat does goes through `game/patch.ts`.
 */

import {
  Application,
  Container,
  CullerPlugin,
  Graphics,
  extensions,
} from "pixi.js";

import { validateDreamArtifact, type DreamArtifact } from "../shared/dream";
import { REQUIRED_TILE_ROLES, TILE_ROLE } from "../shared/tilecodes";
import { loadAtlas } from "./render/atlasTextures";
import { TileFoundry } from "./render/foundry";
import { Camera, DEFAULT_CAMERA } from "./render/camera";
import { DebugOverlay } from "./render/debugOverlay";
import { Shiver } from "./render/shiver";
import { TilemapView } from "./render/tilemap";
import { ActorLayer, WalkerSprite } from "./render/walkerView";
import { Cycle, Journal } from "./game/cycle";
import { Action, Input } from "./game/input";
import { examine, findTarget } from "./game/interact";
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
import { loadMindSettings } from "./mind/settings";
import { ConnectPanel } from "./ui/connect";
import { ControlsPanel } from "./ui/controls";
import { DialoguePanel } from "./ui/dialogue";
import { Hud } from "./ui/hud";
import { StartMenu } from "./ui/menu";

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

  const world = createWorld(artifact);
  const background =
    artifact.palette.colors[artifact.palette.roles.background] ?? "#000000";

  const app = new Application();
  await app.init({
    background,
    resizeTo: window,
    antialias: false,
    roundPixels: true,
  });
  document.getElementById("pixi-container")!.appendChild(app.canvas);
  document.title = `${artifact.title} — Dream Walker`;

  const uiLayer = document.getElementById("ui-layer")!;

  // Everything the camera moves lives under here; UI does not.
  const worldRoot = new Container({ label: "world" });
  app.stage.addChild(worldRoot);

  // Anything the Lord baked is already here; the foundry only ever adds what they did not.
  const foundry = new TileFoundry(artifact, atlas);
  foundry.ensureAll(REQUIRED_TILE_ROLES);

  const tilemap = new TilemapView(world, atlas);
  worldRoot.addChild(tilemap.root);

  const actors = new ActorLayer(atlas);
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
  const roomMask = new Graphics();
  worldRoot.addChild(roomMask);
  let maskedRoomId: string | null = null;

  let player = createPlayer(world);
  const playerSprite = new WalkerSprite(atlas, "player");
  actors.add(playerSprite);

  const camera = new Camera(
    worldRoot,
    world.tileSize,
    app.screen.width,
    app.screen.height,
    DEFAULT_CAMERA,
  );
  camera.setWorldSize(world.width, world.height);
  const shiver = new Shiver(camera);

  const cycle = new Cycle(artifact);
  const journal = new Journal(artifact.slug);
  const hud = new Hud(uiLayer);

  const observations = new ObservationLog();
  // The mind is chosen once, at boot, from what the player configured. Changing the key
  // mid-dream would mean two different minds having defended the same cycle, so the
  // connection panel takes effect on the next load and says so.
  const mindSettings = loadMindSettings();
  const mind = createMind(world, mindSettings);
  const heartbeat = new Heartbeat(
    world,
    mind,
    observations,
    artifact.heartbeat,
    // §6's guarantee, as a question the heartbeat asks rather than a shape the camera
    // enforced: the sleeper may rearrange anything the player cannot currently see.
    () => camera.visibleTiles(),
  );

  const dialogue = new DialoguePanel(uiLayer, mind, {
    onOpen: (figure) => {
      input.setCaptured(true);
      observations.noteApproach(figure.id);
    },
    onClose: () => input.setCaptured(false),
    onTell: (quoted) => {
      // §3: a tell is only useful if the player can go back and see what caused it.
      journal.add(cycle.number, `Тебя переспросили про «${quoted}».`);
    },
    onShard: (shardId) => {
      observations.noteLearned(shardId);
      const shard = artifact.shards.find((s) => s.id === shardId);
      if (shard) journal.add(cycle.number, shard.hint);
    },
  });

  const controls = new ControlsPanel(uiLayer, {
    // Closing a panel that was opened from the menu puts the menu back; closing one opened
    // mid-play does nothing, because `setVisible` only shows what is still the active
    // screen. One callback, both cases.
    onClose: () => menu.setVisible(true),
  });
  const debug = new DebugOverlay(uiLayer, world, heartbeat);
  const input = new Input();
  input.attach();

  const connect = new ConnectPanel(uiLayer, {
    onChange: (settings) => menu.setMind(settings),
    onClose: () => menu.setVisible(true),
  });
  const menu: StartMenu = new StartMenu(uiLayer, artifact, {
    onStart: () => {
      menu.close();
      controls.close();
      connect.close();
    },
    // Panels open *over* the menu, one at a time. Two absolutely-positioned things in the
    // middle of the screen do not layer, they collide.
    onControls: () => {
      menu.setVisible(false);
      controls.open();
    },
    onConnect: () => {
      menu.setVisible(false);
      connect.open();
    },
  });
  menu.setMind(mindSettings);
  menu.setJournal(journal.all());

  heartbeat.onBeat((outcome) => {
    // The sleeper may have made something the Lord never baked art for. Mint it before the
    // redraw, or the new ground appears as a hole (§6, "разум подкинул — он тут хозяин").
    foundry.ensureAll(rolesIn(world, outcome.affectedRooms));
    tilemap.refreshRooms(outcome.affectedRooms);
    shiver.trigger(Math.min(1, outcome.affectedRooms.length / 2));
    for (const note of outcome.notes) journal.add(cycle.number, note);
    if (outcome.notes.length > 0) hud.whisper(outcome.notes[0]!);
  });

  app.renderer.on("resize", (width: number, height: number) => {
    camera.resize(width, height);
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
      // §5: on the way out, the sleeper spends a moment working out what you found.
      await heartbeat.beatOnCycleExit();

      resetWorld(world);
      observations.reset();
      heartbeat.resetCycle();
      forgetCycle(mind);
      player = createPlayer(world);
      tilemap.refreshAll();

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
    tilemap,
    atlas,
    restartCycle,
    get player(): typeof player {
      return player;
    },
  };

  const startTile = playerTile(player, world);
  const startRoom = roomAt(world, startTile.x, startTile.y);
  if (startRoom) world.visited.add(startRoom.id);
  camera.cutTo(player.x, player.y);

  // Built, drawn, and not yet running. The ticker keeps turning so the menu can be driven
  // by the same keys as everything else and the dream is visible behind it — what is
  // suspended is the *cycle*, which must not start burning while nobody is playing.
  menu.open();

  let prompt: string | null = null;
  /** The warp we arrived on, so stepping out of a door does not immediately re-enter it. */
  let lastWarpId: string | null = null;

  app.ticker.add((ticker) => {
    const delta = Math.min(ticker.deltaMS, 100) / 1000;

    // The menu is the only thing that stops time. §5 makes the countdown the pressure the
    // whole game runs on, so it may not tick down while the player is reading a panel.
    if (menu.isOpen) {
      const overlaid = connect.isOpen || controls.isOpen;
      if (input.consume(Action.HELP) && !connect.isOpen) {
        controls.toggle();
        menu.setVisible(!controls.isOpen);
      }
      if (input.consume(Action.CANCEL) && overlaid) {
        connect.close();
        controls.close();
        menu.setVisible(true);
      }
      camera.update(delta);
      input.endFrame();
      return;
    }

    // Anything that has taken over the screen also takes the sanitar's feet. Reading the
    // controls should not walk you into a wall.
    const held = dialogue.isOpen || controls.isOpen;
    hud.setMuted(held);

    if (!held) {
      updatePlayer(player, world, input.axis(), delta);
      if (player.refusedDoorId) observations.noteRefusal(player.refusedDoorId);
    }

    const tile = playerTile(player, world);
    const room = roomAt(world, tile.x, tile.y);
    if (room) world.visited.add(room.id);
    observations.tick(delta, room?.id ?? null);

    // Stepping onto a doorway puts you somewhere else on the same grid. A hard cut, the
    // way a Game Boy doorway works — panning across the gap between a town and the room
    // behind its front door would show the seam that the single-grid trick relies on
    // nobody seeing.
    const warp = held ? null : warpAtTile(world, tile.x, tile.y);
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
        worldRoot.mask = roomMask;
      }
    } else {
      camera.follow(player.x, player.y, delta);
      if (maskedRoomId !== null) {
        maskedRoomId = null;
        worldRoot.mask = null;
      }
    }

    // --- one-shot actions
    if (input.consume(Action.DEBUG)) debug.toggle();
    if (input.consume(Action.HELP)) controls.toggle();

    // Escape peels one layer at a time, outermost first, so it never closes a
    // conversation the player only meant to look away from.
    if (input.consume(Action.CANCEL)) {
      if (controls.isOpen) controls.close();
      else dialogue.close();
    }

    if (input.consume(Action.HEARTBEAT)) void heartbeat.force();

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

    const target = held ? null : findTarget(world, player);
    prompt = target?.prompt ?? null;

    if (target && input.consume(Action.INTERACT)) {
      if (target.kind === "figure") {
        dialogue.open(target.figure);
      } else if (target.kind === "world") {
        hud.whisper(examine(world, target.x, target.y), 4);
      } else {
        hud.whisper(target.prompt, 3);
      }
    }

    // --- time
    if (cycle.update(delta)) void restartCycle();
    heartbeat.update(delta);
    shiver.update(delta);
    camera.update(delta);

    // --- draw
    playerSprite.update(player.x, player.y, player.facing, walkFrame(player));
    actors.syncFigures(world.figures, world.tileSize);

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
