/** Finite, composable dream plans. Prose is a motive, never an executable rule. */
import { z } from "zod";
import type { WorldSnapshot } from "./ai";
import type { MemoryEpisode } from "./episodic-memory";
import type { SupportedLocale } from "./i18n";
import type { WorldAction } from "./world-action";

export const DIRECTOR_LIMITS = {
  coalesceSeconds: 3,
  minCallSeconds: 30,
  idleSeconds: 60,
  maxSituations: 2,
  maxActions: 8,
  maxPatches: 2,
  maxNpcGuidance: 2,
  maxLifetimeSeconds: 180,
} as const;

const id = z.string().trim().min(1).max(120);
const actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("player") }),
  z.object({ kind: z.literal("figure"), id }),
]);
const point = z.object({
  roomId: id,
  x: z.number().finite(),
  y: z.number().finite(),
});

/** Actor identity is bound by the enclosing NPC step, never supplied by an action. */
export const directorActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("take"), objectId: id }),
  z.object({ type: z.literal("drop"), objectId: id }),
  z.object({ type: z.literal("give"), objectId: id, to: actor }),
  z.object({ type: z.literal("put"), objectId: id, intoObjectId: id }),
  z.object({ type: z.literal("open"), targetId: id }),
  z.object({ type: z.literal("close"), targetId: id }),
  z.object({ type: z.literal("activate"), objectId: id }),
  z.object({ type: z.literal("use"), objectId: id, targetId: id.optional() }),
  z.object({ type: z.literal("occupy"), objectId: id }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("wear"), objectId: id }),
  z.object({ type: z.literal("removeWear"), objectId: id }),
  z.object({ type: z.literal("detach"), objectId: id }),
  z.object({ type: z.literal("empty"), objectId: id }),
  z.object({
    type: z.literal("moveObject"),
    objectId: id,
    x: z.number().finite(),
    y: z.number().finite(),
  }),
]);

/** No arbitrary flags, scripts, formulas, recursive predicates or invented entities. */
export const directorGuardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("actorRoom"), actor, roomId: id }),
  z.object({
    kind: z.literal("objectState"),
    objectId: id,
    field: z.enum(["open", "active", "broken", "locked", "wet", "dirty"]),
    value: z.boolean(),
  }),
  z.object({ kind: z.literal("heldBy"), objectId: id, actor }),
  z.object({ kind: z.literal("wearing"), actor, objectId: id }),
  z.object({ kind: z.literal("occupying"), actor, objectId: id }),
  z.object({ kind: z.literal("role"), actor, appearanceFigureId: id }),
  z.object({ kind: z.literal("acceptedRole"), figureId: id, roleId: id }),
  z.object({
    kind: z.literal("roomVisits"),
    roomId: id,
    atLeast: z.number().int().min(1).max(1000),
  }),
  z.object({
    kind: z.literal("receipt"),
    actionType: z.enum([
      "take",
      "drop",
      "give",
      "put",
      "open",
      "close",
      "activate",
      "use",
      "alter",
      "gesture",
      "traverseDoor",
      "occupy",
      "leave",
      "wear",
      "removeWear",
      "detach",
      "empty",
      "moveObject",
      "requestRole",
    ]),
    actor,
    objectId: id.optional(),
    witnessId: id.optional(),
  }),
]);

export const directorPatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sealDoor"),
    doorId: id,
    reason: z.string().min(1).max(240),
  }),
  z.object({
    kind: z.literal("openDoor"),
    doorId: id,
    reason: z.string().min(1).max(240),
  }),
  z.object({
    kind: z.literal("revealDoor"),
    doorId: id,
    reason: z.string().min(1).max(240),
  }),
  z.object({
    kind: z.literal("retargetDoor"),
    doorId: id,
    toRoomId: id,
    reason: z.string().min(1).max(240),
  }),
  z.object({
    kind: z.literal("moveFigure"),
    figureId: id,
    toRoomId: id,
    reason: z.string().min(1).max(240),
  }),
  z.object({
    kind: z.literal("shiftWalls"),
    roomId: id,
    variantId: id,
    reason: z.string().min(1).max(240),
  }),
]);

const effect = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("npc"),
    figureId: id,
    /** Local pathfinding walks through actual thresholds; path tiles cost no AI actions. */
    destination: point.optional(),
    actions: z.array(directorActionSchema).max(DIRECTOR_LIMITS.maxActions),
    /** Said only after the physical sequence succeeds, and only when the player hears it. */
    reply: z.string().trim().max(220).optional(),
  }),
  z.object({ kind: z.literal("patch"), patch: directorPatchSchema }),
]);

export const directorSituationSchema = z.object({
  id,
  goal: z.string().trim().min(1).max(240),
  cause: z.string().trim().min(1).max(320),
  lifetimeSeconds: z.number().min(5).max(DIRECTOR_LIMITS.maxLifetimeSeconds),
  steps: z
    .array(
      z.object({
        id,
        /** Measured from the previous confirmed step, on the local simulation clock. */
        afterSeconds: z.number().min(0).max(120),
        guards: z.array(directorGuardSchema).max(8),
        effect,
      }),
    )
    .min(1)
    .max(8),
});

/** A private motive for local NPC decisions, never a movement/action program. */
export const npcGuidanceSchema = z
  .object({
    figureId: id,
    goalId: id,
    goal: z.string().trim().min(1).max(240),
    lifetimeSeconds: z.number().min(5).max(DIRECTOR_LIMITS.maxLifetimeSeconds),
  })
  .strict();

export const directorPlanSchema = z
  .object({
    situations: z
      .array(directorSituationSchema)
      .max(DIRECTOR_LIMITS.maxSituations),
    npcGuidance: z
      .array(npcGuidanceSchema)
      .max(DIRECTOR_LIMITS.maxNpcGuidance)
      .optional(),
  })
  .superRefine((plan, context) => {
    let actions = 0;
    let patches = 0;
    const ids = new Set<string>();
    const guidedFigures = new Set<string>();
    for (const guidance of plan.npcGuidance ?? []) {
      if (guidedFigures.has(guidance.figureId))
        context.addIssue({
          code: "custom",
          message: "Only one guidance per NPC is allowed",
        });
      guidedFigures.add(guidance.figureId);
    }
    for (const situation of plan.situations) {
      if (ids.has(situation.id))
        context.addIssue({ code: "custom", message: "Repeated situation id" });
      ids.add(situation.id);
      const steps = new Set<string>();
      for (const step of situation.steps) {
        if (steps.has(step.id))
          context.addIssue({ code: "custom", message: "Repeated step id" });
        steps.add(step.id);
        if (step.effect.kind === "patch") patches++;
        else {
          actions += step.effect.actions.length;
          if (
            !step.effect.destination &&
            !step.effect.actions.length &&
            !step.effect.reply
          )
            context.addIssue({
              code: "custom",
              message: "An NPC step needs an action, destination or speech",
            });
        }
      }
    }
    if (actions > DIRECTOR_LIMITS.maxActions)
      context.addIssue({
        code: "custom",
        message: "Director action budget exceeded",
      });
    if (patches > DIRECTOR_LIMITS.maxPatches)
      context.addIssue({
        code: "custom",
        message: "Director patch budget exceeded",
      });
  });

export type DirectorGuard = z.infer<typeof directorGuardSchema>;
export type DirectorPlan = z.infer<typeof directorPlanSchema>;
export type DirectorSituation = z.infer<typeof directorSituationSchema>;
export type DirectorStep = DirectorSituation["steps"][number];
export type NpcGuidance = z.infer<typeof npcGuidanceSchema>;

export interface ActiveNpcGuidance extends NpcGuidance {
  /** Local simulation time; expiry never needs another model call. */
  acceptedAt: number;
}

export interface DirectorContext {
  runId: string;
  cycleNumber: number;
  world: WorldSnapshot;
  memories?: MemoryEpisode[];
  sleeperSummary?: string;
  locale?: SupportedLocale;
}

export interface DirectorRequest extends DirectorContext {
  slug: string;
  elapsedSeconds: number;
  signals: string[];
  activeSituations: Array<{ id: string; goal: string; step: number }>;
  activeNpcGuidance?: NpcGuidance[];
  recentReceipts?: DirectorReceipt[];
}

export interface DirectorReceipt {
  situationId: string;
  stepId: string;
  at: number;
  ok: boolean;
  effect: DirectorStep["effect"];
  refusal?: string;
}

export interface ActiveDirectorSituation {
  plan: DirectorSituation;
  /** The model's label may be reused for a new user request after this instance finishes. */
  proposalId?: string;
  step: number;
  acceptedAt: number;
  lastStepAt: number;
  /** Receipt guards cannot accidentally match a much older incarnation of an action. */
  afterSequence: number;
  /** Successful prefixes are removed before checkpoints; reload cannot repeat them. */
  remainingActions?: WorldAction[];
  /** Preconditions changed by this step's own committed prefix are not external invalidations. */
  consumedGuardIndices?: number[];
  /** A confirmed event stays true even after the bounded physical log rotates. */
  seenReceiptGuards?: string[];
}

export interface DirectorSnapshot {
  version: 1;
  elapsedSeconds: number;
  lastCallAt: number | null;
  lastProgressAt: number;
  pendingSince: number | null;
  signals: string[];
  active: ActiveDirectorSituation[];
  completedIds: string[];
  receipts?: DirectorReceipt[];
  npcGuidance?: ActiveNpcGuidance[];
  /** Stable goal identities survive expiry and reload so paraphrases do not rearm decisions. */
  seenGuidanceIds?: Array<{ figureId: string; goalId: string }>;
}
