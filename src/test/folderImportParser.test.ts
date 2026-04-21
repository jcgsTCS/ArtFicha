import { describe, expect, it } from "vitest";
import {
  buildFolderImportItems,
  parseFolderImportPath,
} from "@/lib/folderImportParser";

describe("folder import parser", () => {
  it("inherits artist, category, measures and price from folder levels", () => {
    const parsed = parseFolderImportPath(
      "Picasso/Oleos sobre lienzo/80x60 - 350€/obra1.jpg",
    );

    expect(parsed.metadata.artist).toBe("Picasso");
    expect(parsed.metadata.category).toBe("Oleos sobre lienzo");
    expect(parsed.metadata.sceneType).toBe("Oleos sobre lienzo");
    expect(parsed.metadata.measures).toBe("80x60 cm");
    expect(parsed.metadata.price).toBe("350");
    expect(parsed.warnings).toEqual([]);
  });

  it("accepts common measures and price separators", () => {
    const parsed = parseFolderImportPath(
      "Cueto/Acuarela/100x81 | 1.200,50 eur/obra.png",
    );

    expect(parsed.metadata.measures).toBe("100x81 cm");
    expect(parsed.metadata.priceNumber).toBe(1200.5);
  });

  it("does not block malformed folders and returns warnings", () => {
    const parsed = parseFolderImportPath("Autor/Dibujos/sin datos/obra.jpg");

    expect(parsed.metadata.artist).toBe("Autor");
    expect(parsed.metadata.category).toBe("Dibujos");
    expect(parsed.metadata.measures).toBeNull();
    expect(parsed.metadata.price).toBeNull();
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("builds parsed items only for supported images", () => {
    const files = [
      new File(["x"], "obra.jpg", { type: "image/jpeg" }),
      new File(["x"], "notas.txt", { type: "text/plain" }),
    ];

    expect(buildFolderImportItems(files)).toHaveLength(1);
  });
});
