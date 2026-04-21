export type ReviewChecklist = {
  imageChecked: boolean;
  titleChecked: boolean;
  descriptionChecked: boolean;
  categoryChecked: boolean;
  priceChecked: boolean;
};

export type GeneratedDraftSnapshot = {
  artworkName: string;
  title: string;
  description: string;
  category: string;
  price: string;
  observations: string;
  condition: number;
  conditionDetails: string;
  sceneType: string;
  idSection: number | null;
};

export type ProductReadinessInput = {
  artworkName: string;
  title: string;
  description: string;
  category: string;
  price: string;
  observations: string;
  condition: number;
  conditionDetails: string;
  sceneType: string;
  idSection: number | null;
  imagePreview?: string | null;
  artist?: string | null;
  reviewChecklist?: Partial<ReviewChecklist> | null;
};

export type ProductReadinessResult = {
  score: number;
  status: "excellent" | "solid" | "review" | "risk";
  blockers: string[];
  cautions: string[];
  strengths: string[];
  checklist: ReviewChecklist;
  checklistProgress: number;
  isReviewComplete: boolean;
  isReadyToPublish: boolean;
};

export const DEFAULT_REVIEW_CHECKLIST: ReviewChecklist = {
  imageChecked: false,
  titleChecked: false,
  descriptionChecked: false,
  categoryChecked: false,
  priceChecked: false,
};

export function normalizeReviewChecklist(
  value?: Partial<ReviewChecklist> | null,
): ReviewChecklist {
  return {
    imageChecked: value?.imageChecked === true,
    titleChecked: value?.titleChecked === true,
    descriptionChecked: value?.descriptionChecked === true,
    categoryChecked: value?.categoryChecked === true,
    priceChecked: value?.priceChecked === true,
  };
}

function hasValidPrice(price: string) {
  const normalized = price.replace(",", ".").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0;
}

function normalizedLength(value: string) {
  return value.replace(/\s+/g, " ").trim().length;
}

function normalizeForQuality(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isGenericCommercialText(value: string) {
  const normalized = normalizeForQuality(value);
  if (!normalized) return true;

  return [
    "obra de arte",
    "obra de arte original",
    "obra original",
    "cuadro original",
    "pieza original",
    "sin titulo",
    "sin titulo original",
  ].some((generic) => normalized === generic || normalized.includes(generic));
}

function hasRepeatedPhrases(value: string) {
  const normalized = normalizeForQuality(value);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 16) return false;

  const seen = new Set<string>();
  for (let index = 0; index <= words.length - 4; index += 1) {
    const phrase = words.slice(index, index + 4).join(" ");
    if (seen.has(phrase)) return true;
    seen.add(phrase);
  }

  return false;
}

export function buildGeneratedSnapshot(
  input: ProductReadinessInput,
): GeneratedDraftSnapshot {
  return {
    artworkName: input.artworkName,
    title: input.title,
    description: input.description,
    category: input.category,
    price: input.price,
    observations: input.observations,
    condition: input.condition,
    conditionDetails: input.conditionDetails,
    sceneType: input.sceneType,
    idSection: input.idSection,
  };
}

export function countManualEdits(
  input: ProductReadinessInput,
  snapshot?: GeneratedDraftSnapshot | null,
) {
  if (!snapshot) return 0;

  let edits = 0;

  if (snapshot.artworkName !== input.artworkName) edits += 1;
  if (snapshot.title !== input.title) edits += 1;
  if (snapshot.description !== input.description) edits += 1;
  if (snapshot.category !== input.category) edits += 1;
  if (snapshot.price !== input.price) edits += 1;
  if (snapshot.observations !== input.observations) edits += 1;
  if (snapshot.condition !== input.condition) edits += 1;
  if (snapshot.conditionDetails !== input.conditionDetails) edits += 1;
  if (snapshot.sceneType !== input.sceneType) edits += 1;
  if (snapshot.idSection !== input.idSection) edits += 1;

  return edits;
}

export function estimateMinutesSaved(params: {
  score: number;
  manualEditCount: number;
  publicationStatus?: string;
}) {
  const baseMinutes = 6;
  const qualityBonus = params.score >= 85 ? 2 : params.score >= 70 ? 1 : 0;
  const publishBonus = params.publicationStatus === "published" ? 2 : 0;
  const editPenalty = Math.min(4, params.manualEditCount);

  return Math.max(1, baseMinutes + qualityBonus + publishBonus - editPenalty);
}

export function evaluateProductReadiness(
  input: ProductReadinessInput,
): ProductReadinessResult {
  const checklist = normalizeReviewChecklist(input.reviewChecklist);
  const blockers: string[] = [];
  const cautions: string[] = [];
  const strengths: string[] = [];
  let score = 0;

  if (input.imagePreview) {
    score += 12;
    strengths.push("La obra tiene imagen lista para revisar.");
  } else {
    blockers.push("Falta la imagen de la obra.");
  }

  const artworkNameLength = normalizedLength(input.artworkName);
  if (artworkNameLength >= 4) {
    score += artworkNameLength >= 8 ? 10 : 6;
  } else {
    blockers.push("El nombre de obra sigue demasiado vacio o generico.");
  }

  const titleLength = normalizedLength(input.title);
  if (isGenericCommercialText(input.title)) {
    blockers.push("El titulo es demasiado generico y no debe publicarse asi.");
  } else if (titleLength >= 30 && titleLength <= 120) {
    score += 18;
    strengths.push("El titulo ya tiene longitud comercial util.");
  } else if (titleLength >= 18) {
    score += 10;
    cautions.push("El titulo existe, pero aun puede quedar mas fino.");
  } else {
    blockers.push("El titulo aun no es lo bastante claro para publicar.");
  }

  const descriptionLength = normalizedLength(input.description);
  if (descriptionLength === 0) {
    blockers.push("Falta la descripcion de la obra.");
  } else if (isGenericCommercialText(input.description)) {
    score += descriptionLength >= 45 ? 10 : 6;
    cautions.push(
      "La descripcion suena generica; revisala si quieres afinarla, pero no debe bloquear la publicacion.",
    );
  } else if (descriptionLength >= 90) {
    score += 18;
    strengths.push("La descripcion ya explica la obra con suficiente contexto.");
  } else if (descriptionLength >= 45) {
    score += 10;
    cautions.push("La descripcion existe, pero se queda algo corta.");
  } else {
    blockers.push("La descripcion es demasiado corta para inspirar confianza.");
  }

  if (normalizedLength(input.category) >= 3) {
    score += 8;
  } else {
    blockers.push("La categoria no esta bien definida.");
  }

  if (hasValidPrice(input.price)) {
    score += 8;
  } else {
    blockers.push("El precio no es valido.");
  }

  if (input.idSection != null && Number.isInteger(Number(input.idSection))) {
    score += 8;
  } else {
    blockers.push("Falta la seccion de Todocoleccion.");
  }

  if (normalizedLength(input.conditionDetails) >= 10) {
    score += 6;
  } else {
    cautions.push("El estado necesita una nota algo mas concreta.");
  }

  if (normalizedLength(input.observations) >= 6) {
    score += 4;
  }

  if (normalizedLength(input.artist ?? "") >= 2) {
    score += 4;
  }

  if (normalizedLength(input.sceneType) >= 3) {
    score += 4;
  }

  const checkedCount = Object.values(checklist).filter(Boolean).length;
  const checklistProgress = Math.round(
    (checkedCount / Object.keys(DEFAULT_REVIEW_CHECKLIST).length) * 100,
  );

  if (checkedCount >= 5) {
    score += 10;
    strengths.push("La revision humana esta completa.");
  } else if (checkedCount >= 3) {
    score += 4;
    cautions.push("La revision humana va encaminada, pero aun no esta cerrada.");
  } else {
    cautions.push("La ficha aun no ha pasado una revision humana completa.");
  }

  if (normalizedLength(input.description) > 240) {
    strengths.push("La descripcion ya tiene densidad suficiente para venta seria.");
  }

  if (hasRepeatedPhrases(input.description)) {
    score -= 8;
    cautions.push("La descripcion contiene repeticiones y puede parecer generada sin control.");
  }

  if (/\b(atribuido a|firmado por|siglo|escuela de)\b/i.test(input.description)) {
    cautions.push(
      "Hay afirmaciones de autoria, firma, epoca o escuela: confirmalas antes de publicar.",
    );
  }

  score = Math.max(0, Math.min(100, score));

  const isReviewComplete = checkedCount === Object.keys(DEFAULT_REVIEW_CHECKLIST).length;
  const isReadyToPublish = blockers.length === 0 && isReviewComplete && score >= 75;
  const status = score >= 90
    ? "excellent"
    : score >= 75
      ? "solid"
      : score >= 55
        ? "review"
        : "risk";

  return {
    score,
    status,
    blockers,
    cautions,
    strengths,
    checklist,
    checklistProgress,
    isReviewComplete,
    isReadyToPublish,
  };
}
