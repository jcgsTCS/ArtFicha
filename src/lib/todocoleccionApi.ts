import { supabase } from "@/integrations/supabase/client";
import {
  detectOrientationSchema,
  formatValidationError,
  generateProductSchema,
  publishProductSchema,
  tcCredentialsSchema,
  validateGrokSchema,
} from "@/lib/validation";
export type { GrokDesk as GrokCredentials } from "@/lib/grokDeskConfig";

type Credentials = {
  userId: string;
  apiKey: string;
};

type ValidatePayload = {
  credentials: Credentials;
  idSection?: number;
};

type PublishPayload = {
  credentials: Credentials;
  artwork: {
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
};

type GeneratePayload = {
  imageBase64: string;
  artist?: string;
  artworkTitle?: string;
  measures?: string;
  price?: string;
  observations?: string;
  grokApiKey?: string;
  usePremiumAnalysis?: boolean;
  sourceType?: "manual" | "single_upload" | "batch_upload" | "folder_import";
  sourcePath?: string | null;
  importBatchId?: string | null;
  inheritedArtist?: string | null;
  inheritedCategory?: string | null;
  inheritedMeasures?: string | null;
  inheritedPrice?: number | null;
  parsingWarnings?: string[];
  imageUrl?: string;
};

type DetectImageOrientationPayload = {
  imageBase64: string;
  grokApiKey?: string;
  variants?: Array<{
    rotationDegrees: number;
    imageBase64: string;
  }>;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as T & {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }

  return data;
}

export async function validateTodocoleccion(payload: ValidatePayload) {
  const validatedPayload = {
    ...payload,
    credentials: tcCredentialsSchema.parse(payload.credentials),
  };

  if (import.meta.env.DEV) {
    return await postJson<{
      valid?: boolean;
      details?: { totalProducts?: number; myUsedSections?: number[] };
      message?: string;
    }>("/api/todocoleccion-validate", validatedPayload);
  }

  const { data, error } = await supabase.functions.invoke(
    "todocoleccion-validate",
    { body: validatedPayload },
  );

  if (error) throw error;
  return data;
}

export async function publishTodocoleccion(payload: PublishPayload) {
  const validatedPayload = publishProductSchema.parse(payload);

  if (import.meta.env.DEV) {
    return await postJson<{
      success?: boolean;
      externalId?: number | null;
      message?: string;
      error?: string;
      debug?: unknown;
      tcResponse?: unknown;
    }>("/api/todocoleccion-publish", validatedPayload);
  }

  const { data, error } = await supabase.functions.invoke(
    "todocoleccion-publish",
    { body: validatedPayload },
  );

  if (error) throw error;
  return data;
}

export async function validateGrok(payload: { apiKey: string }) {
  const validatedPayload = validateGrokSchema.parse(payload);
  const invoke = async () => {
    const { data, error } = await supabase.functions.invoke("grok-validate", {
      body: validatedPayload,
    });

    if (error) throw error;
    return data;
  };

  try {
    return await invoke();
  } catch (error) {
    if (import.meta.env.DEV) {
      return await postJson<{
        valid?: boolean;
        message?: string;
        model?: string;
      }>("/api/grok-validate", validatedPayload);
    }

    throw error;
  }
}

export async function detectImageOrientation(
  payload: DetectImageOrientationPayload,
) {
  const validatedPayload = detectOrientationSchema.parse(payload);

  if (import.meta.env.DEV) {
    return await postJson<{
      rotationDegrees?: number;
      confidence?: number;
      minorCorrectionDegrees?: number;
      reason?: string;
    }>("/api/grok-orient-image", validatedPayload);
  }

  const invoke = async () => {
    const { data, error } = await supabase.functions.invoke(
      "grok-orient-image",
      { body: validatedPayload },
    );

    if (error) throw error;
    return data as {
      rotationDegrees?: number;
      confidence?: number;
      minorCorrectionDegrees?: number;
      reason?: string;
    };
  };

  return await invoke();
}

export async function generateProductDraft(payload: GeneratePayload) {
  const validatedPayload = generateProductSchema.parse(payload);

  if (import.meta.env.DEV) {
    return await postJson<{
      success?: boolean;
      draft?: Record<string, unknown>;
      error?: string;
    }>("/api/generate-product", validatedPayload);
  }

  const { data, error } = await supabase.functions.invoke("generate-product", {
    body: validatedPayload,
  });

  if (!error) return data;

  throw error;
}

export { formatValidationError };
