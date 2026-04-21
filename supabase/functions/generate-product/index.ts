import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.49.1";

const allowedOrigin =
  Deno.env.get("ALLOWED_ORIGIN") ||
  Deno.env.get("ALLOWED_ORIGINS")?.split(",")[0]?.trim() ||
  "http://localhost:8080";

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_TC_SECTION = 130;
const GROQ_ANALYSIS_TIMEOUT_MS = Number(
  Deno.env.get("GROQ_ANALYSIS_TIMEOUT_MS") || 5500,
);

type GenerateProductBody = {
  draftId?: string;
  artist?: string;
  artworkTitle?: string;
  artwork_title?: string;
  measures?: string;
  price?: string | number;
  observations?: string;
  imageBase64?: string;
  image_base64?: string;
  imageUrl?: string;
  image_url?: string;
  sourceType?: "manual" | "single_upload" | "batch_upload" | "folder_import";
  sourcePath?: string | null;
  importBatchId?: string | null;
  inheritedArtist?: string | null;
  inheritedCategory?: string | null;
  inheritedMeasures?: string | null;
  inheritedPrice?: number | null;
  parsingWarnings?: string[];
  grokApiKey?: string;
  usePremiumAnalysis?: boolean;
  selectedSectionId?: number | null;
  analysis?: {
    artworkName?: string;
    artwork_name?: string;
    main_subject?: string;
    title?: string;
    description?: string;
    scene_type?: string;
    category?: string;
    condition?: number;
    condition_details?: string;
    technique?: string;
  };
};

type VisionAnalysis = {
  artwork_name?: string;
  main_subject?: string;
  title?: string;
  description?: string;
  scene_type?: string;
  category?: string;
  condition?: number;
  condition_details?: string;
  technique?: string;
};

type DraftRow = {
  id?: string;
  user_id: string;
  artist: string | null;
  measures: string | null;
  price: string | null;
  observations: string;
  image_url: string | null;
  artwork_name: string;
  title: string;
  description: string;
  scene_type: string | null;
  category: string | null;
  condition: number;
  condition_details: string;
  id_section: number | null;
  status: string;
  publication_status: string;
  source_type: string;
  source_path: string | null;
  import_batch_id: string | null;
  generated_title: string;
  final_title: string;
  generated_description: string;
  final_description: string;
  inherited_artist: string | null;
  inherited_category: string | null;
  inherited_measures: string | null;
  inherited_price: number | null;
  parsing_warnings: string[];
  publish_attempts: number;
  tc_last_error: string | null;
  generated_at: string;
  review_status: string;
  review_checklist: Record<string, boolean>;
  review_completed_at: string | null;
  quality_score: number;
  estimated_minutes_saved: number;
  manual_edit_count: number;
  generated_snapshot: Record<string, string | number | null>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function requireUserId(
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<string> {
  const authorization = req.headers.get("Authorization");

  if (!authorization) {
    throw new Error("Sesion no autenticada. Inicia sesion para generar fichas.");
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authorization },
    },
  });
  const { data, error } = await authClient.auth.getUser();

  if (error || !data.user) {
    throw new Error("Sesion no valida. Vuelve a iniciar sesion.");
  }

  return data.user.id;
}

async function enforceRateLimit(
  supabase: SupabaseClient,
  userId: string,
  eventType: string,
  maxEvents: number,
  windowSeconds: number,
) {
  const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from("app_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .gte("created_at", cutoff);

  if (error) throw error;

  if ((count ?? 0) >= maxEvents) {
    throw new Error(
      "Limite de uso alcanzado. Espera unos minutos antes de seguir generando.",
    );
  }

  const { error: insertError } = await supabase.from("app_events").insert({
    user_id: userId,
    event_type: eventType,
    severity: "info",
    message: "Uso registrado para control de limite.",
    metadata: { maxEvents, windowSeconds },
  });

  if (insertError) throw insertError;
}

function normalizeText(
  value: string | undefined | null,
  fallback = "",
): string {
  return (value ?? fallback).trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Groq tardo mas de ${Math.round(timeoutMs / 1000)}s en responder`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatGroqApiError(rawText: string, fallback: string): string {
  let message = rawText.trim();

  try {
    const parsed = JSON.parse(rawText) as {
      error?: {
        message?: string;
        type?: string;
      };
    };
    message = parsed.error?.message || message;
  } catch {
    // Groq can return plain text on some failures.
  }

  const normalized = message.toLowerCase();
  const retryMatch = message.match(/try again in\s*([\d.]+)\s*([smh]?)/i);
  const retryAmount = retryMatch ? Number.parseFloat(retryMatch[1]) : null;
  const retryUnit = retryMatch?.[2]?.toLowerCase() || "s";
  const retryText =
    retryAmount && Number.isFinite(retryAmount)
      ? retryUnit === "m"
        ? `${Math.ceil(retryAmount)} min`
        : retryUnit === "h"
          ? `${Math.ceil(retryAmount)} h`
          : `${Math.ceil(retryAmount)} s`
      : "unos segundos";

  if (
    normalized.includes("rate limit") ||
    normalized.includes("tokens per minute") ||
    normalized.includes("requests per minute") ||
    normalized.includes("on_demand")
  ) {
    return `Limite temporal de Groq alcanzado. Espera ${retryText} y reintenta, o anade otra API al desk para seguir sin parar. No se crea borrador porque la descripcion premium es obligatoria.`;
  }

  if (normalized.includes("invalid api key") || normalized.includes("unauthorized")) {
    return "La API de Groq no es valida o no tiene permisos. Revisa la clave del desk.";
  }

  return message || fallback;
}

function sentenceCase(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function compactMeasures(value: string): string {
  return value
    .replace(/\s*cent[ií]metros?/gi, " cm")
    .replace(/\s*cms?/gi, " cm")
    .replace(/\s*x\s*/gi, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTechnique(value: string): string {
  return value
    .replace(/sobre lienzo/gi, "lienzo")
    .replace(/sobre tabla/gi, "tabla")
    .replace(/sobre papel/gi, "papel")
    .replace(/técnica mixta/gi, "mixta")
    .trim();
}

function compactArtworkName(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 42) return cleaned;

  return cleaned
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

function buildPublicationTitle(parts: {
  artist: string;
  artworkName: string;
  observation: string;
  measures?: string;
}): string {
  return truncate(
    dedupeSegments([
      sentenceCase(normalizeText(parts.artist, "Autor no identificado")),
      sentenceCase(normalizeText(parts.artworkName, "Obra original")),
      compactMeasures(normalizeText(parts.measures)),
      sentenceCase(normalizeText(parts.observation, "Sin observacion")),
    ]).join(" - "),
    120,
  );
}

function cleanTitleCandidate(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*[-|,:;]+\s*$/g, "")
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .trim();
}

function stripTitleNoise(value: string): string {
  return cleanTitleCandidate(value)
    .replace(
      /\b(obra|pieza|cuadro|lamina|lámina|artwork|original|sin titulo|sin título)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericArtworkName(value: string): boolean {
  const normalized = stripTitleNoise(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!normalized) return true;

  const genericExactMatches = new Set([
    "obra",
    "obra de arte",
    "obra original",
    "pieza",
    "pieza original",
    "cuadro",
    "cuadro original",
    "lamina",
    "retrato",
    "paisaje",
    "marina",
    "bodegon",
    "abstracto",
    "composicion",
    "escena",
    "figura",
    "objeto",
    "sin titulo",
  ]);

  if (genericExactMatches.has(normalized)) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2) return true;

  const genericLead = /^(retrato|paisaje|marina|bodegon|abstracto|composicion|escena|figura|objeto)\b/;
  return genericLead.test(normalized) && words.length < 3;
}

function chooseSpecificArtworkName(candidates: string[]): string {
  for (const candidate of candidates) {
    const cleaned = compactArtworkName(stripTitleNoise(candidate));
    if (!cleaned || isGenericArtworkName(cleaned)) continue;
    return truncate(cleaned, 120);
  }

  return "";
}

function dedupeSegments(segments: string[]): string[] {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const normalized = segment.toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function extractJsonObject(value: string): string {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("La respuesta del analisis visual no contiene JSON valido");
  }

  return value.slice(start, end + 1);
}

function isWeakVisualDescription(value: string | undefined | null): boolean {
  const description = normalizeText(value).replace(/\s+/g, " ");
  const normalized = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (description.length < 70) return true;

  const looksLikeMetadataOnly =
    /\bmedidas\s*:/i.test(description) &&
    /\b(tecnica|observaciones)\s*:/i.test(description);
  const visualSignals = [
    "composicion",
    "escena",
    "figura",
    "paisaje",
    "calle",
    "arquitectura",
    "color",
    "luz",
    "trazo",
    "linea",
    "sombra",
    "fondo",
    "primer plano",
    "acuarela",
    "oleo",
    "grafito",
    "tinta",
    "papel",
    "personaje",
    "vegetacion",
    "puerto",
    "interior",
    "bodegon",
    "retrato",
    "desnudo",
  ];

  return (
    looksLikeMetadataOnly &&
    !visualSignals.some((signal) => normalized.includes(signal))
  );
}

async function analyzeArtworkFromImage(
  body: GenerateProductBody,
): Promise<VisionAnalysis | null> {
  if (!body.usePremiumAnalysis) return null;

  const apiKey =
    normalizeText(body.grokApiKey) || Deno.env.get("GROQ_API_KEY") || "";
  const image =
    normalizeText(body.imageBase64 ?? body.image_base64) ||
    normalizeText(body.imageUrl ?? body.image_url);

  if (!apiKey || !image) return null;

  const model =
    Deno.env.get("GROQ_VISION_MODEL") ||
    "meta-llama/llama-4-scout-17b-16e-instruct";
  const artist = normalizeText(body.artist);
  const observations = normalizeText(body.observations);
  const artworkTitle = normalizeText(body.artworkTitle ?? body.artwork_title);
  const measures = compactMeasures(normalizeText(body.measures));

  const userContext = [
    artist ? `- Artista aportado por el usuario: ${artist}` : "",
    artworkTitle ? `- Titulo aportado por el usuario: ${artworkTitle}` : "",
    observations ? `- Observaciones opcionales: ${observations}` : "",
    measures ? `- Medidas aportadas: ${measures}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `Mira la imagen y cataloga la obra para venta. Devuelve SOLO JSON valido.

Reglas:
- Basa titulo y descripcion en lo visible; el contexto solo ayuda.
- No inventes autoria, epoca, escuela, materiales ni detalles no visibles.
- artwork_name: motivo principal especifico en 2 a 6 palabras, no generico.
- main_subject: motivo visible en 2 a 5 palabras.
- title: comercial, claro y natural.
- description: texto comercial sobrio de 35 a 65 palabras. Debe describir escena, composicion, color, trazo/luz y tecnica aparente si se aprecia.
- No rellenes con solo medidas, tecnica u observaciones.
- Espanol, sin markdown.

Contexto:
${userContext || "- Sin contexto adicional relevante."}

Devuelve exactamente este JSON:
{
  "artwork_name": "string",
  "main_subject": "string",
  "title": "string",
  "description": "string",
  "scene_type": "string",
  "category": "string",
  "condition": 4,
  "condition_details": "string",
  "technique": "string"
}`;

  const imageInput = image.startsWith("data:")
    ? image
    : `data:image/jpeg;base64,${image}`;

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: 430,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageInput },
            },
            {
              type: "text",
              text:
                "Eres un especialista en catalogacion comercial de arte. Devuelves solo JSON valido, sin markdown ni texto adicional.\n\n" +
                prompt,
            },
          ],
        },
      ],
    }),
    },
    GROQ_ANALYSIS_TIMEOUT_MS,
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      formatGroqApiError(errorText, "No se pudo analizar la imagen con Groq"),
    );
  }

  const data = await response.json();
  const text =
    typeof data?.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content
      : Array.isArray(data?.choices?.[0]?.message?.content)
        ? data.choices[0].message.content
            .map((part: { text?: string }) => part.text || "")
            .filter(Boolean)
            .join("\n")
        : "";

  if (!text.trim()) {
    throw new Error("El analisis visual no devolvio contenido util");
  }

  const parsed = JSON.parse(extractJsonObject(text)) as VisionAnalysis;
  if (isWeakVisualDescription(parsed.description)) {
    throw new Error(
      "El analisis visual no genero una descripcion comercial basada en la imagen",
    );
  }

  return parsed;
}

function mergeAnalysis(
  body: GenerateProductBody,
  analysis: VisionAnalysis | null,
): GenerateProductBody {
  if (!analysis) return body;

  return {
    ...body,
    analysis: {
      ...analysis,
      ...body.analysis,
      artwork_name:
        normalizeText(body.analysis?.artwork_name) ||
        normalizeText(body.analysis?.artworkName) ||
        normalizeText(analysis.artwork_name),
      main_subject:
        normalizeText((body.analysis as VisionAnalysis | undefined)?.main_subject) ||
        normalizeText(analysis.main_subject),
      title: normalizeText(body.analysis?.title) || normalizeText(analysis.title),
      description:
        normalizeText(body.analysis?.description) ||
        normalizeText(analysis.description),
      scene_type:
        normalizeText(body.analysis?.scene_type) ||
        normalizeText(analysis.scene_type),
      category:
        normalizeText(body.analysis?.category) ||
        normalizeText(analysis.category),
      condition:
        typeof body.analysis?.condition === "number"
          ? body.analysis.condition
          : analysis.condition,
      condition_details:
        normalizeText(body.analysis?.condition_details) ||
        normalizeText(analysis.condition_details),
      technique:
        normalizeText(body.analysis?.technique) ||
        normalizeText(analysis.technique),
    },
  };
}

function buildSaleDescription(input: {
  artist: string;
  artworkName: string;
  measures: string;
  technique: string;
  observations: string;
}) {
  const artist = normalizeText(input.artist, "Autor no identificado");
  const artworkName = normalizeText(input.artworkName, "obra");
  const measures = normalizeText(input.measures, "medida sin indicar");
  const technique = normalizeText(input.technique);
  const observations = normalizeText(input.observations);

  const parts = [
    `${artworkName} de ${artist}.`,
    measures ? `Medidas: ${measures}.` : "",
    technique ? `Técnica: ${technique}.` : "",
    observations && observations !== technique
      ? `Observaciones: ${observations}.`
      : "",
  ].filter(Boolean);

  return truncate(parts.join(" "), 1200);
}

function buildGenericArtworkTitle(observations: string, technique: string): string {
  const cleanedObservations = normalizeText(observations)
    .replace(/\b(óleo|oleo|acuarela|grabado|grafito|tinta|mixta|lienzo|tabla|papel)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanedObservations.length > 0) {
    if (cleanedObservations.split(/\s+/).filter(Boolean).length === 1) {
      return `${compactArtworkName(cleanedObservations)} original`;
    }

    return compactArtworkName(cleanedObservations);
  }

  if (technique) {
    return technique.includes("lienzo") || technique.includes("tabla")
      ? "Obra original"
      : compactArtworkName(technique);
  }

  return "Obra original";
}

function normalizePrice(value: string | number | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value.toFixed(2);
  }

  if (typeof value === "string") {
    const cleaned = value.replace(",", ".").trim();
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed.toFixed(2);
    }
  }

  return null;
}

function inferTechnique(body: GenerateProductBody): string {
  const explicit = normalizeText(body.analysis?.technique);
  if (explicit) return explicit;

  const obs = normalizeText(body.observations).toLowerCase();
  if (obs.includes("óleo") || obs.includes("oleo")) return "óleo sobre lienzo";
  if (obs.includes("acuarela")) return "acuarela sobre papel";
  if (obs.includes("grabado")) return "grabado";
  if (obs.includes("grafito")) return "grafito sobre papel";
  if (obs.includes("tinta")) return "tinta sobre papel";
  if (obs.includes("mixta")) return "técnica mixta";

  return "";
}

function buildArtworkName(body: GenerateProductBody): string {
  const userTitle = normalizeText(body.artworkTitle ?? body.artwork_title);
  const analysisName = normalizeText(
    body.analysis?.artworkName ?? body.analysis?.artwork_name,
  );
  const analysisSubject = normalizeText(
    (body.analysis as VisionAnalysis | undefined)?.main_subject,
  );
  const analysisTitle = normalizeText(body.analysis?.title);
  const specificName = chooseSpecificArtworkName([
    analysisName,
    analysisSubject,
    analysisTitle,
    userTitle,
  ]);

  if (specificName) return specificName;

  const observations = normalizeText(body.observations);
  const technique = compactTechnique(inferTechnique(body));
  const fallbackName = chooseSpecificArtworkName([
    buildGenericArtworkTitle(observations, technique),
    normalizeText(body.analysis?.scene_type),
  ]);

  if (fallbackName) {
    return fallbackName;
  }

  if (technique) {
    return `${compactArtworkName(technique)} original`;
  }

  return "Obra original";
}

function buildValidTitle(body: GenerateProductBody): string {
  const artist = normalizeText(body.artist, "Autor no identificado");
  const generatedTitle =
    chooseSpecificArtworkName([
      normalizeText(body.analysis?.artwork_name),
      normalizeText(body.analysis?.artworkName),
      normalizeText((body.analysis as VisionAnalysis | undefined)?.main_subject),
      normalizeText(body.analysis?.title),
      buildArtworkName(body),
    ]) || buildArtworkName(body);
  const observation = cleanTitleCandidate(
    normalizeText(body.observations) ||
      compactTechnique(inferTechnique(body)) ||
      "sin observacion",
  );

  return buildPublicationTitle({
    artist,
    artworkName: generatedTitle,
    measures: compactMeasures(normalizeText(body.measures)),
    observation,
  });
}

function buildDescription(body: GenerateProductBody): string {
  const analysisDescription = normalizeText(body.analysis?.description);
  if (analysisDescription && !isWeakVisualDescription(analysisDescription)) {
    return truncate(analysisDescription, 1200);
  }

  if (body.usePremiumAnalysis) {
    throw new Error(
      "El analisis premium no devolvio una descripcion visual util. No se generara una descripcion basica.",
    );
  }

  const artist = normalizeText(body.artist, "Autor no identificado");
  const measures = normalizeText(body.measures, "medida sin indicar");
  const technique = compactTechnique(inferTechnique(body));
  const observations = normalizeText(body.observations);
  const artworkName = buildArtworkName(body);

  return buildSaleDescription({
    artist,
    artworkName,
    measures,
    technique: technique || observations,
    observations,
  });
}

function normalizeCondition(value: number | undefined): number {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return 4;
}

function buildConditionDetails(body: GenerateProductBody): string {
  const details = normalizeText(body.analysis?.condition_details);

  if (details.length > 0) {
    return truncate(details, 100);
  }

  return "Buen estado general";
}

function buildObservations(body: GenerateProductBody): string {
  const obs = normalizeText(body.observations);

  if (obs.length > 0) {
    return truncate(obs, 150);
  }

  return "Sin observaciones adicionales.";
}

function normalizeSectionId(value: number | null | undefined): number | null {
  const id = Number(value);
  if (Number.isInteger(id) && id > 0) return id;
  return DEFAULT_TC_SECTION;
}

function buildDraftRow(body: GenerateProductBody, userId: string): DraftRow {
  const inheritedCategory = normalizeText(body.inheritedCategory);
  const title = buildValidTitle(body);
  const description = buildDescription(body);
  const draft = {
    user_id: userId,
    artist: normalizeText(body.artist ?? body.inheritedArtist) || null,
    measures: normalizeText(body.measures ?? body.inheritedMeasures) || null,
    price: normalizePrice(body.price),
    observations: buildObservations(body),
    image_url: normalizeText(body.imageUrl ?? body.image_url) || null,
    artwork_name: buildArtworkName(body),
    title,
    description,
    scene_type:
      inheritedCategory || normalizeText(body.analysis?.scene_type) || "objeto",
    category: inheritedCategory || normalizeText(body.analysis?.category) || "Arte",
    condition: normalizeCondition(body.analysis?.condition),
    condition_details: buildConditionDetails(body),
    id_section: normalizeSectionId(body.selectedSectionId),
    status: "pending_review",
    publication_status: "pending_review",
    source_type: body.sourceType || "single_upload",
    source_path: normalizeText(body.sourcePath) || null,
    import_batch_id: normalizeText(body.importBatchId) || null,
    generated_title: title,
    final_title: title,
    generated_description: description,
    final_description: description,
    inherited_artist: normalizeText(body.inheritedArtist) || null,
    inherited_category: inheritedCategory || null,
    inherited_measures: normalizeText(body.inheritedMeasures) || null,
    inherited_price:
      typeof body.inheritedPrice === "number" && Number.isFinite(body.inheritedPrice)
        ? body.inheritedPrice
        : null,
    parsing_warnings: Array.isArray(body.parsingWarnings)
      ? body.parsingWarnings
      : [],
    publish_attempts: 0,
    tc_last_error: null,
  };

  return {
    ...draft,
    generated_at: new Date().toISOString(),
    review_status: "pending_review",
    review_checklist: {
      imageChecked: false,
      titleChecked: false,
      descriptionChecked: false,
      categoryChecked: false,
      priceChecked: false,
    },
    review_completed_at: null,
    quality_score: 0,
    estimated_minutes_saved: 0,
    manual_edit_count: 0,
    generated_snapshot: {
      artworkName: draft.artwork_name,
      title: draft.title,
      description: draft.description,
      category: draft.category,
      price: draft.price,
      observations: draft.observations,
      condition: draft.condition,
      conditionDetails: draft.condition_details,
      sceneType: draft.scene_type,
      idSection: draft.id_section,
    },
  };
}

async function upsertDraft(
  supabase: SupabaseClient,
  body: GenerateProductBody,
  row: DraftRow,
  userId: string,
): Promise<{ id: string }> {
  if (body.draftId) {
    const { data, error } = await supabase
      .from("art_drafts")
      .update(row)
      .eq("id", body.draftId)
      .eq("user_id", userId)
      .select("id")
      .single();

    if (error) throw error;
    return data as { id: string };
  }

  const { data, error } = await supabase
    .from("art_drafts")
    .insert(row)
    .select("id")
    .single();

  if (error) throw error;
  return data as { id: string };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Método no permitido" },
      405,
    );
  }

  try {
    const body = (await req.json()) as GenerateProductBody;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse(
        {
          success: false,
          error: "Falta configuración de Supabase en variables de entorno",
        },
        500,
      );
    }
    const userId = await requireUserId(req, supabaseUrl, supabaseAnonKey);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    if (Deno.env.get("ENABLE_APP_RATE_LIMITS") === "true") {
      await enforceRateLimit(supabase, userId, "generate_product", 120, 3600);
    }

    const visionAnalysis = await analyzeArtworkFromImage(body);
    if (body.usePremiumAnalysis && !visionAnalysis) {
      return jsonResponse(
        {
          success: false,
          error:
            "El analisis premium no devolvio descripcion util. No se generara una descripcion basica.",
        },
        400,
      );
    }
    const enrichedBody = mergeAnalysis(body, visionAnalysis);
    const row = buildDraftRow(enrichedBody, userId);
    const saved = await upsertDraft(supabase, enrichedBody, row, userId);
    const draft = {
      ...row,
      id: saved.id,
    };

    return jsonResponse({
      success: true,
      draftId: saved.id,
      draft,
      ...draft,
    });
  } catch (error) {
    console.error("generate-product error:", error);

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido al generar el borrador",
      },
      500,
    );
  }
});
