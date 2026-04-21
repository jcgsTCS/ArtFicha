import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import type { ViteDevServer } from "vite";

const TC_BASE_URL = "https://www.todocoleccion.net/app/tcolapi/1.0";
const DEFAULT_TC_SECTION = 130;
const GROQ_ANALYSIS_TIMEOUT_MS = 5500;

function normalizeText(value: string | undefined | null, fallback = ""): string {
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

function formatGroqApiError(rawText: string, fallback: string) {
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
    // Groq sometimes returns plain text; keep the original text.
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
  return cleaned.split(" ").slice(0, 6).join(" ");
}

function cleanTitleCandidate(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*[-|,:;]+\s*$/g, "")
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .trim();
}

function stripTitleNoise(value: string) {
  return cleanTitleCandidate(value)
    .replace(
      /\b(obra|pieza|cuadro|lamina|lámina|artwork|original|sin titulo|sin título)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericArtworkName(value: string) {
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

function chooseSpecificArtworkName(candidates: string[]) {
  for (const candidate of candidates) {
    const cleaned = compactArtworkName(stripTitleNoise(candidate));
    if (!cleaned || isGenericArtworkName(cleaned)) continue;
    return truncate(cleaned, 120);
  }

  return "";
}

function isWeakVisualDescription(value: string | undefined | null) {
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

function sentenceCase(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function dedupeSegments(segments: string[]) {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const normalized = segment.toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildPublicationTitle(parts: {
  artist: string;
  artworkName: string;
  observation: string;
  measures?: string;
}) {
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
    return compactArtworkName(cleanedObservations);
  }

  if (technique) {
    return technique.includes("lienzo") || technique.includes("tabla")
      ? "Obra original"
      : compactArtworkName(technique);
  }

  return "Obra original";
}

async function validateGrokApiKey(apiKey: string) {
  const model = "meta-llama/llama-4-scout-17b-16e-instruct";
  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 20,
      messages: [
        {
          role: "user",
          content: "Responde solo con OK",
        },
      ],
    }),
    },
    GROQ_ANALYSIS_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatGroqApiError(text, "No se pudo validar la API de Groq"));
  }

  return { valid: true, model, message: "API de Groq validada correctamente" };
}

async function detectImageOrientationWithGrok(body: {
  imageBase64?: string;
  image_base64?: string;
  grokApiKey?: string;
  variants?: Array<{
    rotationDegrees?: number;
    imageBase64?: string;
  }>;
}) {
  if (!normalizeText(body.grokApiKey)) {
    throw new Error("Falta la API key de Groq para usar el autogiro inteligente");
  }

  const image = normalizeText(body.imageBase64 ?? body.image_base64);
  if (!image) {
    throw new Error("Falta la imagen para analizar la orientacion");
  }

  const model = "meta-llama/llama-4-scout-17b-16e-instruct";
  const variants = Array.isArray(body.variants)
    ? body.variants
        .map((variant) => {
          const roundedRotation =
            Math.round(Number(variant.rotationDegrees || 0) / 90) * 90;
          const normalizedRotation = ((roundedRotation % 360) + 360) % 360;

          return {
            rotationDegrees:
              normalizedRotation === 90 ||
              normalizedRotation === 180 ||
              normalizedRotation === 270
                ? normalizedRotation
                : 0,
            imageBase64: normalizeText(variant.imageBase64),
          };
        })
        .filter((variant) => variant.imageBase64.length > 0)
    : [];
  const prompt = variants.length > 0
    ? `Vas a recibir una imagen original y varias variantes ya giradas.

Objetivo:
- Elegir cual de las variantes se ve visualmente correcta para un humano.
- "rotation_degrees" debe indicar la variante elegida, es decir, cuantos grados en sentido horario hay que girar la imagen original para verla bien.
- "minor_correction_degrees" es un ajuste fino adicional DESPUES de elegir la variante, entre -8 y 8 grados. Si no hace falta o no estas seguro, devuelve 0.

Reglas:
- Elige segun orientacion visual real: figuras, texto, marcos, horizonte, arquitectura, objetos apoyados y composicion natural.
- Si ninguna variante mejora claramente la imagen original, devuelve 0.
- Se conservador: si hay duda, no gires.
- "confidence" va de 0 a 1.
- "rotation_degrees" debe ser exactamente uno de estos valores: 0, 90, 180, 270.
- "reason" debe ser una frase breve en espanol.

Devuelve exactamente:
{
  "rotation_degrees": 0,
  "confidence": 0.0,
  "minor_correction_degrees": 0,
  "reason": "string"
}`
    : `Analiza solo la orientacion visual de la imagen para verla correctamente en pantalla.

Debes decidir cuantos grados EN SENTIDO HORARIO hay que girar la imagen actual para que quede bien colocada para un humano.

Reglas:
- "rotation_degrees" debe ser exactamente uno de estos valores: 0, 90, 180, 270.
- Usa 0 si la imagen ya esta bien colocada o si no estas claramente seguro.
- Se conservador: si hay duda, no gires.
- Fijate en figuras humanas, marcos, texto, objetos apoyados, lineas de horizonte, arquitectura y composicion natural.
- "confidence" debe ir de 0 a 1.
- "minor_correction_degrees" es opcional y sirve para una inclinacion fina adicional, entre -8 y 8 grados. Si no hace falta o no estas seguro, devuelve 0.
- "reason" debe ser una frase breve en espanol.

Devuelve exactamente:
{
  "rotation_degrees": 0,
  "confidence": 0.0,
  "minor_correction_degrees": 0,
  "reason": "string"
}`;
  const visionContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  if (variants.length > 0) {
    visionContent.push({
      type: "text",
      text:
        "Imagen original tal como llega ahora. Usa esta referencia para comparar las variantes.",
    });
    visionContent.push({
      type: "image_url",
      image_url: { url: image },
    });

    for (const [index, variant] of variants.entries()) {
      const label = ["A", "B", "C", "D"][index] || `V${index + 1}`;
      visionContent.push({
        type: "text",
        text:
          `Variante ${label}. Esta version ya esta girada ${variant.rotationDegrees} grados en sentido horario respecto a la imagen original.`,
      });
      visionContent.push({
        type: "image_url",
        image_url: { url: variant.imageBase64 },
      });
    }
  } else {
    visionContent.push({
      type: "image_url",
      image_url: { url: image },
    });
  }

  visionContent.push({
    type: "text",
    text:
      "Eres un asistente que solo decide la orientacion correcta de imagenes. Devuelves solo JSON valido.\n\n" +
      prompt,
  });

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${body.grokApiKey?.trim()}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: variants.length > 0 ? 320 : 250,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: visionContent,
          },
        ],
      }),
    },
    GROQ_ANALYSIS_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      formatGroqApiError(text, "No se pudo analizar la orientacion con Groq"),
    );
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
      };
    }>;
  };
  const content =
    typeof data.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content
      : Array.isArray(data.choices?.[0]?.message?.content)
        ? data.choices[0].message.content
            .map((part) => part.text || "")
            .filter(Boolean)
            .join("\n")
        : "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("Grok no devolvio JSON valido para la orientacion");
  }

  const parsed = JSON.parse(content.slice(start, end + 1)) as {
    rotation_degrees?: number;
    confidence?: number;
    minor_correction_degrees?: number;
    reason?: string;
  };
  const roundedRotation = Math.round(Number(parsed.rotation_degrees || 0) / 90) * 90;
  const normalizedRotation = ((roundedRotation % 360) + 360) % 360;

  return {
    rotationDegrees:
      normalizedRotation === 90 ||
      normalizedRotation === 180 ||
      normalizedRotation === 270
        ? normalizedRotation
        : 0,
    confidence: Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1),
    minorCorrectionDegrees: Math.min(
      Math.max(Number(parsed.minor_correction_degrees) || 0, -8),
      8,
    ),
    reason: normalizeText(parsed.reason) || "Orientacion analizada con IA",
  };
}

async function analyzeArtworkWithGrok(body: {
  artist?: string;
  artworkTitle?: string;
  artwork_title?: string;
  measures?: string;
  observations?: string;
  imageBase64?: string;
  image_base64?: string;
  grokApiKey?: string;
  usePremiumAnalysis?: boolean;
}) {
  if (!body.usePremiumAnalysis || !normalizeText(body.grokApiKey)) return null;

  const image = normalizeText(body.imageBase64 ?? body.image_base64);
  if (!image) return null;

  const artist = normalizeText(body.artist);
  const artworkTitle = normalizeText(body.artworkTitle ?? body.artwork_title);
  const observations = normalizeText(body.observations);
  const measures = compactMeasures(normalizeText(body.measures));

  const prompt = `Mira la imagen y cataloga la obra para venta. Devuelve SOLO JSON valido.

Reglas:
- Basa titulo y descripcion en lo visible; el contexto solo ayuda.
- No inventes autoria, epoca, escuela, materiales ni detalles no visibles.
- artwork_name: motivo principal especifico en 2 a 6 palabras, no generico.
- main_subject: motivo visible en 2 a 5 palabras.
- description: texto comercial sobrio de 35 a 65 palabras. Debe describir escena, composicion, color, trazo/luz y tecnica aparente si se aprecia.
- No rellenes con solo medidas, tecnica u observaciones.
- Espanol, sin markdown.

Contexto:
- Artista: ${artist || "no indicado"}
- Titulo aportado: ${artworkTitle || "no indicado"}
- Observaciones: ${observations || "no indicadas"}
- Medidas: ${measures || "no indicadas"}

Devuelve exactamente:
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

  const model = "meta-llama/llama-4-scout-17b-16e-instruct";
  const imageInput = image.startsWith("data:")
    ? image
    : `data:image/jpeg;base64,${image}`;
  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${body.grokApiKey?.trim()}`,
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
                "Eres un especialista en catalogacion comercial de arte. Devuelves solo JSON valido.\n\n" +
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
    const text = await response.text();
    throw new Error(
      formatGroqApiError(text, "No se pudo analizar la imagen con Groq"),
    );
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
      };
    }>;
  };
  const content =
    typeof data.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content
      : Array.isArray(data.choices?.[0]?.message?.content)
        ? data.choices[0].message.content
            .map((part) => part.text || "")
            .filter(Boolean)
            .join("\n")
        : "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("Grok no devolvio JSON valido");
  }

  const parsed = JSON.parse(content.slice(start, end + 1)) as {
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

  if (isWeakVisualDescription(parsed.description)) {
    throw new Error(
      "Grok no genero una descripcion comercial basada en la imagen",
    );
  }

  return parsed;
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function tcFetch(
  pathname: string,
  credentials: { userId: string; apiKey: string },
) {
  const response = await fetch(`${TC_BASE_URL}${pathname}`, {
    method: "GET",
    headers: {
      apikey: credentials.apiKey.trim(),
      iduser: credentials.userId.trim(),
      Accept: "application/json",
    },
  });

  const text = await response.text();

  try {
    return { response, data: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { response, data: { raw: text } };
  }
}

function inferTechnique(observations: string) {
  const lowerObs = observations.toLowerCase();
  if (lowerObs.includes("óleo") || lowerObs.includes("oleo")) {
    return "óleo sobre lienzo";
  }
  if (lowerObs.includes("acuarela")) return "acuarela sobre papel";
  if (lowerObs.includes("grabado")) return "grabado";
  if (lowerObs.includes("grafito")) return "grafito sobre papel";
  if (lowerObs.includes("tinta")) return "tinta sobre papel";
  if (lowerObs.includes("mixta")) return "técnica mixta";
  return "";
}

function createDraft(body: {
  artist?: string;
  artworkTitle?: string;
  artwork_title?: string;
  measures?: string;
  price?: string;
  observations?: string;
  imageBase64?: string;
  image_base64?: string;
  grokApiKey?: string;
  usePremiumAnalysis?: boolean;
}) {
  const artist = normalizeText(body.artist);
  const userArtworkTitle = normalizeText(body.artworkTitle ?? body.artwork_title);
  const measures = normalizeText(body.measures);
  const observations = normalizeText(body.observations);
  const price = normalizeText(body.price, "0");
  const technique = compactTechnique(inferTechnique(observations));
  const artworkName =
    chooseSpecificArtworkName([
      userArtworkTitle,
      buildGenericArtworkTitle(observations, technique),
    ]) || "Motivo sin identificar";
  const title = buildPublicationTitle({
    artist,
    artworkName,
    measures,
    observation: observations || technique || "sin observacion",
  });

  return {
    id: `draft-${Date.now()}`,
    artist,
    measures,
    price,
    observations: observations || "Sin observaciones adicionales.",
    artwork_name: artworkName,
    title,
    description: buildSaleDescription({
      artist,
      artworkName,
      measures,
      technique: technique || observations,
      observations,
    }),
    scene_type: "objeto",
    category: "Arte",
    condition: 4,
    condition_details: "Buen estado general",
    id_section: DEFAULT_TC_SECTION,
    status: "draft",
    publication_status: "not_published",
  };
}

function todocoleccionDevApi() {
  return {
    name: "todocoleccion-dev-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || !req.url) {
          next();
          return;
        }

        try {
          if (req.url === "/api/generate-product") {
            const body = await readJsonBody(req);
            const draft = createDraft(body);
            let visualAnalysis: Awaited<
              ReturnType<typeof analyzeArtworkWithGrok>
            > = null;
            let visualError = "";

            try {
              visualAnalysis = await analyzeArtworkWithGrok(body);
            } catch (error) {
              visualError =
                error instanceof Error
                  ? error.message
                  : "Groq no devolvio un analisis visual valido";
            }

            if (body?.usePremiumAnalysis && !visualAnalysis) {
              sendJson(res, 400, {
                success: false,
                error:
                  visualError ||
                  "El analisis visual premium esta activado, pero Groq no devolvio un analisis valido de la imagen.",
              });
              return;
            }
            const enrichedDraft = visualAnalysis
              ? {
                  ...draft,
                  artwork_name:
                    chooseSpecificArtworkName([
                      normalizeText(visualAnalysis.artwork_name),
                      normalizeText(visualAnalysis.main_subject),
                      normalizeText(visualAnalysis.title),
                      draft.artwork_name,
                    ]) || draft.artwork_name,
                  title: buildPublicationTitle({
                    artist: normalizeText(body.artist),
                    artworkName:
                      chooseSpecificArtworkName([
                        normalizeText(visualAnalysis.artwork_name),
                        normalizeText(visualAnalysis.main_subject),
                        normalizeText(visualAnalysis.title),
                        draft.artwork_name,
                      ]) || draft.artwork_name,
                    measures: compactMeasures(normalizeText(body.measures)),
                    observation:
                      normalizeText(body.observations) ||
                      draft.observations ||
                      "sin observacion",
                  }),
                  description:
                    normalizeText(visualAnalysis.description) ||
                    draft.description,
                  scene_type:
                    normalizeText(visualAnalysis.scene_type) ||
                    draft.scene_type,
                  category:
                    normalizeText(visualAnalysis.category) || draft.category,
                  condition:
                    typeof visualAnalysis.condition === "number"
                      ? visualAnalysis.condition
                      : draft.condition,
                  condition_details:
                    normalizeText(visualAnalysis.condition_details) ||
                    draft.condition_details,
                }
              : draft;
            sendJson(res, 200, { success: true, draft: enrichedDraft });
            return;
          }

          if (req.url === "/api/grok-validate") {
            const body = await readJsonBody(req);
            if (!normalizeText(body?.apiKey)) {
              sendJson(res, 400, {
                valid: false,
                message: "Falta la API key de Grok",
              });
              return;
            }

            const result = await validateGrokApiKey(String(body.apiKey));
            sendJson(res, 200, result);
            return;
          }

          if (req.url === "/api/grok-orient-image") {
            const body = await readJsonBody(req);
            const result = await detectImageOrientationWithGrok({
              imageBase64: typeof body?.imageBase64 === "string"
                ? body.imageBase64
                : undefined,
              image_base64: typeof body?.image_base64 === "string"
                ? body.image_base64
                : undefined,
              grokApiKey: typeof body?.grokApiKey === "string"
                ? body.grokApiKey
                : undefined,
              variants: Array.isArray(body?.variants)
                ? body.variants
                    .map((variant: {
                      rotationDegrees?: unknown;
                      imageBase64?: unknown;
                    }) => ({
                      rotationDegrees:
                        typeof variant?.rotationDegrees === "number"
                          ? variant.rotationDegrees
                          : undefined,
                      imageBase64:
                        typeof variant?.imageBase64 === "string"
                          ? variant.imageBase64
                          : undefined,
                    }))
                : undefined,
            });
            sendJson(res, 200, result);
            return;
          }

          if (req.url === "/api/todocoleccion-validate") {
            const body = await readJsonBody(req);
            const credentials = body?.credentials as
              | { userId?: string; apiKey?: string }
              | undefined;

            if (!credentials?.userId || !credentials?.apiKey) {
              sendJson(res, 400, {
                success: false,
                valid: false,
                message: "Faltan las credenciales",
              });
              return;
            }

            const { response, data } = await tcFetch(
              "/products?start=1&count=1",
              {
                userId: credentials.userId,
                apiKey: credentials.apiKey,
              },
            );

            if (response.status === 401) {
              sendJson(res, 401, {
                success: false,
                valid: false,
                message: "Credenciales inválidas",
                tcResponse: data,
              });
              return;
            }

            const totalProducts =
              typeof data?.total === "number" ? data.total : null;

            sendJson(res, 200, {
              success: true,
              valid: true,
              message: "Credenciales válidas",
              details: { totalProducts },
            });
            return;
          }

          if (req.url === "/api/todocoleccion-publish") {
            const body = await readJsonBody(req);
            const credentials = body?.credentials as
              | { userId?: string; apiKey?: string }
              | undefined;
            const artwork = body?.artwork as
              | {
                  id?: string;
                  title?: string;
                  description?: string;
                  price?: string;
                  condition?: number;
                  conditionDetails?: string;
                  observations?: string;
                  imageBase64?: string;
                  idSection?: number;
                }
              | undefined;

            if (!credentials?.userId || !credentials?.apiKey) {
              sendJson(res, 400, {
                success: false,
                error: "Faltan las credenciales",
              });
              return;
            }

            const sectionId = Number(artwork?.idSection);
            if (!Number.isInteger(sectionId) || sectionId <= 0) {
              sendJson(res, 400, {
                success: false,
                error: "La sección de Todocolección no es válida",
              });
              return;
            }

            const sectionCheck = await tcFetch(`/sectionTreeInfo/${sectionId}`, {
              userId: credentials.userId,
              apiKey: credentials.apiKey,
            });

            if (!sectionCheck.response.ok) {
              sendJson(res, 400, {
                success: false,
                error:
                  "La sección de Todocolección no es válida para publicar este lote.",
                debug: {
                  requestedSection: sectionId,
                  sectionCheckStatus: sectionCheck.response.status,
                  sectionCheckRaw: sectionCheck.data,
                },
              });
              return;
            }

            const rawImage = normalizeText(artwork?.imageBase64);
            const mainImage = rawImage
              ? rawImage
                  .replace(/^data:image\/jpeg;base64,/, "")
                  .replace(/^data:image\/jpg;base64,/, "")
                  .replace(/^data:image\/\w+;base64,/, "")
              : undefined;

            const payload: Record<string, unknown> = {
              id_product: truncate(
                normalizeText(artwork?.id) || `AF-${Date.now()}`,
                40,
              ),
              title: truncate(
                normalizeText(artwork?.title) || "Obra de arte original",
                100,
              ),
              id_section: sectionId,
              price: Number.parseFloat(String(artwork?.price || 0)).toFixed(2),
              description_item: normalizeText(artwork?.description),
              items: "1",
              condition: Number(artwork?.condition || 4),
              condition_details: truncate(
                normalizeText(artwork?.conditionDetails) ||
                  "Buen estado general",
                100,
              ),
              observations: truncate(
                normalizeText(artwork?.observations) ||
                  "Sin observaciones adicionales.",
                150,
              ),
            };

            if (mainImage) {
              payload.main_image = mainImage;
            }

            const publishResponse = await fetch(`${TC_BASE_URL}/products`, {
              method: "POST",
              headers: {
                apikey: credentials.apiKey.trim(),
                iduser: credentials.userId.trim(),
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(payload),
            });

            const publishText = await publishResponse.text();
            let publishData: Record<string, unknown>;

            try {
              publishData = JSON.parse(publishText) as Record<string, unknown>;
            } catch {
              publishData = { raw: publishText };
            }

            const nestedData = publishData.data as { id?: unknown } | undefined;
            const externalId =
              typeof publishData.id === "number"
                ? publishData.id
                : typeof nestedData?.id === "number"
                  ? nestedData.id
                  : null;

            if (!publishResponse.ok || publishData.success === false) {
              sendJson(
                res,
                publishResponse.ok ? 400 : publishResponse.status,
                {
                  success: false,
                  error:
                    typeof publishData.error === "string"
                      ? publishData.error
                      : `Error de Todocolección (${publishResponse.status})`,
                  message:
                    typeof publishData.message === "string"
                      ? publishData.message
                      : null,
                  tcResponse: publishData,
                  debug: {
                    requestedSection: sectionId,
                    sectionCheckStatus: sectionCheck.response.status,
                    sectionCheckRaw: sectionCheck.data,
                    payload,
                  },
                },
              );
              return;
            }

            sendJson(res, 200, {
              success: true,
              message: "Publicado correctamente en Todocolección",
              externalId,
              tcResponse: publishData,
            });
            return;
          }
        } catch (error) {
          sendJson(res, 500, {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Error interno en desarrollo",
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && todocoleccionDevApi(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
}));
