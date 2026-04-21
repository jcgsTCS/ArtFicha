export type PriceRangeInput = {
  min?: string | number | null;
  max?: string | number | null;
};

export type PriceEstimate = {
  min: number;
  max: number;
  recommended: number;
  technicalQualityScore: number;
  confidence: number;
  reasoning: string;
};

export type ArtworkPricingInput = {
  title: string;
  description: string;
  observations: string;
  category: string;
  sceneType: string;
  condition: number;
  qualityScore?: number;
  priceRange: PriceRangeInput;
};

function parsePrice(value?: string | number | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .trim();

  if (!raw) return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    normalized = raw
      .replace(new RegExp(`\\${thousandSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    const [integerPart, decimalPart = ""] = raw.split(",");
    normalized =
      decimalPart.length === 3 && integerPart.length <= 3
        ? raw.replace(/,/g, "")
        : raw.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = raw.split(".");
    const decimalPart = parts.at(-1) ?? "";
    normalized =
      parts.length > 2 || (decimalPart.length === 3 && parts[0].length <= 3)
        ? raw.replace(/\./g, "")
        : raw;
  }

  const parsed = Number.parseFloat(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function roundCommercialPrice(value: number) {
  const step = value >= 500 ? 10 : value >= 100 ? 5 : 1;
  return Math.max(step, Math.round(value / step) * step);
}

export function normalizePriceRange(input: PriceRangeInput) {
  const min = parsePrice(input.min);
  const max = parsePrice(input.max);

  if (min == null || max == null) return null;

  const low = Math.min(min, max);
  const high = Math.max(min, max);

  if (high <= 0 || high === low) return null;

  return { min: low, max: high };
}

export function getFallbackRangePrice(input: PriceRangeInput) {
  const range = normalizePriceRange(input);
  if (!range) return null;

  return roundCommercialPrice(range.min + (range.max - range.min) * 0.5);
}

function estimateTechnicalQuality(input: ArtworkPricingInput) {
  const text = normalizeText(
    [
      input.title,
      input.description,
      input.observations,
      input.category,
      input.sceneType,
    ].join(" "),
  );
  let score = 38;
  const reasons: string[] = [];

  const conditionScore = clamp(input.condition, 1, 5);
  score += conditionScore * 6;
  reasons.push(`estado ${conditionScore}/5`);

  const techniqueSignals = [
    { pattern: /\boleo\b|\bolio\b|lienzo|tabla/, points: 12, label: "tecnica pictorica con mas valor percibido" },
    { pattern: /acuarela|gouache|tempera/, points: 10, label: "tecnica pictorica delicada" },
    { pattern: /tinta|grafito|carboncillo|dibujo/, points: 7, label: "calidad de dibujo/trazo" },
    { pattern: /grabado|litografia|serigrafia/, points: 5, label: "obra grafica" },
    { pattern: /mixta|tecnica mixta|collage/, points: 8, label: "tecnica mixta" },
  ];

  for (const signal of techniqueSignals) {
    if (signal.pattern.test(text)) {
      score += signal.points;
      reasons.push(signal.label);
      break;
    }
  }

  const pictorialSignals = [
    { pattern: /composicion|equilibrio|estructura/, points: 6, label: "composicion descrita" },
    { pattern: /luz|sombra|contraste|claroscuro/, points: 5, label: "tratamiento de luz" },
    { pattern: /trazo|pincelada|mancha|lavado|veladura/, points: 7, label: "mano tecnica visible" },
    { pattern: /color|cromatico|tonos|paleta/, points: 5, label: "criterio cromatico" },
    { pattern: /figura|retrato|urbana|paisaje|marina|bodegon|escena/, points: 4, label: "motivo identificable" },
  ];

  for (const signal of pictorialSignals) {
    if (signal.pattern.test(text)) {
      score += signal.points;
      reasons.push(signal.label);
    }
  }

  const descriptionLength = input.description.replace(/\s+/g, " ").trim().length;
  if (descriptionLength >= 180) {
    score += 8;
    reasons.push("descripcion visual completa");
  } else if (descriptionLength >= 90) {
    score += 4;
    reasons.push("descripcion suficiente");
  }

  if (input.qualityScore != null) {
    score = score * 0.7 + clamp(input.qualityScore, 0, 100) * 0.3;
  }

  return {
    score: Math.round(clamp(score, 20, 96)),
    reasons: reasons.slice(0, 4),
  };
}

export function estimateArtworkPrice(
  input: ArtworkPricingInput,
): PriceEstimate | null {
  const range = normalizePriceRange(input.priceRange);
  if (!range) return null;

  const technical = estimateTechnicalQuality(input);
  const span = range.max - range.min;
  const qualityPosition = clamp((technical.score - 35) / 65, 0.08, 0.92);
  const recommended = roundCommercialPrice(range.min + span * qualityPosition);
  const relativeSpan = span / Math.max(range.max, 1);
  const confidence = Math.round(
    clamp(82 - relativeSpan * 22 + technical.score * 0.18, 45, 92),
  );

  return {
    min: range.min,
    max: range.max,
    recommended,
    technicalQualityScore: technical.score,
    confidence,
    reasoning: `Estimado dentro de tu rango por ${technical.reasons.join(", ")}.`,
  };
}
