import type { FigurePlacement } from "../../../src/shared/dream";
import authored from "../content/figures.json";

const EXTRA: FigurePlacement[] = [
  {
    id: "raisa",
    name: "РАИСА МИХАЙЛОВНА",
    roomId: "02-shkola-kabinet-russkogo",
    slotId: "a",
    archetypeId: "watcher",
    holdsShardId: null,
  },
  {
    id: "lysyi",
    name: "ЛЫСЫЙ В APPLE WATCH",
    roomId: "19-dvor-i-oranzhevye-lavochki",
    slotId: "b",
    archetypeId: "visitor",
    holdsShardId: null,
  },
  {
    id: "kurt",
    name: "КУРТ",
    roomId: "19-dvor-i-oranzhevye-lavochki",
    slotId: "c",
    archetypeId: "child",
    holdsShardId: null,
  },
  {
    id: "ded-slava",
    name: "ДЕД СЛАВА",
    roomId: "15-osennii-les-s-grobom",
    slotId: "a",
    archetypeId: "watcher",
    holdsShardId: null,
  },
  {
    id: "aleksei",
    name: "АЛЕКСЕЙ",
    roomId: "01-otel-goticheskii-holl",
    slotId: "d",
    archetypeId: "orderly",
    holdsShardId: null,
  },
  {
    id: "shchenok",
    name: "ЩЕНОК",
    roomId: "m9-shkaf",
    slotId: "a",
    archetypeId: "child",
    holdsShardId: null,
  },
];

export function allFigures(): FigurePlacement[] {
  return [...(authored as FigurePlacement[]), ...EXTRA];
}
