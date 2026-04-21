import { describe, expect, it } from "vitest";
import {
  evaluateProductReadiness,
  normalizeReviewChecklist,
} from "@/lib/productReadiness";

const completeChecklist = {
  imageChecked: true,
  titleChecked: true,
  descriptionChecked: true,
  categoryChecked: true,
  priceChecked: true,
};

describe("evaluateProductReadiness", () => {
  it("blocks publishing when the human review is incomplete", () => {
    const result = evaluateProductReadiness({
      imagePreview: "data:image/jpeg;base64,abc",
      artist: "Cueto",
      artworkName: "Figura recostada",
      title: "Cueto - Figura recostada - acuarela sobre papel",
      description:
        "Acuarela de figura recostada con composicion horizontal, tonos suaves y trazo ligero. La escena mantiene una lectura clara para ficha comercial.",
      category: "Arte",
      price: "90",
      observations: "Acuarela",
      condition: 4,
      conditionDetails: "Buen estado general con leves senales de uso.",
      sceneType: "figura",
      idSection: 130,
      reviewChecklist: { imageChecked: true },
    });

    expect(result.isReadyToPublish).toBe(false);
    expect(result.isReviewComplete).toBe(false);
  });

  it("marks a complete and specific ficha as ready", () => {
    const result = evaluateProductReadiness({
      imagePreview: "data:image/jpeg;base64,abc",
      artist: "Cueto",
      artworkName: "Figura recostada",
      title: "Cueto - Figura recostada en acuarela sobre papel",
      description:
        "Obra con figura recostada resuelta mediante una acuarela de tonos suaves y composicion horizontal. El dibujo combina zonas lavadas con lineas visibles, manteniendo una lectura serena y clara para catalogacion comercial.",
      category: "Arte",
      price: "90",
      observations: "Acuarela",
      condition: 4,
      conditionDetails: "Buen estado general con leves senales de uso.",
      sceneType: "figura",
      idSection: 130,
      reviewChecklist: completeChecklist,
    });

    expect(result.isReadyToPublish).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it("keeps a generic description as a warning instead of a publication blocker", () => {
    const result = evaluateProductReadiness({
      imagePreview: "data:image/jpeg;base64,abc",
      artist: "Cueto",
      artworkName: "Figura recostada",
      title: "Cueto - Figura recostada en acuarela sobre papel",
      description: "Obra de arte original",
      category: "Arte",
      price: "90",
      observations: "Acuarela",
      condition: 4,
      conditionDetails: "Buen estado general con leves senales de uso.",
      sceneType: "figura",
      idSection: 130,
      reviewChecklist: completeChecklist,
    });

    expect(result.isReadyToPublish).toBe(true);
    expect(result.blockers).not.toContain(
      "La descripcion parece generica y necesita revision real.",
    );
    expect(result.cautions).toContain(
      "La descripcion suena generica; revisala si quieres afinarla, pero no debe bloquear la publicacion.",
    );
  });

  it("penalizes generic AI-looking titles", () => {
    const result = evaluateProductReadiness({
      imagePreview: "data:image/jpeg;base64,abc",
      artist: "Autor",
      artworkName: "Obra original",
      title: "Obra de arte original",
      description:
        "Descripcion comercial suficiente de una obra con composicion sencilla y estado correcto para la venta.",
      category: "Arte",
      price: "90",
      observations: "Sin observaciones",
      condition: 4,
      conditionDetails: "Buen estado general.",
      sceneType: "arte",
      idSection: 130,
      reviewChecklist: completeChecklist,
    });

    expect(result.isReadyToPublish).toBe(false);
    expect(result.blockers).toContain(
      "El titulo es demasiado generico y no debe publicarse asi.",
    );
  });
});

describe("normalizeReviewChecklist", () => {
  it("never trusts partial or malformed checklist values", () => {
    expect(
      normalizeReviewChecklist({
        imageChecked: true,
        titleChecked: "yes" as unknown as boolean,
      }),
    ).toEqual({
      imageChecked: true,
      titleChecked: false,
      descriptionChecked: false,
      categoryChecked: false,
      priceChecked: false,
    });
  });
});
