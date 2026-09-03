import type { StyleProfile } from "../../src/shared/art/style";
import type { MnemonicCommitment } from "../../src/shared/content";
import type {
  CycleConfig,
  HeartbeatConfig,
  Palette,
  Shard,
} from "../../src/shared/dream";

export const SLUG = "son";
export const TITLE = "Сон";
export const GENRE = "Сон, который знает, что его используют";
export const STYLE_WORDS = [
  "оранжевая лавочка",
  "готический холл",
  "канава",
  "глаз",
] as const;

export const SECRET_HASH =
  "1c98bd32f73659e1f52d04d37a8faf3a5ebb27c8350fdcc0b4377d0e023342a6";

export const SHARDS: Shard[] = [
  {
    id: "shard1",
    hint: "На полке для оставленных вещей кто-то всё подписывал одним и тем же.",
  },
  {
    id: "shard2",
    hint: "В хохоте художника между взрывами смеха есть слог, который с пола не слышно.",
  },
  {
    id: "shard3",
    hint: "На пакетике под гербом чужим почерком написано бытовое слово.",
  },
  {
    id: "shard4",
    hint: "Кирилл называет чужое своим и вставляет это в хвастовство.",
  },
  {
    id: "shard5",
    hint: "Папа в середине совета роняет одно лишнее существительное.",
  },
  {
    id: "shard6",
    hint: "Глаз отдаст последнее, только если сказать вслух, зачем пришёл.",
  },
];

export const PALETTE: Palette = {
  name: "ash",
  colors: [
    "#0a0a0d",
    "#2b2f38",
    "#333845",
    "#1b1e25",
    "#242832",
    "#3d4351",
    "#4a5162",
    "#161920",
    "#5c6678",
    "#8a6a3c",
    "#5a2f2f",
    "#9fb3c8",
    "#6b7280",
    "#c2b8a3",
    "#e8e4dc",
    "#f0c674",
  ],
  roles: {
    background: 0,
    floor: 1,
    floorAlt: 2,
    floorShadow: 3,
    threshold: 4,
    wall: 5,
    wallFace: 6,
    wallEdge: 7,
    doorOpen: 8,
    doorLocked: 9,
    doorSealed: 10,
    accent: 11,
    prop: 12,
    figure: 13,
    player: 14,
    highlight: 15,
  },
};

export const STYLE: StyleProfile = {
  outlineIndex: 0,
  outlineWidth: 1,
  groundIndex: 1,
  accentIndex: 15,
  ramps: {
    hue0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  ditherDensity: 0,
  shadingSteps: 3,
};

export const MNEMONIC: MnemonicCommitment = {
  hash: SECRET_HASH,
  wordlist: "english",
  knownSlots: [
    "only",
    "increase",
    "ghost",
    "about",
    "loan",
    null,
    null,
    "mercy",
    null,
    null,
    null,
    null,
  ],
};

export const CYCLE: CycleConfig = {
  durationMs: 480_000,
  maxCycles: 4,
};

export const HEARTBEAT: HeartbeatConfig = {
  callBudgetPerCycle: 12,
  maxPatchesPerBeat: 2,
};

/** When the patient locked the money from himself. The finale's unlock is server-only. */
export const LOCK_STARTED_AT = "2025-08-17T00:00:00.000Z";

export const TRAINING_AMOUNT = "0.08412000";
