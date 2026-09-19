/** Training and outage composition using the same finite plans and physical rules. */
import {
  directorPlanSchema,
  type DirectorContext,
  type DirectorGuard,
  type DirectorPlan,
  type DirectorStep,
} from "../../shared/director";
import { perceivedPlayerIdentity } from "../../shared/social-roles";
import {
  executeWorldAction,
  planApproach,
} from "../../shared/world-action-engine";
import type { WorldAction } from "../../shared/world-action";
import { actorIsConcealed, type ActorPose } from "../../shared/world-object";
import { SnapshotSandbox } from "../../shared/world-sandbox";
import { canObserveWorldPose } from "../../shared/world-mind";

type NpcEffect = Extract<DirectorStep["effect"], { kind: "npc" }>;

export function localDirectorPlan(
  context: DirectorContext,
  signals: readonly string[] = [],
): DirectorPlan {
  const world = context.world;
  const sandbox = SnapshotSandbox.fromSnapshot(world);
  const ru = context.locale !== "en";
  const candidates = world.figures
    .filter(
      (figure) =>
        figure.roomId === world.player.roomId &&
        figure.id !== "glaz" &&
        ["present", "leveraged"].includes(figure.fate) &&
        !actorIsConcealed(sandbox.objects, { kind: "figure", id: figure.id }),
    )
    .filter((figure) => canObserveWorldPose(sandbox, figure, world.player))
    .sort(
      (left, right) =>
        Math.hypot(left.x - world.player.x, left.y - world.player.y) -
        Math.hypot(right.x - world.player.x, right.y - world.player.y),
    );
  if (!candidates.length) return { situations: [] };

  const build = (
    label: string,
    effect: NpcEffect,
    guards: DirectorGuard[],
    cause: string,
  ): DirectorPlan =>
    directorPlanSchema.parse({
      situations: [
        {
          id: `local-${label}-${effect.figureId}`.slice(0, 120),
          goal: ru
            ? "Бытовая реакция сна"
            : "A practical response from the dream",
          cause: cause.slice(0, 320),
          lifetimeSeconds: 90,
          steps: [
            {
              id: "respond",
              afterSeconds: 1,
              guards: [
                {
                  kind: "actorRoom",
                  actor: { kind: "player" },
                  roomId: world.player.roomId,
                },
                ...guards,
              ],
              effect,
            },
          ],
        },
      ],
    });
  const preview = (
    figureId: string,
    actions: WorldAction[],
    destination?: ActorPose,
  ): boolean => {
    const projected = sandbox.clone();
    const actor = { kind: "figure" as const, id: figureId };
    if (
      destination &&
      !executeWorldAction(projected, {
        actor,
        source: "npc",
        action: { type: "moveTo", ...destination },
      }).ok
    )
      return false;
    return actions.every(
      (action) =>
        executeWorldAction(projected, { actor, source: "npc", action }).ok,
    );
  };
  const nearPlayer = (figureId: string): ActorPose | undefined => {
    const from = sandbox.getFigurePose(figureId);
    if (!from) return;
    for (const [dx, dy] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
      [1, 1],
      [-1, -1],
    ]) {
      const destination = {
        roomId: world.player.roomId,
        x: Math.round(world.player.x + dx!),
        y: Math.round(world.player.y + dy!),
      };
      if (Math.hypot(from.x - destination.x, from.y - destination.y) < 0.5)
        continue;
      if (
        world.figures.some(
          (figure) =>
            figure.id !== figureId &&
            figure.roomId === destination.roomId &&
            Math.hypot(figure.x - destination.x, figure.y - destination.y) < 1,
        )
      )
        continue;
      if (preview(figureId, [], destination)) return destination;
    }
    return;
  };
  const approach = (
    figureId: string,
    objectId: string,
  ): ActorPose | undefined => {
    const result = planApproach(
      sandbox,
      { kind: "figure", id: figureId },
      objectId,
    );
    return result.refusal
      ? undefined
      : (result.path.at(-1) ?? sandbox.getFigurePose(figureId) ?? undefined);
  };

  const roleReceipt = signals.some((signal) => signal.startsWith("requestRole"))
    ? [...(world.worldMind ?? [])]
        .reverse()
        .find(
          (event) =>
            event.actor?.kind === "player" &&
            event.actionType === "requestRole",
        )
    : undefined;
  const request = roleReceipt?.events.find(
    (event) => event.type === "actor.requested",
  );
  if (request?.type === "actor.requested") {
    const witnesses = candidates.filter((figure) =>
      roleReceipt?.witnessIds.includes(figure.id),
    );
    if (!witnesses.length) return { situations: [] };
    const willing = witnesses.find((figure) => {
      const perception = perceivedPlayerIdentity(world, figure.id);
      return (
        perception.roleId === request.roleId &&
        perception.recognition === "role"
      );
    });
    if (!willing) {
      return build(
        "recognized",
        {
          kind: "npc",
          figureId: witnesses[0]!.id,
          actions: [],
          reply: ru
            ? "Переоделся. А голос тот же."
            : "You changed clothes. Same voice, though.",
        },
        [],
        "A witness recognized the costume; a request is not obedience.",
      );
    }
    const figureId = willing.id;
    const guards: DirectorGuard[] = [
      { kind: "acceptedRole", figureId, roleId: request.roleId },
    ];
    if (request.intent === "gather") {
      const destination = nearPlayer(figureId);
      if (destination)
        return build(
          "audience",
          {
            kind: "npc",
            figureId,
            destination,
            actions: [],
            reply: ru ? "Ну, показывай." : "All right. Show me.",
          },
          guards,
          "An observer accepted the request for an audience.",
        );
    }
    if (request.intent === "helpMove") {
      const object = world.objects.find(
        (entry) => entry.id === request.objectId,
      );
      if (object?.location.kind === "room" && object.mobility === "movable") {
        const destination = approach(figureId, object.id);
        if (destination)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [2, 0],
            [-2, 0],
          ]) {
            const action = {
              type: "moveObject" as const,
              objectId: object.id,
              x: object.location.x + dx!,
              y: object.location.y + dy!,
            };
            if (preview(figureId, [action], destination))
              return build(
                "help-move",
                {
                  kind: "npc",
                  figureId,
                  destination,
                  actions: [action],
                  reply: ru ? "Вот так. Дальше сам." : "There. Your turn now.",
                },
                guards,
                "A witness accepted a practical request to move this real object.",
              );
          }
      }
      return build(
        "help-refused",
        {
          kind: "npc",
          figureId,
          actions: [],
          reply: ru
            ? "Здесь не развернуться. Покажи свободное место."
            : "There is no room here. Show me a clear spot.",
        },
        guards,
        "The requested move has no currently valid physical route.",
      );
    }
    if (request.intent === "inspect") {
      const held = world.objects.find(
        (object) =>
          object.location.kind === "held" &&
          object.location.actor.kind === "figure" &&
          object.location.actor.id === figureId &&
          !object.state.wornBy &&
          !object.clueId &&
          !object.holdsShardId &&
          !object.keyId,
      );
      if (held && preview(figureId, [{ type: "drop", objectId: held.id }]))
        return build(
          "inspection-offer",
          {
            kind: "npc",
            figureId,
            actions: [{ type: "drop", objectId: held.id }],
            reply: ru
              ? "Смотри. Только верни потом."
              : "Look. Just give it back afterwards.",
          },
          guards,
          "An observer offered a real carried item for inspection.",
        );
      const destination = nearPlayer(figureId);
      if (destination)
        return build(
          "inspection",
          {
            kind: "npc",
            figureId,
            destination,
            actions: [],
            reply: ru
              ? "Я здесь. Что проверяем?"
              : "I am here. What are we checking?",
          },
          guards,
          "An observer approached in response to an accepted inspection request.",
        );
    }
    return { situations: [] };
  }

  const occupied = world.objects.find(
    (object) =>
      object.state.occupancy?.actor.kind === "player" &&
      object.state.open !== false &&
      object.state.occupancy.pose !== "hidden",
  );
  if (occupied && signals.some((signal) => signal.startsWith("occupy"))) {
    const figureId = candidates[0]!.id;
    const destination = approach(figureId, occupied.id);
    if (destination)
      return build(
        "fitting",
        {
          kind: "npc",
          figureId,
          destination,
          actions: [],
          reply: ru
            ? "Размер подошёл. Не торопись."
            : "It fits. Take your time.",
        },
        [
          {
            kind: "occupying",
            actor: { kind: "player" },
            objectId: occupied.id,
          },
        ],
        "The player actually occupied a visible support.",
      );
  }

  // Opening an unused local container creates a real opportunity and cannot toggle
  // endlessly: the next request sees open:true and excludes it.
  for (const figure of candidates.slice(0, 3)) {
    for (const object of world.objects) {
      if (
        object.location.kind !== "room" ||
        object.location.roomId !== figure.roomId ||
        object.state.open !== false ||
        object.state.occupancy ||
        !object.affordances.includes("open")
      )
        continue;
      const destination = approach(figure.id, object.id);
      const action = { type: "open" as const, targetId: object.id };
      if (!destination || !preview(figure.id, [action], destination)) continue;
      return build(
        `open-${object.id}`,
        {
          kind: "npc",
          figureId: figure.id,
          destination,
          actions: [action],
          reply: ru
            ? "Пусть открытым постоит."
            : "Let it stay open for a while.",
        },
        [
          {
            kind: "objectState",
            objectId: object.id,
            field: "open",
            value: false,
          },
        ],
        "A nearby figure attends to a closed object; the engine confirmed the available action.",
      );
    }
  }
  return { situations: [] };
}
