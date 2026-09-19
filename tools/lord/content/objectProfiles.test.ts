import { describe, expect, test } from "bun:test";
import { importPhysicalProfile } from "./objectProfiles";
import { compilePhysicalProfile } from "../../../src/shared/object-profile";

describe("author-time physical profile suggestions", () => {
  test("both plain and filled backpacks compile to wearable containers", () => {
    for (const name of ["рюкзак", "рюкзак с фруктами и водкой"]) {
      const compiled = compilePhysicalProfile(importPhysicalProfile(name));
      expect(compiled.mobility).toBe("carryable");
      expect(compiled.affordances).toContain("wear");
      expect(compiled.affordances).toContain("open");
    }
  });
  test("a coffin can be occupied while a person and wall cannot be taken", () => {
    expect(importPhysicalProfile("гроб").occupancy?.pose).toBe("lying");
    for (const label of ["чужая женщина", "кусок стены"]) {
      expect(
        compilePhysicalProfile(importPhysicalProfile(label)).affordances,
      ).not.toContain("take");
    }
  });
});
