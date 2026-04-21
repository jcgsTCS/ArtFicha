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

const TC_BASE_URL = "https://www.todocoleccion.net/app/tcolapi/1.0";

type Credentials = {
  userId: string;
  apiKey: string;
};

type Artwork = {
  id?: string;
  artist?: string;
  measures?: string;
  price: string;
  observations?: string;
  imageBase64?: string;
  artworkName?: string;
  title: string;
  description: string;
  sceneType?: string;
  category?: string;
  condition: number;
  conditionDetails: string;
  idSection?: number;
};

type PublishBody = {
  credentials: Credentials;
  artwork: Artwork;
};

type TcResponse = {
  success?: boolean;
  id?: number;
  error?: string;
  message?: string;
  data?: {
    id?: number;
    product_id?: string;
    image_success?: boolean;
    shipping_success?: boolean;
  };
};

type TcProductListResponse = {
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

type TcSectionTreeInfoResponse = {
  success?: boolean;
  sections?: Array<{
    id?: number;
    name?: string;
    has_children?: boolean;
    children?: Array<{
      id?: number;
      name?: string;
      has_children?: boolean;
    }>;
  }>;
  error?: string;
};

type PublishDebug = {
  requestedSection: number | null;
  resolvedSection: number | null;
  sectionCheckStatus: number | null;
  sectionCheckRaw: unknown;
  userSections: number[];
  productsFetchStatus: number | null;
  productsFetchRaw: unknown;
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

function normalizeText(value: string | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

async function safeReadResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text || !text.trim()) {
    return { raw: "", empty: true };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, invalid_json: true };
  }
}

async function tcFetch(
  path: string,
  credentials: Credentials,
): Promise<{ response: Response; parsed: unknown }> {
  const response = await fetch(`${TC_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      apikey: credentials.apiKey.trim(),
      iduser: credentials.userId.trim(),
      Accept: "application/json",
    },
  });

  return { response, parsed: await safeReadResponse(response) };
}

function buildValidTitle(artwork: Artwork): string {
  const rawTitle =
    normalizeText(artwork.title) ||
    normalizeText(artwork.artworkName) ||
    "Obra de arte original";

  const title = truncate(rawTitle, 100);

  if (title.length >= 20) {
    return title;
  }

  const artist = normalizeText(artwork.artist);
  const category = normalizeText(artwork.category);
  const sceneType = normalizeText(artwork.sceneType);
  const measures = normalizeText(artwork.measures);

  const extra = [artist, category, sceneType, measures]
    .filter((v) => v.length > 0)
    .join(" - ");

  const padded = truncate(
    [title, extra].filter((v) => v.length > 0).join(" | "),
    100,
  );

  if (padded.length >= 20) {
    return padded;
  }

  return truncate(`${title} | Obra de arte`, 100);
}

function buildObservations(artwork: Artwork): string {
  const raw = normalizeText(artwork.observations);

  if (raw.length > 0) {
    return truncate(raw, 150);
  }

  return truncate(
    "Artículo descrito y fotografiado para su correcta identificación.",
    150,
  );
}

function normalizeImageValue(imageBase64?: string): string | undefined {
  const raw = normalizeText(imageBase64);

  if (!raw) return undefined;

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return raw
    .replace(/^data:image\/jpeg;base64,/, "")
    .replace(/^data:image\/jpg;base64,/, "")
    .replace(/^data:image\/\w+;base64,/, "");
}

function validatePublishBody(body: PublishBody): string[] {
  const errors: string[] = [];

  if (!normalizeText(body?.credentials?.userId)) {
    errors.push("credentials.userId es obligatorio");
  }

  if (!normalizeText(body?.credentials?.apiKey)) {
    errors.push("credentials.apiKey es obligatorio");
  }

  if (!body?.artwork) {
    errors.push("artwork es obligatorio");
    return errors;
  }

  const title = buildValidTitle(body.artwork);
  const observations = buildObservations(body.artwork);
  const price = Number.parseFloat(String(body.artwork.price));
  const condition = Number(body.artwork.condition);
  const description = normalizeText(body.artwork.description);
  const conditionDetails = normalizeText(body.artwork.conditionDetails);
  const idSection = Number(body.artwork.idSection);

  if (!Number.isFinite(price) || price <= 0) {
    errors.push("artwork.price debe ser un número válido mayor que 0");
  }

  if (title.length < 20 || title.length > 100) {
    errors.push("artwork.title debe tener entre 20 y 100 caracteres");
  }

  if (!description) {
    errors.push("artwork.description es obligatoria");
  }

  if (!Number.isInteger(condition) || condition < 1 || condition > 5) {
    errors.push("artwork.condition debe estar entre 1 y 5");
  }

  if (!conditionDetails) {
    errors.push("artwork.conditionDetails es obligatorio");
  }

  if (conditionDetails.length > 100) {
    errors.push("artwork.conditionDetails no puede superar 100 caracteres");
  }

  if (!observations) {
    errors.push("artwork.observations es obligatorio");
  }

  if (observations.length > 150) {
    errors.push("artwork.observations no puede superar 150 caracteres");
  }

  if (!Number.isInteger(idSection) || idSection <= 0) {
    errors.push("artwork.idSection debe ser una sección válida");
  }

  return errors;
}

async function getValidUserSections(
  credentials: Credentials,
): Promise<{
  sections: number[];
  status: number | null;
  raw: unknown;
}> {
  const { response, parsed } = await tcFetch(
    "/products?start=1&count=100",
    credentials,
  );

  if (!response.ok) {
    return {
      sections: [],
      status: response.status,
      raw: parsed,
    };
  }

  const data = parsed as TcProductListResponse;
  if (!Array.isArray(data.products)) {
    return {
      sections: [],
      status: response.status,
      raw: parsed,
    };
  }

  const unique = new Set<number>();
  for (const product of data.products) {
    if (Number.isInteger(product.id_section) && product.id_section > 0) {
      unique.add(product.id_section);
    }
  }

  return {
    sections: Array.from(unique),
    status: response.status,
    raw: parsed,
  };
}

async function resolveSection(
  artwork: Artwork,
  credentials: Credentials,
): Promise<PublishDebug> {
  const requestedSection = Number(artwork.idSection);
  const userSectionsInfo = await getValidUserSections(credentials);

  const debug: PublishDebug = {
    requestedSection:
      Number.isInteger(requestedSection) && requestedSection > 0
        ? requestedSection
        : null,
    resolvedSection: null,
    sectionCheckStatus: null,
    sectionCheckRaw: null,
    userSections: userSectionsInfo.sections,
    productsFetchStatus: userSectionsInfo.status,
    productsFetchRaw: userSectionsInfo.raw,
  };

  if (debug.requestedSection === null) {
    return debug;
  }

  const { response, parsed } = await tcFetch(
    `/sectionTreeInfo/${debug.requestedSection}`,
    credentials,
  );

  debug.sectionCheckStatus = response.status;
  debug.sectionCheckRaw = parsed;

  if (!response.ok) {
    return debug;
  }

  const sectionInfo = parsed as TcSectionTreeInfoResponse;
  if (sectionInfo.success === false) {
    return debug;
  }

  debug.resolvedSection = debug.requestedSection;
  return debug;
}

async function mapToTodocoleccion(
  artwork: Artwork,
  credentials: Credentials,
): Promise<{ payload: Record<string, unknown>; debug: PublishDebug }> {
  const title = buildValidTitle(artwork);
  const observations = buildObservations(artwork);
  const description = normalizeText(artwork.description);
  const conditionDetails = truncate(
    normalizeText(artwork.conditionDetails),
    100,
  );
  const normalizedImage = normalizeImageValue(artwork.imageBase64);
  const idProductBase = normalizeText(artwork.id) || `AF-${Date.now()}`;
  const idProduct = truncate(idProductBase, 40);

  const debug = await resolveSection(artwork, credentials);

  if (!debug.resolvedSection) {
    throw new Error(
      "La sección de Todocolección no es válida para publicar este lote.",
    );
  }

  const payload: Record<string, unknown> = {
    id_product: idProduct,
    title,
    id_section: debug.resolvedSection,
    price: Number.parseFloat(String(artwork.price)).toFixed(2),
    description_item: description,
    items: "1",
    condition: Number(artwork.condition),
    condition_details: conditionDetails,
    observations,
  };

  if (normalizedImage) {
    payload.main_image = normalizedImage;
  }

  return { payload, debug };
}

function extractApiError(
  status: number,
  responseData: unknown,
): { error: string; message: string | null } {
  const parsed = responseData as TcResponse;
  const error =
    typeof parsed?.error === "string"
      ? parsed.error
      : `Error de Todocolección (${status})`;
  const message =
    typeof parsed?.message === "string" ? parsed.message : null;

  return { error, message };
}

async function requireUserId(
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<string> {
  const authorization = req.headers.get("Authorization");

  if (!authorization) {
    throw new Error("Sesion no autenticada. Inicia sesion para publicar.");
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
      "Limite de publicacion alcanzado. Espera antes de seguir publicando.",
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

async function updateDraftStatus(
  supabase: SupabaseClient,
  artworkId: string | undefined,
  userId: string | undefined,
  data: Record<string, unknown>,
): Promise<void> {
  if (!artworkId || !userId) return;

  const { error } = await supabase
    .from("art_drafts")
    .update(data)
    .eq("id", artworkId)
    .eq("user_id", userId);

  if (error) {
    console.error("Error actualizando art_drafts:", error);
  }
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

  let artworkIdForErrorUpdate: string | undefined;
  let userIdForErrorUpdate: string | undefined;
  let debug: PublishDebug | null = null;

  try {
    const body = (await req.json()) as PublishBody;
    artworkIdForErrorUpdate = body?.artwork?.id;

    const validationErrors = validatePublishBody(body);
    if (validationErrors.length > 0) {
      return jsonResponse(
        {
          success: false,
          error: "Datos inválidos",
          details: validationErrors,
        },
        400,
      );
    }

    if (!body.artwork.id) {
      return jsonResponse(
        {
          success: false,
          error:
            "La publicacion requiere un borrador aprobado en ready_to_publish.",
        },
        409,
      );
    }

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
    userIdForErrorUpdate = userId;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await enforceRateLimit(supabase, userId, "publish_product", 80, 3600);

    let nextPublishAttempts = 1;

    if (body.artwork.id) {
      const { data: draft, error: draftError } = await supabase
        .from("art_drafts")
        .select("publication_status, review_status, publish_attempts")
        .eq("id", body.artwork.id)
        .eq("user_id", userId)
        .single();

      if (draftError) throw draftError;

      if (
        draft?.publication_status !== "ready_to_publish" ||
        draft?.review_status !== "ready_to_publish"
      ) {
        return jsonResponse(
          {
            success: false,
            error:
              "La ficha debe estar aprobada y en ready_to_publish antes de publicar.",
          },
          409,
        );
      }

      nextPublishAttempts = Number(draft?.publish_attempts ?? 0) + 1;
    }

    await updateDraftStatus(supabase, body.artwork.id, userId, {
      publication_status: "publishing",
      status: "publishing",
      tc_last_error: null,
      publish_attempts: nextPublishAttempts,
    });

    const mapped = await mapToTodocoleccion(body.artwork, body.credentials);
    const tcPayload = mapped.payload;
    debug = mapped.debug;

    const response = await fetch(`${TC_BASE_URL}/products`, {
      method: "POST",
      headers: {
        apikey: body.credentials.apiKey.trim(),
        iduser: body.credentials.userId.trim(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(tcPayload),
    });

    const responseData = await safeReadResponse(response);

    if (response.status === 401) {
      await updateDraftStatus(supabase, body.artwork.id, userId, {
        publication_status: "failed",
        status: "failed",
        tc_last_error: "Credenciales inválidas",
        tc_last_response: responseData,
      });

      return jsonResponse(
        {
          success: false,
          error: "Credenciales inválidas",
          tcResponse: responseData,
          debug,
        },
        401,
      );
    }

    const parsed = responseData as TcResponse;

    if (!response.ok || parsed.success === false) {
      const api = extractApiError(response.status, responseData);

      await updateDraftStatus(supabase, body.artwork.id, userId, {
        publication_status: "failed",
        status: "failed",
        tc_last_error: api.message ? `${api.error}: ${api.message}` : api.error,
        tc_last_response: responseData,
      });

      return jsonResponse(
        {
          success: false,
          error: api.error,
          message: api.message,
          tcResponse: responseData,
          debug,
        },
        response.ok ? 400 : response.status,
      );
    }

    const externalId =
      typeof parsed.id === "number"
        ? parsed.id
        : typeof parsed.data?.id === "number"
          ? parsed.data.id
          : null;

    await updateDraftStatus(supabase, body.artwork.id, userId, {
      publication_status: "published",
      status: "published",
      tc_external_id: externalId,
      tc_last_response: responseData,
      tc_last_error: null,
      tc_published_at: new Date().toISOString(),
    });

    return jsonResponse({
      success: true,
      message: "Publicado correctamente en Todocolección",
      externalId,
      tcResponse: responseData,
      debug,
    });
  } catch (error) {
    console.error("todocoleccion-publish error:", error);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
      supabaseUrl &&
      supabaseServiceKey &&
      artworkIdForErrorUpdate &&
      userIdForErrorUpdate
    ) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      await updateDraftStatus(supabase, artworkIdForErrorUpdate, userIdForErrorUpdate, {
        publication_status: "failed",
        status: "failed",
        tc_last_error:
          error instanceof Error ? error.message : "Error desconocido",
      });
    }

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido al publicar",
        debug,
      },
      500,
    );
  }
});
