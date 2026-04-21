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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ valid: false, message: "Metodo no permitido" }, 405);
  }

  try {
    const body = (await req.json()) as { apiKey?: string };
    const apiKey = body.apiKey?.trim();

    if (!apiKey) {
      return jsonResponse(
        { valid: false, message: "Falta la API key de Groq" },
        400,
      );
    }

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
        max_completion_tokens: 20,
        messages: [
          {
            role: "user",
            content: "Responde solo con OK",
          },
        ],
      }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return jsonResponse(
        {
          valid: false,
          message: `No se pudo validar la API de Groq: ${errorText}`,
        },
        400,
      );
    }

    return jsonResponse({
      valid: true,
      message: "API de Groq validada correctamente",
      model,
    });
  } catch (error) {
    return jsonResponse(
      {
        valid: false,
        message:
          error instanceof Error
            ? error.message
            : "Error desconocido al validar Grok",
      },
      500,
    );
  }
});
