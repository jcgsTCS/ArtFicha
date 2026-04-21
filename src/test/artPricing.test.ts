import { describe, expect, it } from "vitest";
import {
  estimateArtworkPrice,
  getFallbackRangePrice,
  normalizePriceRange,
} from "@/lib/artPricing";

describe("art pricing", () => {
  it("normalizes Spanish and reversed price ranges", () => {
    expect(normalizePriceRange({ min: "1.200,50 EUR", max: "900" })).toEqual({
      min: 900,
      max: 1200.5,
    });
  });

  it("uses the middle of the range as fallback seed price", () => {
    expect(getFallbackRangePrice({ min: "80", max: "180" })).toBe(130);
  });

  it("estimates a recommended price inside the user range", () => {
    const estimate = estimateArtworkPrice({
      title: "Cueto - figura en acuarela sobre papel",
      description:
        "Acuarela con composicion horizontal, buena lectura de luz, trazo visible y paleta cromatica delicada. La figura mantiene equilibrio visual y calidad tecnica.",
      observations: "Acuarela sobre papel en buen estado.",
      category: "Arte",
      sceneType: "figura",
      condition: 4,
      qualityScore: 82,
      priceRange: { min: "80", max: "180" },
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.recommended).toBeGreaterThanOrEqual(80);
    expect(estimate?.recommended).toBeLessThanOrEqual(180);
    expect(estimate?.technicalQualityScore).toBeGreaterThanOrEqual(70);
    expect(estimate?.confidence).toBeGreaterThanOrEqual(45);
  });

  it("does not estimate without a valid range", () => {
    expect(
      estimateArtworkPrice({
        title: "Sin rango",
        description: "Descripcion suficiente",
        observations: "",
        category: "Arte",
        sceneType: "obra",
        condition: 3,
        priceRange: { min: "", max: "180" },
      }),
    ).toBeNull();
  });
});
