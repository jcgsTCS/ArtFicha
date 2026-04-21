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

const TC_BASE_URL = "https://www.todocoleccion.net/app/tcolapi/1.0";

type Credentials = {
  userId: string;
  apiKey: string;
};

type ValidateBody = {
  credentials: Credentials;
  idSection?: number;
};

type TcProductsResponse = {
  success?: boolean;
  total?: number;
  products?: Array<{
    id: number;
    id_product: string;
    id_section: number;
    status_item: number;
  }>;
  error?: string;
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

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim();
}

async function tcFetch(
  path: string,
  credentials: Credentials,
): Promise<Response> {
  return await fetch(`${TC_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      apikey: credentials.apiKey.trim(),
      iduser: credentials.userId.trim(),
      Accept: "application/json",
    },
  });
}

async function getMyProductsSections(
  credentials: Credentials,
): Promise<number[]> {
  const response = await tcFetch("/products?start=1&count=100", credentials);
  const text = await response.text();

  let data: TcProductsResponse | { raw: string };

  try {
    data = JSON.parse(text) as TcProductsResponse;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `No se pudieron leer los productos del usuario (${response.status})`,
    );
  }

  if (!("products" in data) || !Array.isArray(data.products)) {
    return [];
  }

  const uniqueSections = new Set<number>();

  for (const product of data.products) {
    if (Number.isInteger(product.id_section) && product.id_section > 0) {
      uniqueSections.add(product.id_section);
    }
  }

  return Array.from(uniqueSections);
}

async function checkSectionExists(
  credentials: Credentials,
  idSection: number,
): Promise<{
  exists: boolean;
  status: number;
  raw: unknown;
}> {
  const response = await tcFetch(`/sectionTreeInfo/${idSection}`, credentials);
  const text = await response.text();

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    exists: response.ok,
    status: response.status,
    raw: data,
  };
}

async function validateCredentials(
  credentials: Credentials,
): Promise<{
  valid: boolean;
  status: number;
  raw: unknown;
  totalProducts: number | null;
}> {
  const response = await tcFetch("/products?start=1&count=1", credentials);
  const text = await response.text();

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  const parsed = data as TcProductsResponse;

  return {
    valid: response.status !== 401,
    status: response.status,
    raw: data,
    totalProducts: typeof parsed.total === "number" ? parsed.total : null,
  };
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
    const body = (await req.json()) as ValidateBody;
    const credentials = body.credentials;
    const idSection = Number(body.idSection);

    if (
      !credentials ||
      !normalizeText(credentials.userId) ||
      !normalizeText(credentials.apiKey)
    ) {
      return jsonResponse(
        {
          success: false,
          error: "credentials.userId y credentials.apiKey son obligatorios",
        },
        400,
      );
    }

    const credentialsCheck = await validateCredentials(credentials);

    if (!credentialsCheck.valid) {
      return jsonResponse(
        {
          success: false,
          valid: false,
          error: "Credenciales inválidas",
          message: "Revisa tu User ID y API Key",
          tcResponse: credentialsCheck.raw,
        },
        401,
      );
    }

    const myUsedSections = await getMyProductsSections(credentials);

    if (!Number.isInteger(idSection) || idSection <= 0) {
      return jsonResponse({
        success: true,
        valid: true,
        credentialsValid: true,
        message: "Credenciales válidas",
        checkedSection: null,
        sectionExists: null,
        details: {
          myUsedSections,
          totalProducts: credentialsCheck.totalProducts,
        },
        myUsedSections,
      });
    }

    const sectionCheck = await checkSectionExists(credentials, idSection);

    return jsonResponse({
      success: true,
      valid: true,
      credentialsValid: true,
      message: sectionCheck.exists
        ? "Credenciales y sección válidas"
        : "La sección indicada no existe o no está disponible",
      checkedSection: idSection,
      sectionExists: sectionCheck.exists,
      sectionStatusCode: sectionCheck.status,
      details: {
        myUsedSections,
        totalProducts: credentialsCheck.totalProducts,
      },
      myUsedSections,
      tcResponse: sectionCheck.raw,
    });
  } catch (error) {
    console.error("todocoleccion-validate error:", error);

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido al validar",
      },
      500,
    );
  }
});
