import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const allowedOrigin =
  Deno.env.get("ALLOWED_ORIGIN") ||
  Deno.env.get("ALLOWED_ORIGINS")?.split(",")[0]?.trim() ||
  "http://localhost:8080";

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type OrientVariant = {
  rotationDegrees?: number;
  imageBase64?: string;
};

type OrientBody = {
  imageBase64?: string;
  image_base64?: string;
  grokApiKey?: string;
  apiKey?: string;
  variants?: OrientVariant[];
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

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function extractJsonObject(value: string): string {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("La respuesta del analisis de orientacion no contiene JSON valido");
  }

  return value.slice(start, end + 1);
}

function normalizeQuarterTurn(value: number | undefined): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(value)) return 0;

  const rounded = Math.round(Number(value) / 90) * 90;
  const normalized = ((rounded % 360) + 360) % 360;

  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }

  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toImageInput(value: string): string {
  return value.startsWith("data:")
    ? value
    : `data:image/jpeg;base64,${value}`;
}

function getVariantLabel(index: number): string {
  return ["A", "B", "C", "D"][index] || `V${index + 1}`;
}

function buildOrientationPrompt(hasVariants: boolean): string {
  if (hasVariants) {
    return `Vas a recibir una imagen original y varias variantes ya giradas.

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

Devuelve exactamente este JSON:
{
  "rotation_degrees": 0,
  "confidence": 0.0,
  "minor_correction_degrees": 0,
  "reason": "string"
}`;
  }

  return `Analiza solo la orientacion visual de la imagen para verla correctamente en pantalla.

Debes decidir cuantos grados EN SENTIDO HORARIO hay que girar la imagen actual para que quede bien colocada para un humano.

Reglas:
- "rotation_degrees" debe ser exactamente uno de estos valores: 0, 90, 180, 270.
- Usa 0 si la imagen ya esta bien colocada o si no estas claramente seguro.
- Se conservador: si hay duda, no gires.
- Fijate en figuras humanas, marcos, texto, objetos apoyados, lineas de horizonte, arquitectura y composicion natural.
- "confidence" debe ir de 0 a 1.
- "minor_correction_degrees" es opcional y sirve para una inclinacion fina adicional, entre -8 y 8 grados. Si no hace falta o no estas seguro, devuelve 0.
- "reason" debe ser una frase breve en espanol.

Devuelve exactamente este JSON:
{
  "rotation_degrees": 0,
  "confidence": 0.0,
  "minor_correction_degrees": 0,
  "reason": "string"
}`;
}

function buildVisionContent(
  imageInput: string,
  variants: Array<{ rotationDegrees: 0 | 90 | 180 | 270; imageInput: string }>,
  prompt: string,
) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  if (variants.length > 0) {
    content.push({
      type: "text",
      text:
        "Imagen original tal como llega ahora. Usa esta referencia para comparar las variantes.",
    });
    content.push({
      type: "image_url",
      image_url: { url: imageInput },
    });

    for (const [index, variant] of variants.entries()) {
      content.push({
        type: "text",
        text:
          `Variante ${getVariantLabel(index)}. Esta version ya esta girada ${variant.rotationDegrees} grados en sentido horario respecto a la imagen original.`,
      });
      content.push({
        type: "image_url",
        image_url: { url: variant.imageInput },
      });
    }
  } else {
    content.push({
      type: "image_url",
      image_url: { url: imageInput },
    });
  }

  content.push({
    type: "text",
    text:
      "Eres un asistente que solo decide la orientacion correcta de imagenes. Devuelves solo JSON valido, sin markdown ni texto adicional.\n\n" +
      prompt,
  });

  return content;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Metodo no permitido" }, 405);
  }

  try {
    const body = (await req.json()) as OrientBody;
    const image =
      normalizeText(body.imageBase64) || normalizeText(body.image_base64);

    if (!image) {
      return jsonResponse(
        { error: "Falta la imagen para analizar la orientacion" },
        400,
      );
    }

    const apiKey =
      normalizeText(body.grokApiKey) ||
      normalizeText(body.apiKey) ||
      normalizeText(Deno.env.get("GROQ_API_KEY"));

    if (!apiKey) {
      return jsonResponse(
        { error: "Falta la API key de Groq para usar el autogiro inteligente" },
        400,
      );
    }

    const variants = Array.isArray(body.variants)
      ? body.variants
          .map((variant) => ({
            rotationDegrees: normalizeQuarterTurn(variant.rotationDegrees),
            imageInput: normalizeText(variant.imageBase64),
          }))
          .filter((variant) => variant.imageInput.length > 0)
      : [];
    const prompt = buildOrientationPrompt(variants.length > 0);
    const content = buildVisionContent(
      toImageInput(image),
      variants.map((variant) => ({
        rotationDegrees: variant.rotationDegrees,
        imageInput: toImageInput(variant.imageInput),
      })),
      prompt,
    );

    const model =
      Deno.env.get("GROQ_VISION_MODEL") ||
      "meta-llama/llama-4-scout-17b-16e-instruct";
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_completion_tokens: variants.length > 0 ? 320 : 250,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content,
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return jsonResponse(
        {
          error: `No se pudo analizar la orientacion con Groq: ${errorText}`,
        },
        400,
      );
    }

    const data = await response.json();
    const contentText =
      typeof data?.choices?.[0]?.message?.content === "string"
        ? data.choices[0].message.content
        : Array.isArray(data?.choices?.[0]?.message?.content)
          ? data.choices[0].message.content
              .map((part: { text?: string }) => part.text || "")
              .filter(Boolean)
              .join("\n")
          : "";

    if (!contentText.trim()) {
      throw new Error("Groq no devolvio un analisis util de orientacion");
    }

    const parsed = JSON.parse(extractJsonObject(contentText)) as {
      rotation_degrees?: number;
      confidence?: number;
      minor_correction_degrees?: number;
      reason?: string;
    };

    return jsonResponse({
      rotationDegrees: normalizeQuarterTurn(parsed.rotation_degrees),
      confidence: clamp(Number(parsed.confidence) || 0, 0, 1),
      minorCorrectionDegrees: clamp(
        Number(parsed.minor_correction_degrees) || 0,
        -8,
        8,
      ),
      reason: normalizeText(parsed.reason) || "Orientacion analizada con IA",
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido al detectar la orientacion",
      },
      500,
    );
  }
});
