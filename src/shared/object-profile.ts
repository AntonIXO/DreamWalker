/** Authored physical facts; appearance and collision size never decide capabilities. */
import type {
  ObjectAffordance,
  ObjectMobility,
  WorldObjectPhysicalState,
} from "./world-object";

export const PHYSICAL_KINDS = [
  "portable",
  "bag",
  "garment",
  "furniture",
  "structure",
  "mechanism",
  "surface",
  "person",
] as const;
export type WearSlot = "body" | "head" | "back";
export type OccupantPose = "lying" | "sitting" | "hidden";
export interface PhysicalProfile {
  kind: (typeof PHYSICAL_KINDS)[number];
  mobility?: ObjectMobility;
  material?: string;
  container?: "open" | "closed";
  wear?: { slot: WearSlot; appearanceFigureId?: string };
  /** Position relative to the object's top-left tile. */
  occupancy?: { pose: OccupantPose; x?: number; y?: number };
  attachment?: { toObjectId: string; detachable: boolean };
}

export function clonePhysicalProfile(
  profile: PhysicalProfile,
): PhysicalProfile {
  return structuredClone(profile);
}

export function validatePhysicalProfile(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["profile must be an object"];
  const p = value as PhysicalProfile;
  const errors: string[] = [];
  const allowed = new Set([
    "kind",
    "mobility",
    "material",
    "container",
    "wear",
    "occupancy",
    "attachment",
  ]);
  if (Object.keys(p).some((key) => !allowed.has(key)))
    errors.push("unknown physical profile field");
  if (!PHYSICAL_KINDS.includes(p.kind)) errors.push("invalid physical kind");
  if (
    p.mobility !== undefined &&
    !["fixed", "movable", "carryable"].includes(p.mobility)
  )
    errors.push("invalid mobility");
  if (
    p.material !== undefined &&
    (typeof p.material !== "string" || p.material.length > 80)
  )
    errors.push("invalid material");
  if (p.container !== undefined && !["open", "closed"].includes(p.container))
    errors.push("invalid container");
  if (
    p.wear !== undefined &&
    (!p.wear ||
      !["body", "head", "back"].includes(p.wear.slot) ||
      (p.wear.appearanceFigureId !== undefined &&
        (typeof p.wear.appearanceFigureId !== "string" ||
          !p.wear.appearanceFigureId ||
          p.wear.appearanceFigureId.length > 120)))
  )
    errors.push("invalid wear profile");
  if (
    p.wear &&
    Object.keys(p.wear).some(
      (key) => !["slot", "appearanceFigureId"].includes(key),
    )
  )
    errors.push("unknown wear field");
  if (p.occupancy !== undefined) {
    if (
      !p.occupancy ||
      !["lying", "sitting", "hidden"].includes(p.occupancy.pose)
    )
      errors.push("invalid occupancy");
    else
      for (const coordinate of [p.occupancy.x, p.occupancy.y])
        if (
          coordinate !== undefined &&
          (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 16)
        )
          errors.push("invalid occupancy offset");
    if (
      p.occupancy &&
      Object.keys(p.occupancy).some((key) => !["pose", "x", "y"].includes(key))
    )
      errors.push("unknown occupancy field");
  }
  if (
    p.attachment !== undefined &&
    (!p.attachment ||
      typeof p.attachment.toObjectId !== "string" ||
      !p.attachment.toObjectId ||
      p.attachment.toObjectId.length > 120 ||
      typeof p.attachment.detachable !== "boolean")
  )
    errors.push("invalid attachment");
  if (
    p.attachment &&
    Object.keys(p.attachment).some(
      (key) => !["toObjectId", "detachable"].includes(key),
    )
  )
    errors.push("unknown attachment field");
  if (
    ["structure", "surface", "person"].includes(p.kind) &&
    (p.mobility === "carryable" || p.mobility === "movable" || p.wear)
  )
    errors.push("structural or living entities cannot be equipment");
  return errors;
}

export function effectiveWear(
  profile: PhysicalProfile | undefined,
): PhysicalProfile["wear"] {
  return (
    profile?.wear ??
    (profile?.kind === "bag"
      ? { slot: "back" }
      : profile?.kind === "garment"
        ? { slot: "body" }
        : undefined)
  );
}

export function compilePhysicalProfile(profile: PhysicalProfile): {
  mobility: ObjectMobility;
  affordances: ObjectAffordance[];
  state: WorldObjectPhysicalState;
  tags: string[];
} {
  const errors = validatePhysicalProfile(profile);
  if (errors.length) throw new Error(errors.join("; "));
  const mobility =
    profile.mobility ??
    (["portable", "bag", "garment"].includes(profile.kind)
      ? "carryable"
      : profile.kind === "furniture"
        ? "movable"
        : "fixed");
  const affordances: ObjectAffordance[] = ["examine"];
  if (mobility === "carryable")
    affordances.push("take", "drop", "give", "put", "use");
  if (mobility === "movable") affordances.push("moveObject");
  const container =
    profile.container ?? (profile.kind === "bag" ? "closed" : undefined);
  if (container) affordances.push("open", "close", "empty");
  if (effectiveWear(profile)) affordances.push("wear", "removeWear");
  if (profile.occupancy) affordances.push("occupy", "leave");
  if (profile.attachment?.detachable) affordances.push("detach");
  if (profile.kind === "mechanism") affordances.push("activate", "use");
  return {
    mobility,
    affordances: [...new Set(affordances)],
    state: {
      ...(container ? { open: container === "open" } : {}),
      ...(profile.attachment
        ? { attachedTo: profile.attachment.toObjectId }
        : {}),
    },
    tags: [profile.kind, ...(container ? ["container"] : [])],
  };
}
