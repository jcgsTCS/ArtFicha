export type FolderParsingRules = {
  artistLevel: number;
  categoryLevel: number;
  measuresPriceLevel: number;
  observationsFromLevelsAfter?: number;
};

export type FolderParsingMetadata = {
  artist: string | null;
  category: string | null;
  sceneType: string | null;
  measures: string | null;
  price: string | null;
  priceNumber: number | null;
  observations: string | null;
};

export type FolderParsingResult = {
  relativePath: string;
  fileName: string;
  folders: string[];
  metadata: FolderParsingMetadata;
  warnings: string[];
  logs: string[];
};

export type FolderImportParsedItem = FolderParsingResult & {
  id: string;
  file: File;
};

export const DEFAULT_FOLDER_PARSING_RULES: FolderParsingRules = {
  artistLevel: 0,
  categoryLevel: 1,
  measuresPriceLevel: 2,
  observationsFromLevelsAfter: 3,
};

const IMAGE_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpeg|jpg|png|webp)$/i;

function compact(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .normalize("NFC")
    .replace(/[_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

function normalizePrice(value: string | null | undefined) {
  const raw = compact(value)?.replace(/[^\d,.-]/g, "") ?? "";
  const unsignedRaw = raw.replace(/^-+/, "");
  if (!unsignedRaw) return null;

  const lastComma = unsignedRaw.lastIndexOf(",");
  const lastDot = unsignedRaw.lastIndexOf(".");
  let normalized = unsignedRaw;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    normalized = unsignedRaw
      .replace(new RegExp(`\\${thousandSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    const [integerPart, decimalPart = ""] = unsignedRaw.split(",");
    normalized =
      decimalPart.length === 3 && integerPart.length <= 3
        ? unsignedRaw.replace(/,/g, "")
        : unsignedRaw.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = unsignedRaw.split(".");
    const decimalPart = parts.at(-1) ?? "";
    normalized =
      parts.length > 2 || (decimalPart.length === 3 && parts[0].length <= 3)
        ? unsignedRaw.replace(/\./g, "")
        : unsignedRaw;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMeasures(value: string | null | undefined) {
  const text = compact(value);
  if (!text) return null;

  const match = text.match(
    /(\d+(?:[,.]\d+)?)\s*(?:x|×)\s*(\d+(?:[,.]\d+)?)(?:\s*(?:cm|cms|centimetros))?/i,
  );
  if (!match) return null;

  const width = match[1].replace(",", ".");
  const height = match[2].replace(",", ".");

  return `${width}x${height} cm`;
}

function splitRelativePath(relativePath: string) {
  const cleanPath = relativePath.replace(/\\/g, "/");
  const parts = cleanPath.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? cleanPath;
  const folders = parts.slice(0, -1);

  return { cleanPath, fileName, folders };
}

function parseMeasuresAndPrice(segment: string | null) {
  const warnings: string[] = [];
  const logs: string[] = [];
  const measures = normalizeMeasures(segment);
  const withoutMeasures = compact(
    measures
      ? String(segment ?? "").replace(
          /(\d+(?:[,.]\d+)?)\s*(?:x|×)\s*(\d+(?:[,.]\d+)?)(?:\s*(?:cm|cms|centimetros))?/i,
          "",
        )
      : segment,
  );
  const priceNumber = normalizePrice(withoutMeasures);

  if (!measures) {
    warnings.push("No se detectaron medidas en la carpeta de nivel 3.");
  } else {
    logs.push(`Medidas detectadas: ${measures}`);
  }

  if (priceNumber == null) {
    warnings.push("No se detecto precio en la carpeta de nivel 3.");
  } else {
    logs.push(`Precio detectado: ${priceNumber}`);
  }

  return {
    measures,
    priceNumber,
    price: priceNumber == null ? null : String(priceNumber),
    warnings,
    logs,
  };
}

export function isSupportedImageFile(fileName: string) {
  return IMAGE_EXTENSION_PATTERN.test(fileName);
}

export function parseFolderImportPath(
  relativePath: string,
  rules: FolderParsingRules = DEFAULT_FOLDER_PARSING_RULES,
): FolderParsingResult {
  const { cleanPath, fileName, folders } = splitRelativePath(relativePath);
  const warnings: string[] = [];
  const logs: string[] = [];
  const artist = compact(folders[rules.artistLevel]);
  const category = compact(folders[rules.categoryLevel]);
  const measuresPrice = parseMeasuresAndPrice(
    folders[rules.measuresPriceLevel] ?? null,
  );
  const observationLevels = folders.slice(rules.observationsFromLevelsAfter ?? 3);
  const observations = compact(
    [category, ...observationLevels].filter(Boolean).join(" - "),
  );

  if (!artist) {
    warnings.push("No se detecto artista en el nivel configurado.");
  } else {
    logs.push(`Artista heredado: ${artist}`);
  }

  if (!category) {
    warnings.push("No se detecto tecnica/categoria en el nivel configurado.");
  } else {
    logs.push(`Categoria heredada: ${category}`);
  }

  warnings.push(...measuresPrice.warnings);
  logs.push(...measuresPrice.logs);

  if (!isSupportedImageFile(fileName)) {
    warnings.push("El archivo no parece una imagen soportada.");
  }

  return {
    relativePath: cleanPath,
    fileName,
    folders,
    metadata: {
      artist,
      category,
      sceneType: category,
      measures: measuresPrice.measures,
      price: measuresPrice.price,
      priceNumber: measuresPrice.priceNumber,
      observations,
    },
    warnings,
    logs,
  };
}

export function getFileRelativePath(file: File) {
  return (
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name
  );
}

export function buildFolderImportItems(
  files: File[],
  rules: FolderParsingRules = DEFAULT_FOLDER_PARSING_RULES,
): FolderImportParsedItem[] {
  return files
    .filter((file) => isSupportedImageFile(file.name))
    .map((file) => {
      const parsed = parseFolderImportPath(getFileRelativePath(file), rules);

      return {
        ...parsed,
        id: `${parsed.relativePath}-${file.lastModified}-${file.size}`,
        file,
      };
    });
}
