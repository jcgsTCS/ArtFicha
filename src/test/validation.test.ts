import { describe, expect, it } from "vitest";
import {
  detectOrientationSchema,
  generateProductSchema,
  publishProductSchema,
} from "@/lib/validation";

describe("payload validation", () => {
  it("rejects generation without a real image", () => {
    expect(() =>
      generateProductSchema.parse({
        imageBase64: "bad",
        artist: "Cueto",
        measures: "40x30",
        price: "90",
        observations: "Acuarela",
      }),
    ).toThrow();
  });

  it("rejects publishing with weak commercial content", () => {
    expect(() =>
      publishProductSchema.parse({
        credentials: { userId: "u", apiKey: "k" },
        artwork: {
          title: "Corto",
          description: "Insuficiente",
          price: "90",
          condition: 4,
          conditionDetails: "Buen estado",
          idSection: 130,
        },
      }),
    ).toThrow();
  });

  it("accepts orientation variants with image payloads", () => {
    expect(
      detectOrientationSchema.parse({
        imageBase64: "data:image/jpeg;base64," + "a".repeat(80),
        variants: [
          {
            rotationDegrees: 90,
            imageBase64: "data:image/jpeg;base64," + "b".repeat(80),
          },
        ],
      }).variants?.[0].rotationDegrees,
    ).toBe(90);
  });
});
