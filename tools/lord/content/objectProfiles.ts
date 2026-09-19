/** Author-time suggestions only. The resulting profile is stored in the artifact. */
import type { PhysicalProfile } from "../../../src/shared/object-profile";
import { compilePhysicalProfile } from "../../../src/shared/object-profile";

export function importPhysicalProfile(label: string): PhysicalProfile {
  const name = label.toLocaleLowerCase("ru");
  let profile: PhysicalProfile;
  if (/рюкзак|сумк[аиу]|backpack|rucksack/.test(name))
    profile = { kind: "bag", material: "cloth" };
  else if (/гроб|coffin/.test(name))
    profile = {
      kind: "furniture",
      material: "wood",
      container: "closed",
      occupancy: { pose: "lying" },
    };
  else if (/шкаф|wardrobe/.test(name))
    profile = {
      kind: "furniture",
      container: "closed",
      occupancy: { pose: "hidden" },
    };
  else if (/штаны|пиджак|куртк|халат|shirt|jacket|trousers/.test(name))
    profile = { kind: "garment", material: "cloth" };
  else if (/кровать|диван|постел|bed|sofa/.test(name))
    profile = { kind: "furniture", occupancy: { pose: "lying" } };
  else if (/стул|кресло|лавочк|скамей|chair|bench/.test(name))
    profile = { kind: "furniture", occupancy: { pose: "sitting" } };
  else if (/стол|парт[аы]|полк[аеи]|стеллаж|table|shelf/.test(name))
    profile = { kind: "furniture" };
  else if (
    /женщин|человек|отец|мать|тётя|тетя|кот(?:\W|$)|звер|person/.test(name)
  )
    profile = { kind: "person" };
  else if (
    /вода|снег|след[ыа]|надпись|окно|стен[аыу]|water|snow|window|wall/.test(
      name,
    )
  )
    profile = { kind: "surface" };
  else if (
    /телефон|ноутбук|бутылк|ткань|бумаг|записк|phone|bottle|cloth/.test(name)
  )
    profile = { kind: "portable" };
  else if (/рычаг|вентил|панель|домофон|switch|lever/.test(name))
    profile = { kind: "mechanism" };
  else profile = { kind: "structure" };
  compilePhysicalProfile(profile);
  return profile;
}
