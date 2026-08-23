import { describe, expect, it } from "bun:test";
import { sonArtifact } from "../../dreams/son/pack";
import {
  localizeDream,
  validateDreamArtifact,
  type DreamArtifact,
  type DreamTranslation,
} from "./dream";

describe("multilingual dreams", () => {
  it("leaves artifact untouched when translating to its base language or missing translations", () => {
    const artifact = sonArtifact();
    const localized = localizeDream(artifact, "ru");
    expect(localized.title).toBe(artifact.title);
    expect(localized.rooms[0]?.name).toBe(artifact.rooms[0]?.name);
  });

  it("overlays English translations over a Russian dream artifact", () => {
    const artifact = sonArtifact();
    const firstRoom = artifact.rooms[0]!;
    const firstFigure = artifact.figures[0]!;
    const firstClue = artifact.content.clues[0]!;

    const sampleTranslation: DreamTranslation = {
      title: "Dream of Son (EN)",
      genreContract: "Medical thriller with glitching memories",
      rooms: {
        [firstRoom.id]: {
          name: "Courtyard",
          atmosphere: "The air smells of wet asphalt.",
          revisitNote: "The courtyard is emptier than before.",
          hotspots: {
            [firstRoom.hotspots[0]?.id ?? "none"]: {
              prompt: "ring intercom",
              refusal: "Nobody answers.",
            },
          },
        },
      },
      characters: {
        [firstFigure.id]: {
          name: "Turyshev",
          role: "Gatekeeper",
          personality: "Suspicious and tired",
        },
      },
      clues: {
        [firstClue.id]: {
          sensorySeed: "Cold heavy metal chain",
          marker: "ANCHOR",
        },
      },
    };

    const multilingualArtifact: DreamArtifact = {
      ...artifact,
      language: "ru",
      translations: {
        en: sampleTranslation,
      },
    };

    // Validate artifact structure
    const validated = validateDreamArtifact(multilingualArtifact);
    expect(validated.language).toBe("ru");
    expect(validated.translations?.en?.title).toBe("Dream of Son (EN)");

    // Localize to EN
    const enArtifact = localizeDream(multilingualArtifact, "en");
    expect(enArtifact.title).toBe("Dream of Son (EN)");
    expect(enArtifact.genreContract).toBe(
      "Medical thriller with glitching memories",
    );

    const translatedRoom = enArtifact.rooms.find((r) => r.id === firstRoom.id);
    expect(translatedRoom?.name).toBe("Courtyard");
    expect(translatedRoom?.atmosphere).toBe("The air smells of wet asphalt.");
    expect(translatedRoom?.revisit.note).toBe(
      "The courtyard is emptier than before.",
    );

    if (firstRoom.hotspots[0]) {
      const translatedHotspot = translatedRoom?.hotspots.find(
        (h) => h.id === firstRoom.hotspots[0]!.id,
      );
      expect(translatedHotspot?.prompt).toBe("ring intercom");
      expect(translatedHotspot?.refusal).toBe("Nobody answers.");
    }

    const translatedFig = enArtifact.figures.find(
      (f) => f.id === firstFigure.id,
    );
    expect(translatedFig?.name).toBe("Turyshev");

    const translatedChar = enArtifact.content.characters.find(
      (c) => c.id === firstFigure.id,
    );
    expect(translatedChar?.name).toBe("Turyshev");
    expect(translatedChar?.role).toBe("Gatekeeper");

    const translatedClue = enArtifact.content.clues.find(
      (c) => c.id === firstClue.id,
    );
    expect(translatedClue?.sensorySeed).toBe("Cold heavy metal chain");
    expect(translatedClue?.marker).toBe("ANCHOR");
  });

  it("rejects translations referencing non-existent rooms", () => {
    const artifact = sonArtifact();
    const invalidArtifact = {
      ...artifact,
      translations: {
        en: {
          rooms: {
            "non-existent-room": {
              name: "Nowhere",
            },
          },
        },
      },
    };

    expect(() => validateDreamArtifact(invalidArtifact)).toThrow(
      "references unknown room non-existent-room",
    );
  });
});
