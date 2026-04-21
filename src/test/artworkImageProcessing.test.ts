import { describe, expect, it } from "vitest";
import { normalizeQuarterTurn } from "@/lib/artworkImageProcessing";

describe("artworkImageProcessing", () => {
  it("normalizes AI orientation decisions to safe quarter turns", () => {
    expect(normalizeQuarterTurn(88)).toBe(90);
    expect(normalizeQuarterTurn(181)).toBe(180);
    expect(normalizeQuarterTurn(269)).toBe(270);
    expect(normalizeQuarterTurn(44)).toBe(0);
    expect(normalizeQuarterTurn(Number.NaN)).toBe(0);
  });
});
