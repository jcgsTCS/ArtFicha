import { lazy, Suspense, useState } from "react";
import type {
  BatchPublishInput,
  BatchPublishResult,
} from "@/components/BatchPublishPanel";
import type {
  FolderImportInput,
  FolderImportProgress,
} from "@/components/FolderImportPanel";
import type { ProductData } from "@/components/ProductCard";
import type { TcCredentials } from "@/components/SettingsPanel";
import { SignOutButton, useAuthSession } from "@/components/AuthGate";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";
import {
  detectImageOrientation,
  generateProductDraft,
  publishTodocoleccion,
} from "@/lib/todocoleccionApi";
import {
  optimizeImageForAiAnalysis,
  prepareArtworkImage,
  readFileAsDataUrl,
} from "@/lib/artworkImageProcessing";
import {
  estimateArtworkPrice,
  getFallbackRangePrice,
  type PriceEstimate,
} from "@/lib/artPricing";
import {
  buildGeneratedSnapshot,
  countManualEdits,
  estimateMinutesSaved,
  evaluateProductReadiness,
  normalizeReviewChecklist,
  type GeneratedDraftSnapshot,
  type ReviewChecklist,
} from "@/lib/productReadiness";
import {
  deleteLocalDraft,
  loadLocalDrafts,
  updateLocalDraft,
  upsertLocalDraft,
} from "@/lib/localReviewStore";
import {
  getApiRotationOrder,
  getUsableGrokApis,
  isGrokCapacityError,
  persistSelectedGrokDesk,
  type GrokDesk,
} from "@/lib/grokDeskConfig";
import { ChevronDown, Palette } from "lucide-react";

type DraftRow = Tables<"art_drafts">;

const BusinessHealthPanel = lazy(() =>
  import("@/components/BusinessHealthPanel").then((module) => ({
    default: module.BusinessHealthPanel,
  })),
);
const UploadForm = lazy(() =>
  import("@/components/UploadForm").then((module) => ({
    default: module.UploadForm,
  })),
);
const ProductCard = lazy(() =>
  import("@/components/ProductCard").then((module) => ({
    default: module.ProductCard,
  })),
);
const BatchPublishPanel = lazy(() =>
  import("@/components/BatchPublishPanel").then((module) => ({
    default: module.BatchPublishPanel,
  })),
);
const FolderImportPanel = lazy(() =>
  import("@/components/FolderImportPanel").then((module) => ({
    default: module.FolderImportPanel,
  })),
);
const ReviewQueuePanel = lazy(() =>
  import("@/components/ReviewQueuePanel").then((module) => ({
    default: module.ReviewQueuePanel,
  })),
);
const SettingsPanel = lazy(() =>
  import("@/components/SettingsPanel").then((module) => ({
    default: module.SettingsPanel,
  })),
);
const DraftsList = lazy(() =>
  import("@/components/DraftsList").then((module) => ({
    default: module.DraftsList,
  })),
);

function PanelFallback() {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 text-sm text-muted-foreground shadow-[0_24px_80px_-55px_rgba(15,23,42,0.45)]">
      Cargando panel...
    </div>
  );
}

const balancedSplitGrid =
  "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]";
const elevatedPanelClass =
  "flex h-full flex-col rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_-55px_rgba(15,23,42,0.45)]";

const parseGeneratedSnapshot = (
  value: DraftRow["generated_snapshot"],
): GeneratedDraftSnapshot | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Record<string, unknown>;

  return {
    artworkName:
      typeof snapshot.artworkName === "string" ? snapshot.artworkName : "",
    title: typeof snapshot.title === "string" ? snapshot.title : "",
    description:
      typeof snapshot.description === "string" ? snapshot.description : "",
    category: typeof snapshot.category === "string" ? snapshot.category : "",
    price: typeof snapshot.price === "string" ? snapshot.price : "",
    observations:
      typeof snapshot.observations === "string" ? snapshot.observations : "",
    condition:
      typeof snapshot.condition === "number" ? snapshot.condition : 3,
    conditionDetails:
      typeof snapshot.conditionDetails === "string"
        ? snapshot.conditionDetails
        : "Buen estado general",
    sceneType:
      typeof snapshot.sceneType === "string" ? snapshot.sceneType : "",
    idSection:
      typeof snapshot.idSection === "number" ? snapshot.idSection : null,
  };
};

const parsePriceEstimate = (value: DraftRow["ai_trace"]): PriceEstimate | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const trace = value as Record<string, unknown>;
  const estimate = trace.priceEstimate as Record<string, unknown> | undefined;
  if (!estimate) return null;

  const requiredNumbers = [
    "min",
    "max",
    "recommended",
    "technicalQualityScore",
    "confidence",
  ] as const;

  if (!requiredNumbers.every((key) => typeof estimate[key] === "number")) {
    return null;
  }

  return {
    min: estimate.min as number,
    max: estimate.max as number,
    recommended: estimate.recommended as number,
    technicalQualityScore: estimate.technicalQualityScore as number,
    confidence: estimate.confidence as number,
    reasoning:
      typeof estimate.reasoning === "string" ? estimate.reasoning : "",
  };
};

const mapDraftToProductData = (draft: DraftRow): ProductData => ({
  id: draft.id,
  artworkName: draft.artwork_name || "",
  scene_type: draft.scene_type || "",
  title: draft.title || "",
  description: draft.description || "",
  condition: draft.condition || 3,
  condition_details: draft.condition_details || "Buen estado general",
  category: draft.category || "Arte",
  id_section: typeof draft.id_section === "number" ? draft.id_section : null,
  price: draft.price || "",
  observations: draft.observations || "",
  publicationStatus: draft.publication_status || "not_published",
  tcExternalId: draft.tc_external_id,
  tcLastError: draft.tc_last_error,
  tcPublishedAt: draft.tc_published_at,
  reviewChecklist: normalizeReviewChecklist(
    draft.review_checklist &&
      typeof draft.review_checklist === "object" &&
      !Array.isArray(draft.review_checklist)
      ? (draft.review_checklist as Partial<ReviewChecklist>)
      : null,
  ),
  reviewStatus: draft.review_status || "pending_review",
  reviewCompletedAt: draft.review_completed_at,
  qualityScore: draft.quality_score ?? 0,
  estimatedMinutesSaved: draft.estimated_minutes_saved ?? 0,
  manualEditCount: draft.manual_edit_count ?? 0,
  generatedSnapshot: parseGeneratedSnapshot(draft.generated_snapshot),
  generatedAt: draft.generated_at,
  priceEstimate: parsePriceEstimate(draft.ai_trace),
});

const DEFAULT_TC_SECTION = 130;

const estimatePriceForProduct = (
  product: ProductData,
  priceRange: { min: string; max: string },
  enabled: boolean,
): PriceEstimate | null => {
  if (!enabled) return null;

  return estimateArtworkPrice({
    title: product.title,
    description: product.description,
    observations: product.observations,
    category: product.category,
    sceneType: product.scene_type,
    condition: product.condition,
    qualityScore: product.qualityScore,
    priceRange,
  });
};

const buildDraftRecordFromProduct = ({
  product,
  userId,
  artist,
  measures,
  originalImageUrl,
  processedImageUrl,
  source,
  sourceType = "manual",
  sourcePath = null,
  importBatchId = null,
  inheritedArtist = null,
  inheritedCategory = null,
  inheritedMeasures = null,
  inheritedPrice = null,
  parsingWarnings = [],
  publishedImageUrl = null,
}: {
  product: ProductData;
  userId: string;
  artist: string;
  measures: string;
  originalImageUrl: string | null;
  processedImageUrl: string | null;
  source: string;
  sourceType?: DraftRow["source_type"];
  sourcePath?: string | null;
  importBatchId?: string | null;
  inheritedArtist?: string | null;
  inheritedCategory?: string | null;
  inheritedMeasures?: string | null;
  inheritedPrice?: number | null;
  parsingWarnings?: string[];
  publishedImageUrl?: string | null;
}): DraftRow => {
  const now = new Date().toISOString();
  const generatedSnapshot =
    product.generatedSnapshot ??
    buildGeneratedSnapshot({
      artworkName: product.artworkName,
      title: product.title,
      description: product.description,
      category: product.category,
      price: product.price,
      observations: product.observations,
      condition: product.condition,
      conditionDetails: product.condition_details,
      sceneType: product.scene_type,
      idSection: product.id_section,
    });

  return {
    id: product.id ?? crypto.randomUUID(),
    user_id: userId,
    artist: artist.trim() || null,
    measures: measures.trim() || null,
    price: product.price?.trim() || null,
    observations: product.observations || null,
    image_url: processedImageUrl,
    original_image_url: originalImageUrl,
    processed_image_url: processedImageUrl,
    published_image_url: publishedImageUrl,
    artwork_name: product.artworkName || null,
    title: product.title || null,
    description: product.description || null,
    scene_type: product.scene_type || null,
    category: product.category || null,
    condition: product.condition,
    condition_details: product.condition_details || null,
    id_section: product.id_section ?? null,
    status: product.publicationStatus || "pending_review",
    publication_status: product.publicationStatus || "pending_review",
    source_type: sourceType,
    source_path: sourcePath,
    import_batch_id: importBatchId,
    is_user_edited: false,
    user_edited_fields: [],
    generated_title: generatedSnapshot.title || product.title || null,
    final_title: product.title || null,
    generated_description:
      generatedSnapshot.description || product.description || null,
    final_description: product.description || null,
    inherited_artist: inheritedArtist,
    inherited_category: inheritedCategory,
    inherited_measures: inheritedMeasures,
    inherited_price: inheritedPrice,
    parsing_warnings: parsingWarnings,
    publish_attempts: product.publicationStatus === "published" ? 1 : 0,
    ai_trace: {
      source,
      generatedAt: product.generatedAt,
      priceEstimate: product.priceEstimate ?? null,
      parsingWarnings,
    },
    attribution_status: "unverified",
    generated_at: product.generatedAt || now,
    generated_snapshot: generatedSnapshot,
    review_status: product.reviewStatus || "pending_review",
    review_checklist: normalizeReviewChecklist(product.reviewChecklist ?? null),
    review_completed_at: product.reviewCompletedAt || null,
    quality_score: product.qualityScore ?? 0,
    estimated_minutes_saved: product.estimatedMinutesSaved ?? 0,
    manual_edit_count: product.manualEditCount ?? 0,
    tc_external_id: product.tcExternalId ?? null,
    tc_last_error: product.tcLastError ?? null,
    tc_last_response: null,
    tc_published_at: product.tcPublishedAt ?? null,
    created_at: now,
    updated_at: now,
  };
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const GROQ_PREMIUM_REQUEST_SPACING_MS = 10000;
let nextGrokPremiumRequestAt = 0;

const waitForGrokPremiumSlot = async () => {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextGrokPremiumRequestAt);
  nextGrokPremiumRequestAt = scheduledAt + GROQ_PREMIUM_REQUEST_SPACING_MS;
  const waitMs = scheduledAt - now;

  if (waitMs > 0) {
    await sleep(waitMs);
  }
};

const formatGroqLimitForUser = (message: string) => {
  const normalized = message.toLowerCase();

  if (
    !normalized.includes("rate limit") &&
    !normalized.includes("tokens per minute") &&
    !normalized.includes("requests per minute") &&
    !normalized.includes("on_demand")
  ) {
    return message;
  }

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

  return `Limite temporal de Groq alcanzado. Espera ${retryText} y reintenta, o anade otra API al desk. No se crea borrador porque la descripcion premium es obligatoria.`;
};

const getErrorMessage = (error: unknown) =>
  formatGroqLimitForUser(
    error instanceof Error ? error.message : String(error || "Error desconocido"),
  );

const isWeakGeneratedDescription = (value: unknown) => {
  const description = String(value ?? "").replace(/\s+/g, " ").trim();
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
  const hasVisualSignal = visualSignals.some((signal) =>
    normalized.includes(signal),
  );

  return looksLikeMetadataOnly && !hasVisualSignal;
};

const isRetryablePremiumGenerationError = (error: unknown) => {
  const message = getErrorMessage(error)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    isGrokCapacityError(error) ||
    message.includes("descripcion visual") ||
    message.includes("descripcion comercial") ||
    message.includes("plantilla generica")
  );
};

const Index = () => {
  const { isPaused, user } = useAuthSession();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [productData, setProductData] = useState<ProductData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [inputData, setInputData] = useState<{
    artist: string;
    artworkTitle: string;
    measures: string;
    price: string;
    observations: string;
  } | null>(null);
  const [credentials, setCredentials] = useState<TcCredentials | null>(null);
  const [grokCredentials, setGrokCredentials] =
    useState<GrokDesk | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isBatchPublishing, setIsBatchPublishing] = useState(false);
  const [isFolderImporting, setIsFolderImporting] = useState(false);
  const [folderImportProgress, setFolderImportProgress] =
    useState<FolderImportProgress>({
      status: "idle",
      total: 0,
      processed: 0,
      failed: 0,
      ready: 0,
      currentFile: null,
      failedItems: [],
    });
  const [batchProgressText, setBatchProgressText] = useState<string | null>(
    null,
  );
  const [batchResults, setBatchResults] = useState<BatchPublishResult[]>([]);
  const [remainingBatchFileNames, setRemainingBatchFileNames] = useState<string[]>(
    [],
  );
  const [lastBatchInput, setLastBatchInput] = useState<BatchPublishInput | null>(
    null,
  );
  const [isSingleFormOpen, setIsSingleFormOpen] = useState(true);
  const [isGeneratedCardOpen, setIsGeneratedCardOpen] = useState(true);

  const triggerRefresh = () => setRefreshTrigger((prev) => prev + 1);
  const scrollToSection = (sectionId: string) => {
    const section = document.getElementById(sectionId);
    if (!section) return;

    section.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const hasUsableGrokApis =
    grokCredentials != null && getUsableGrokApis(grokCredentials).length > 0;

  const updateSelectedGrokDesk = (
    updater: (current: GrokDesk) => GrokDesk,
  ) => {
    setGrokCredentials((current) => {
      if (!current) return current;
      return persistSelectedGrokDesk(updater(current));
    });
  };

  const runWithGrokDeskRotation = async <T,>(
    operationName: string,
    runner: (apiKey: string) => Promise<T>,
  ) => {
    if (!grokCredentials) {
      throw new Error(`No hay ningun desk de Groq disponible para ${operationName}.`);
    }

    const apiOrder = getApiRotationOrder(grokCredentials);

    if (apiOrder.length === 0) {
      throw new Error(
        `El desk "${grokCredentials.name}" no tiene APIs listas para ${operationName}.`,
      );
    }

    let lastError: unknown = null;

    for (const [index, api] of apiOrder.entries()) {
      if (grokCredentials.activeApiId !== api.id) {
        updateSelectedGrokDesk((current) => ({
          ...current,
          activeApiId: api.id,
        }));
      }

      try {
        return await runner(api.apiKey);
      } catch (error) {
        lastError = error;

        const hasNextApi = index < apiOrder.length - 1;
        const isRetryable = isRetryablePremiumGenerationError(error);
        const isCapacity = isGrokCapacityError(error);

        if (!isRetryable || !hasNextApi) {
          if (isRetryable && !hasNextApi) {
            const message = getErrorMessage(error);
            const errorPrefix = isCapacity
              ? `El desk "${grokCredentials.name}" no tiene otra API disponible para ${operationName}.`
              : `No se pudo conseguir una descripcion visual util durante ${operationName}.`;

            throw new Error(`${errorPrefix} Ultimo error: ${message}`);
          }

          throw error;
        }

        const nextApi = apiOrder[index + 1];
        updateSelectedGrokDesk((current) => ({
          ...current,
          activeApiId: nextApi.id,
        }));
      }
    }

    throw (
      lastError ??
      new Error(`No se pudo completar ${operationName} con el desk actual.`)
    );
  };

  const detectImageOrientationWithDesk = hasUsableGrokApis
    ? async (payload: Parameters<typeof detectImageOrientation>[0]) => {
        const optimizedPayload = {
          ...payload,
          imageBase64: await optimizeImageForAiAnalysis(payload.imageBase64, {
            maxSide: 960,
            quality: 0.78,
          }),
        };

        return await runWithGrokDeskRotation(
          "el autogiro inteligente",
          async (apiKey) => {
            await waitForGrokPremiumSlot();

            return await detectImageOrientation({
              ...optimizedPayload,
              grokApiKey: apiKey,
            });
          },
        );
      }
    : undefined;

  const generateProductDraftWithDesk = async (
    payload: Parameters<typeof generateProductDraft>[0],
  ) => {
    if (!grokCredentials || !hasUsableGrokApis) {
      throw new Error(
        "El analisis visual premium es obligatorio. Anade una API de Groq en el desk seleccionado antes de generar fichas.",
      );
    }
    const optimizedImageBase64 = await optimizeImageForAiAnalysis(
      payload.imageBase64,
      {
        maxSide: 960,
        quality: 0.72,
      },
    );
    const premiumPayload = {
      ...payload,
      imageBase64: optimizedImageBase64,
      imageUrl: payload.imageUrl ?? payload.imageBase64,
    };

    return await runWithGrokDeskRotation(
      "el analisis premium",
      async (apiKey) => {
        await waitForGrokPremiumSlot();

        const result = await generateProductDraft({
          ...premiumPayload,
          grokApiKey: apiKey,
          usePremiumAnalysis: true,
        });
        const draft = result?.draft ?? result;

        if (isWeakGeneratedDescription(draft?.description)) {
          throw new Error(
            "La IA no devolvio una descripcion visual util. No se guardara una plantilla generica; reintentando con Groq premium.",
          );
        }

        return result;
      },
    );
  };

  const enrichProductOperationalData = (
    product: ProductData,
    previewImage: string | null,
    options?: { publicationStatusOverride?: string },
  ) => {
    const readiness = evaluateProductReadiness({
      artworkName: product.artworkName,
      title: product.title,
      description: product.description,
      category: product.category,
      price: product.price,
      observations: product.observations,
      condition: product.condition,
      conditionDetails: product.condition_details,
      sceneType: product.scene_type,
      idSection: product.id_section,
      imagePreview: previewImage,
      reviewChecklist: product.reviewChecklist,
      artist: inputData?.artist ?? "",
    });
    const isAlreadyTerminal =
      product.publicationStatus === "published" ||
      product.publicationStatus === "failed" ||
      product.publicationStatus === "publishing";
    const isApproved =
      product.reviewStatus === "ready_to_publish" ||
      product.publicationStatus === "ready_to_publish" ||
      product.reviewStatus === "reviewed";
    const reviewStatus =
      isApproved && readiness.isReadyToPublish
        ? "ready_to_publish"
        : "pending_review";
    const publicationStatus =
      options?.publicationStatusOverride ??
      (isAlreadyTerminal ? product.publicationStatus : reviewStatus);
    const generatedSnapshot =
      product.generatedSnapshot ??
      buildGeneratedSnapshot({
        artworkName: product.artworkName,
        title: product.title,
        description: product.description,
        category: product.category,
        price: product.price,
        observations: product.observations,
        condition: product.condition,
        conditionDetails: product.condition_details,
        sceneType: product.scene_type,
        idSection: product.id_section,
      });
    const manualEditCount = countManualEdits(
      {
        artworkName: product.artworkName,
        title: product.title,
        description: product.description,
        category: product.category,
        price: product.price,
        observations: product.observations,
        condition: product.condition,
        conditionDetails: product.condition_details,
        sceneType: product.scene_type,
        idSection: product.id_section,
      },
      generatedSnapshot,
    );
    const estimatedMinutesSaved = estimateMinutesSaved({
      score: readiness.score,
      manualEditCount,
      publicationStatus,
    });
    const reviewCompletedAt = reviewStatus === "ready_to_publish"
      ? product.reviewCompletedAt || new Date().toISOString()
      : null;

    return {
      readiness,
      enrichedProduct: {
        ...product,
        publicationStatus,
        reviewChecklist: readiness.checklist,
        reviewStatus,
        reviewCompletedAt,
        qualityScore: readiness.score,
        estimatedMinutesSaved,
        manualEditCount,
        generatedSnapshot,
        generatedAt: product.generatedAt || new Date().toISOString(),
      } satisfies ProductData,
    };
  };

  const publishGeneratedDraft = async ({
    product,
    input,
    imageBase64,
  }: {
    product: ProductData;
    input: {
      artist: string;
      artworkTitle: string;
      measures: string;
      price: string;
      observations: string;
    };
    imageBase64: string;
  }) => {
    if (!credentials) {
      throw new Error("Configura tus credenciales de Todocoleccion primero.");
    }

    let workingProduct = enrichProductOperationalData(
      product,
      imageBase64,
    ).enrichedProduct;

    if (
      workingProduct.reviewStatus !== "ready_to_publish" ||
      workingProduct.publicationStatus !== "ready_to_publish"
    ) {
      throw new Error(
        "La ficha debe estar aprobada y en ready_to_publish antes de publicar.",
      );
    }

    if (!workingProduct.id) {
      const { data: inserted, error } = await supabase
        .from("art_drafts")
        .insert({
          user_id: user.id,
          artist: input.artist,
          measures: input.measures,
          price: workingProduct.price,
          observations: workingProduct.observations,
          title: workingProduct.title,
          artwork_name: workingProduct.artworkName,
          description: workingProduct.description,
          scene_type: workingProduct.scene_type,
          condition: workingProduct.condition,
          condition_details: workingProduct.condition_details,
          category: workingProduct.category,
          id_section: workingProduct.id_section,
          status: "ready_to_publish",
          publication_status: "ready_to_publish",
          image_url: imageBase64,
          original_image_url: imageBase64,
          processed_image_url: imageBase64,
          published_image_url: null,
          attribution_status: "unverified",
          ai_trace: {
            source: "batch_or_auto_generation",
            generatedAt: workingProduct.generatedAt,
            priceEstimate: workingProduct.priceEstimate ?? null,
          },
          generated_at: workingProduct.generatedAt,
          generated_snapshot: workingProduct.generatedSnapshot,
          quality_score: workingProduct.qualityScore ?? 0,
          review_checklist: workingProduct.reviewChecklist,
          review_completed_at: workingProduct.reviewCompletedAt,
          review_status: workingProduct.reviewStatus ?? "pending_review",
          estimated_minutes_saved: workingProduct.estimatedMinutesSaved ?? 0,
          manual_edit_count: workingProduct.manualEditCount ?? 0,
        })
        .select("id")
        .single();

      if (error) throw error;

      if (inserted?.id) {
        workingProduct = { ...workingProduct, id: inserted.id };
      }
    }

    const result = await publishTodocoleccion({
      credentials: {
        userId: credentials.userId,
        apiKey: credentials.apiKey,
      },
      artwork: {
        id: workingProduct.id,
        artist: input.artist,
        measures: input.measures,
        price: workingProduct.price,
        observations: workingProduct.observations || "",
        imageBase64,
        artworkName: workingProduct.artworkName,
        title: workingProduct.title,
        description: workingProduct.description,
        sceneType: workingProduct.scene_type,
        category: workingProduct.category,
        condition: workingProduct.condition,
        conditionDetails: workingProduct.condition_details,
        idSection: Number(workingProduct.id_section),
      },
    });

    if (result?.success) {
      if (workingProduct.id) {
        const publishedMetrics = enrichProductOperationalData(
          { ...workingProduct, publicationStatus: "published" },
          imageBase64,
          { publicationStatusOverride: "published" },
        ).enrichedProduct;
        const { error: publishUpdateError } = await supabase
          .from("art_drafts")
          .update({
            publication_status: "published",
            status: "published",
            tc_external_id: result.externalId ?? null,
            tc_last_error: null,
            tc_last_response: result.tcResponse ?? null,
            tc_published_at: new Date().toISOString(),
            published_image_url: imageBase64,
            quality_score: publishedMetrics.qualityScore ?? 0,
            review_checklist: publishedMetrics.reviewChecklist,
            review_completed_at: publishedMetrics.reviewCompletedAt,
            review_status: publishedMetrics.reviewStatus ?? "pending_review",
            estimated_minutes_saved:
              publishedMetrics.estimatedMinutesSaved ?? 0,
            manual_edit_count: publishedMetrics.manualEditCount ?? 0,
          })
          .eq("id", workingProduct.id);

        if (publishUpdateError) throw publishUpdateError;
      }

      return result;
    }

    if (workingProduct.id) {
      const { error: failedUpdateError } = await supabase
        .from("art_drafts")
        .update({
          publication_status: "failed",
          status: "failed",
          tc_last_error: result?.error || "Error desconocido",
          tc_last_response: result?.tcResponse ?? null,
          quality_score: workingProduct.qualityScore ?? 0,
          review_checklist: workingProduct.reviewChecklist,
          review_completed_at: workingProduct.reviewCompletedAt,
          review_status: workingProduct.reviewStatus ?? "pending_review",
          estimated_minutes_saved: workingProduct.estimatedMinutesSaved ?? 0,
          manual_edit_count: workingProduct.manualEditCount ?? 0,
        })
        .eq("id", workingProduct.id);

      if (failedUpdateError) throw failedUpdateError;
    }

    throw new Error(result?.error || "Error desconocido al publicar");
  };

  const handleGenerate = async (data: {
    image_base64: string;
    artist: string;
    artwork_title: string;
    measures: string;
    price: string;
    price_range_min: string;
    price_range_max: string;
    auto_estimate_price: boolean;
    observations: string;
  }) => {
    setIsGenerating(true);
    setProductData(null);
    setSavedMessage(null);
    setImagePreview(data.image_base64);
    const fallbackRangePrice = getFallbackRangePrice({
      min: data.price_range_min,
      max: data.price_range_max,
    });
    const seedPrice = data.price.trim() || String(fallbackRangePrice ?? "");
    const nextInputData = {
      artist: data.artist,
      artworkTitle: data.artwork_title,
      measures: data.measures,
      price: seedPrice,
      observations: data.observations,
    };
    setInputData(nextInputData);

    try {
      const result = await generateProductDraftWithDesk({
        imageBase64: data.image_base64,
        artist: data.artist,
        artworkTitle: data.artwork_title,
        measures: data.measures,
        price: seedPrice,
        observations: data.observations,
      });

      if (result?.error) throw new Error(result.error);

      const generatedDraft = result?.draft ?? result;
      const nextProductData = mapDraftToProductData({
        id: String(
          generatedDraft.id ?? generatedDraft.draftId ?? crypto.randomUUID(),
        ),
        user_id: user.id,
        ai_trace: {},
        attribution_status: "unverified",
        artist: data.artist,
        measures: data.measures,
        price: String(generatedDraft.price ?? seedPrice),
        observations: String(generatedDraft.observations ?? data.observations),
        image_url: data.image_base64,
        original_image_url: data.image_base64,
        processed_image_url: data.image_base64,
        published_image_url: null,
        title: String(generatedDraft.title ?? ""),
        generated_title: String(generatedDraft.title ?? ""),
        final_title: String(generatedDraft.title ?? ""),
        artwork_name: String(generatedDraft.artwork_name ?? ""),
        description: String(generatedDraft.description ?? ""),
        generated_description: String(generatedDraft.description ?? ""),
        final_description: String(generatedDraft.description ?? ""),
        scene_type: String(generatedDraft.scene_type ?? ""),
        condition: Number(generatedDraft.condition ?? 3),
        condition_details: String(
          generatedDraft.condition_details ?? "Buen estado general",
        ),
        category: String(generatedDraft.category ?? "Arte"),
        id_section:
          typeof generatedDraft.id_section === "number"
            ? generatedDraft.id_section
            : DEFAULT_TC_SECTION,
        status: "pending_review",
        publication_status: String(
          generatedDraft.publication_status ?? "pending_review",
        ),
        source_type: "single_upload",
        source_path: null,
        import_batch_id: null,
        inherited_artist: null,
        inherited_category: null,
        inherited_measures: null,
        inherited_price: null,
        is_user_edited: false,
        user_edited_fields: [],
        parsing_warnings: [],
        publish_attempts: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tc_external_id: null,
        tc_last_error: null,
        tc_last_response: null,
        tc_published_at: null,
        estimated_minutes_saved: 0,
        generated_at: new Date().toISOString(),
        generated_snapshot: null,
        manual_edit_count: 0,
        quality_score: 0,
        review_checklist: {
          imageChecked: false,
          titleChecked: false,
          descriptionChecked: false,
          categoryChecked: false,
          priceChecked: false,
        },
        review_completed_at: null,
        review_status: "pending_review",
      });
      const { enrichedProduct } = enrichProductOperationalData(
        nextProductData,
        data.image_base64,
      );
      const priceEstimate = estimatePriceForProduct(
        enrichedProduct,
        {
          min: data.price_range_min,
          max: data.price_range_max,
        },
        data.auto_estimate_price,
      );
      const pricedProduct = priceEstimate
        ? {
            ...enrichedProduct,
            price: String(priceEstimate.recommended),
            priceEstimate,
          }
        : enrichedProduct;

      setProductData(pricedProduct);

      if (isPaused) {
        await upsertLocalDraft(
          buildDraftRecordFromProduct({
            product: pricedProduct,
            userId: user.id,
            artist: data.artist,
            measures: data.measures,
            originalImageUrl: data.image_base64,
            processedImageUrl: data.image_base64,
            source: "single_generation_local",
            sourceType: "single_upload",
          }),
        );
      } else if (pricedProduct.id) {
        const { error: updateError } = await supabase
          .from("art_drafts")
          .update({
            price: pricedProduct.price,
            ai_trace: {
              source: "single_generation",
              generatedAt: pricedProduct.generatedAt,
              priceEstimate,
            },
            image_url: data.image_base64,
            original_image_url: data.image_base64,
            processed_image_url: data.image_base64,
            published_image_url: null,
            status: "pending_review",
            publication_status: "pending_review",
            generated_at: pricedProduct.generatedAt,
            generated_snapshot: pricedProduct.generatedSnapshot,
            quality_score: pricedProduct.qualityScore ?? 0,
            review_checklist: pricedProduct.reviewChecklist,
            review_completed_at: pricedProduct.reviewCompletedAt,
            review_status: pricedProduct.reviewStatus ?? "pending_review",
            estimated_minutes_saved:
              pricedProduct.estimatedMinutesSaved ?? 0,
            manual_edit_count: pricedProduct.manualEditCount ?? 0,
          })
          .eq("id", pricedProduct.id);

        if (updateError) throw updateError;
      }
      triggerRefresh();

      toast({
        title: "Ficha generada",
        description:
          "La ficha queda pendiente de revision. Apruebala antes de publicar.",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo generar la ficha.";

      toast({
        title: "Error al generar ficha",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async (data: ProductData) => {
    setIsSaving(true);
    setSavedMessage(null);

    try {
      const { enrichedProduct } = enrichProductOperationalData(
        data,
        imagePreview,
      );
      let finalProduct = enrichedProduct;
      const draftPayload = {
        user_id: user.id,
        artist: inputData?.artist || "",
        measures: inputData?.measures || "",
        price: enrichedProduct.price,
        observations: enrichedProduct.observations,
        title: enrichedProduct.title,
        artwork_name: enrichedProduct.artworkName,
        description: enrichedProduct.description,
        scene_type: enrichedProduct.scene_type,
        condition: enrichedProduct.condition,
        condition_details: enrichedProduct.condition_details,
        category: enrichedProduct.category,
        id_section: enrichedProduct.id_section,
        status: enrichedProduct.publicationStatus || "pending_review",
        publication_status:
          enrichedProduct.publicationStatus || "pending_review",
        image_url: imagePreview || null,
        original_image_url: imagePreview || null,
        processed_image_url: imagePreview || null,
        published_image_url:
          enrichedProduct.publicationStatus === "published" ? imagePreview : null,
        attribution_status: "unverified",
        ai_trace: {
          source: "manual_save",
          generatedAt: enrichedProduct.generatedAt,
          priceEstimate: enrichedProduct.priceEstimate ?? null,
        },
        source_type: "manual",
        generated_title: enrichedProduct.generatedSnapshot?.title ?? enrichedProduct.title,
        final_title: enrichedProduct.title,
        generated_description:
          enrichedProduct.generatedSnapshot?.description ??
          enrichedProduct.description,
        final_description: enrichedProduct.description,
        generated_at: enrichedProduct.generatedAt,
        generated_snapshot: enrichedProduct.generatedSnapshot,
        quality_score: enrichedProduct.qualityScore ?? 0,
        review_checklist: enrichedProduct.reviewChecklist,
        review_completed_at: enrichedProduct.reviewCompletedAt,
        review_status: enrichedProduct.reviewStatus ?? "pending_review",
        estimated_minutes_saved: enrichedProduct.estimatedMinutesSaved ?? 0,
        manual_edit_count: enrichedProduct.manualEditCount ?? 0,
      };

      if (isPaused) {
        const localDraft = await upsertLocalDraft(
          buildDraftRecordFromProduct({
            product: enrichedProduct,
            userId: user.id,
            artist: inputData?.artist || "",
            measures: inputData?.measures || "",
            originalImageUrl: imagePreview || null,
            processedImageUrl: imagePreview || null,
            publishedImageUrl:
              enrichedProduct.publicationStatus === "published"
                ? imagePreview || null
                : null,
            source: "manual_save_local",
            sourceType: "manual",
          }),
        );
        finalProduct = {
          ...enrichedProduct,
          id: localDraft.id,
        };
      } else if (enrichedProduct.id) {
        const { error } = await supabase
          .from("art_drafts")
          .update(draftPayload)
          .eq("id", enrichedProduct.id);

        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from("art_drafts")
          .insert(draftPayload)
          .select("id")
          .single();

        if (error) throw error;

        if (inserted) {
          finalProduct = {
            ...enrichedProduct,
            id: inserted.id,
          };
        }
      }

      setProductData((prev) => (prev ? { ...prev, ...finalProduct } : finalProduct));
      setSavedMessage("Borrador guardado correctamente");
      toast({ title: "Borrador guardado" });
      triggerRefresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "No se pudo guardar el borrador.";

      toast({
        title: "Error al guardar",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async (
    data: ProductData,
    options?: {
      inputOverride?: {
        artist: string;
        artworkTitle: string;
        measures: string;
        price: string;
        observations: string;
      };
      imagePreviewOverride?: string | null;
    },
  ) => {
    if (!credentials) {
      toast({
        title: "Credenciales no configuradas",
        description: "Configura tu User ID y API Key primero.",
        variant: "destructive",
      });
      return;
    }

    const activeInputData = options?.inputOverride ?? inputData;
    const activeImagePreview = options?.imagePreviewOverride ?? imagePreview;
    const {
      readiness,
      enrichedProduct,
    } = enrichProductOperationalData(data, activeImagePreview);

    const missing: string[] = [];
    if (!enrichedProduct.title?.trim()) missing.push("titulo");
    if (!enrichedProduct.description?.trim()) missing.push("descripcion");
    if (!enrichedProduct.artworkName?.trim()) missing.push("nombre de obra");
    if (
      !enrichedProduct.price ||
      Number.isNaN(Number.parseFloat(enrichedProduct.price))
    ) {
      missing.push("precio valido");
    }
    if (!activeInputData?.artist?.trim()) missing.push("artista");
    if (
      enrichedProduct.id_section == null ||
      Number.isNaN(Number(enrichedProduct.id_section))
    ) {
      missing.push("seccion de Todocoleccion");
    }

    if (missing.length > 0) {
      toast({
        title: "Datos incompletos",
        description: `Faltan: ${missing.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    if (!readiness.isReadyToPublish) {
      toast({
        title: "Revision obligatoria antes de publicar",
        description:
          readiness.blockers[0] ||
          "Completa el checklist humano y deja la ficha en estado solido antes de enviarla.",
        variant: "destructive",
      });
      setProductData((prev) =>
        prev ? { ...prev, ...enrichedProduct } : enrichedProduct,
      );
      return;
    }

    if (
      enrichedProduct.reviewStatus !== "ready_to_publish" ||
      enrichedProduct.publicationStatus !== "ready_to_publish"
    ) {
      toast({
        title: "Aprobacion obligatoria",
        description:
          "Primero pulsa Aprobar revision. Todocoleccion solo recibe fichas en ready_to_publish.",
        variant: "destructive",
      });
      return;
    }

    setIsPublishing(true);
    setSavedMessage(null);

    data = enrichedProduct;

    if (!data.id) {
      try {
        if (isPaused) {
          const localDraft = await upsertLocalDraft(
            buildDraftRecordFromProduct({
              product: {
                ...data,
                id: crypto.randomUUID(),
                publicationStatus: "ready_to_publish",
                reviewStatus: "ready_to_publish",
              },
              userId: user.id,
              artist: activeInputData?.artist || "",
              measures: activeInputData?.measures || "",
              originalImageUrl: activeImagePreview || null,
              processedImageUrl: activeImagePreview || null,
              source: "local_publish_prepare",
              sourceType: "manual",
            }),
          );
          data = { ...data, id: localDraft.id };
          setProductData((prev) =>
            prev ? { ...prev, id: localDraft.id } : prev,
          );
        } else {
          const { data: inserted, error } = await supabase
            .from("art_drafts")
            .insert({
              user_id: user.id,
              artist: activeInputData?.artist || "",
              measures: activeInputData?.measures || "",
              price: data.price,
              observations: data.observations,
              title: data.title,
              artwork_name: data.artworkName,
              description: data.description,
              scene_type: data.scene_type,
              condition: data.condition,
              condition_details: data.condition_details,
              category: data.category,
              id_section: data.id_section,
              status: "ready_to_publish",
              publication_status: "ready_to_publish",
              image_url: activeImagePreview || null,
              original_image_url: activeImagePreview || null,
              processed_image_url: activeImagePreview || null,
              published_image_url: null,
              attribution_status: "unverified",
              ai_trace: {
                source: "single_publish",
                generatedAt: data.generatedAt,
                priceEstimate: data.priceEstimate ?? null,
              },
              generated_at: data.generatedAt,
              generated_snapshot: data.generatedSnapshot,
              quality_score: data.qualityScore ?? 0,
              review_checklist: data.reviewChecklist,
              review_completed_at: data.reviewCompletedAt,
              review_status: data.reviewStatus ?? "pending_review",
              estimated_minutes_saved: data.estimatedMinutesSaved ?? 0,
              manual_edit_count: data.manualEditCount ?? 0,
            })
            .select("id")
            .single();

          if (error) throw error;

          if (inserted) {
            data = { ...data, id: inserted.id };
            setProductData((prev) =>
              prev ? { ...prev, id: inserted.id } : prev,
            );
          }
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Error desconocido";

        toast({
          title: "Error al guardar antes de publicar",
          description: message,
          variant: "destructive",
        });
        setIsPublishing(false);
        return;
      }
    }

    setProductData((prev) =>
      prev ? { ...prev, publicationStatus: "publishing" } : prev,
    );

    try {
      const result = await publishTodocoleccion({
        credentials: {
          userId: credentials.userId,
          apiKey: credentials.apiKey,
        },
        artwork: {
          id: data.id,
          artist: activeInputData?.artist || "",
          measures: activeInputData?.measures || "",
          price: data.price,
          observations: data.observations || "",
          imageBase64: activeImagePreview || undefined,
          artworkName: data.artworkName,
          title: data.title,
          description: data.description,
          sceneType: data.scene_type,
          category: data.category,
          condition: data.condition,
          conditionDetails: data.condition_details,
          idSection: Number(data.id_section),
        },
      });

      if (result?.success) {
        if (data.id) {
          const publishedMetrics = enrichProductOperationalData(
            { ...data, publicationStatus: "published" },
            activeImagePreview,
            { publicationStatusOverride: "published" },
          ).enrichedProduct;
          const publishUpdatePayload = {
              publication_status: "published",
              status: "published",
              tc_external_id: result.externalId ?? null,
              tc_last_error: null,
              tc_last_response: result.tcResponse ?? null,
              tc_published_at: new Date().toISOString(),
              published_image_url: activeImagePreview || null,
              quality_score: publishedMetrics.qualityScore ?? 0,
              review_checklist: publishedMetrics.reviewChecklist,
              review_completed_at: publishedMetrics.reviewCompletedAt,
              review_status: publishedMetrics.reviewStatus ?? "pending_review",
              estimated_minutes_saved:
                publishedMetrics.estimatedMinutesSaved ?? 0,
              manual_edit_count: publishedMetrics.manualEditCount ?? 0,
            };

          if (isPaused) {
            await deleteLocalDraft(data.id);
          } else {
            const { error: publishUpdateError } = await supabase
              .from("art_drafts")
              .update(publishUpdatePayload)
              .eq("id", data.id);

            if (publishUpdateError) throw publishUpdateError;
          }
        }

        setProductData((prev) =>
          prev
            ? {
                ...prev,
                publicationStatus: "published",
                tcExternalId: result.externalId,
                tcPublishedAt: new Date().toISOString(),
                tcLastError: null,
              }
            : prev,
        );

        setSavedMessage(
          `Publicado en Todocoleccion${
            result.externalId ? ` (ID: ${result.externalId})` : ""
          }`,
        );

        toast({
          title: "Publicado",
          description: result.message || "Publicacion completada.",
        });
      } else {
        if (data.id) {
          const failedUpdatePayload = {
              publication_status: "failed",
              status: "failed",
              tc_last_error: result?.error || "Error desconocido",
              tc_last_response: result?.tcResponse ?? null,
              quality_score: data.qualityScore ?? 0,
              review_checklist: data.reviewChecklist,
              review_completed_at: data.reviewCompletedAt,
              review_status: data.reviewStatus ?? "pending_review",
              estimated_minutes_saved: data.estimatedMinutesSaved ?? 0,
              manual_edit_count: data.manualEditCount ?? 0,
            };

          if (isPaused) {
            await updateLocalDraft(data.id, (draft) => ({
              ...draft,
              ...failedUpdatePayload,
            }));
          } else {
            const { error: failedUpdateError } = await supabase
              .from("art_drafts")
              .update(failedUpdatePayload)
              .eq("id", data.id);

            if (failedUpdateError) throw failedUpdateError;
          }
        }

        const debugText = result?.debug
          ? ` | debug: ${JSON.stringify(result.debug)}`
          : "";

        setProductData((prev) =>
          prev
            ? {
                ...prev,
                publicationStatus: "failed",
                tcLastError: result?.error || "Error desconocido",
              }
            : prev,
        );

        toast({
          title: "Error al publicar",
          description: `${result?.error || "Error desconocido"}${debugText}`,
          variant: "destructive",
        });
      }

      triggerRefresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "No se pudo conectar con Todocoleccion.";

      if (data.id) {
        const failedUpdatePayload = {
            publication_status: "failed",
            status: "failed",
            tc_last_error: message,
            quality_score: data.qualityScore ?? 0,
            review_checklist: data.reviewChecklist,
            review_completed_at: data.reviewCompletedAt,
            review_status: data.reviewStatus ?? "pending_review",
            estimated_minutes_saved: data.estimatedMinutesSaved ?? 0,
            manual_edit_count: data.manualEditCount ?? 0,
          };

        if (isPaused) {
          await updateLocalDraft(data.id, (draft) => ({
            ...draft,
            ...failedUpdatePayload,
          }));
        } else {
          const { error: failedUpdateError } = await supabase
            .from("art_drafts")
            .update(failedUpdatePayload)
            .eq("id", data.id);

          if (failedUpdateError) {
            console.error("No se pudo registrar el fallo de publicacion:", failedUpdateError);
          }
        }
      }

      setProductData((prev) =>
        prev
          ? {
              ...prev,
              publicationStatus: "failed",
              tcLastError: message,
            }
          : prev,
      );

      toast({
        title: "Error al publicar",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleLoadDraft = async (draft: DraftRow) => {
    setInputData({
      artist: draft.artist || "",
      artworkTitle: draft.artwork_name || "",
      measures: draft.measures || "",
      price: draft.price || "",
      observations: draft.observations || "",
    });

    setImagePreview(draft.image_url || null);
    setProductData(mapDraftToProductData(draft));
    setSavedMessage(null);

    toast({
      title: "Borrador cargado",
      description: "Ya puedes revisarlo, editarlo o publicarlo.",
    });
  };

  const handlePublishDraft = async (draft: { id: string }) => {
    if (!credentials) {
      toast({
        title: "Configura tus credenciales primero",
        variant: "destructive",
      });
      return;
    }

    try {
      let fullDraft: DraftRow | null = null;

      if (isPaused) {
        fullDraft =
          (await loadLocalDrafts()).find((item) => item.id === draft.id) ??
          null;
        if (!fullDraft) {
          throw new Error("No se encontro el borrador local.");
        }
      } else {
        const { data, error } = await supabase
          .from("art_drafts")
          .select("*")
          .eq("id", draft.id)
          .single();

        if (error) throw error;
        fullDraft = data as DraftRow;
      }

      const loadedProductData = mapDraftToProductData(fullDraft);
      const draftInputData = {
        artist: fullDraft.artist || "",
        artworkTitle: fullDraft.artwork_name || "",
        measures: fullDraft.measures || "",
        price: fullDraft.price || "",
        observations: fullDraft.observations || "",
      };
      const draftImage = fullDraft.image_url || fullDraft.processed_image_url || null;

      setInputData(draftInputData);

      setImagePreview(draftImage);
      setProductData(loadedProductData);

      await handlePublish(loadedProductData, {
        inputOverride: draftInputData,
        imagePreviewOverride: draftImage,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Error desconocido al cargar borrador";

      toast({
        title: "Error al cargar borrador",
        description: message,
        variant: "destructive",
      });
    }
  };

  const runBatchPublish = async (
    batchInput: BatchPublishInput,
    itemsToProcess?: BatchPublishInput["items"],
  ) => {
    const shouldAutoPublish = false;

    if (batchInput.publicationMode === "auto_publish") {
      toast({
        title: "Autopublicacion desactivada",
        description:
          "El lote se generara como borradores para revision manual obligatoria.",
      });
    }

    setIsBatchPublishing(true);
    setLastBatchInput(batchInput);
    const selectedItems = itemsToProcess ?? batchInput.items;
    const fallbackRangePrice = getFallbackRangePrice({
      min: batchInput.priceRangeMin,
      max: batchInput.priceRangeMax,
    });
    const seedPrice = batchInput.price.trim() || String(fallbackRangePrice ?? "");

    if (!seedPrice) {
      toast({
        title: "Precio o rango necesario",
        description:
          "Indica un precio comun o un rango minimo/maximo para estimar el lote.",
        variant: "destructive",
      });
      setIsBatchPublishing(false);
      return;
    }

    const previousResults = itemsToProcess ? batchResults : [];
    const nextResults: BatchPublishResult[] = itemsToProcess
      ? previousResults.filter((item) => item.status === "failed")
      : [];
    if (!itemsToProcess) {
      setBatchResults([]);
    }
    setRemainingBatchFileNames(selectedItems.map((item) => item.fileName));
    setBatchProgressText(`Preparando lote de ${selectedItems.length} imagenes...`);

    try {
      for (const [index, item] of selectedItems.entries()) {
        setBatchProgressText(
          `Procesando ${index + 1} de ${selectedItems.length}: ${item.fileName}`,
        );
        let product: ProductData | null = null;

        try {
          const preparedImage = await prepareArtworkImage({
            imageBase64: item.imageBase64,
            autoCrop: batchInput.autoCrop,
            autoOrient: batchInput.autoOrient,
            detectOrientation: detectImageOrientationWithDesk,
            useOrientationVariants: false,
          });

          setBatchProgressText(
            `Generando ficha ${index + 1} de ${selectedItems.length}: ${item.fileName}`,
          );

          const generated = await generateProductDraftWithDesk({
            imageBase64: preparedImage.imageBase64,
            artist: batchInput.artist,
            artworkTitle: "",
            measures: batchInput.measures,
            price: seedPrice,
            observations: batchInput.observations,
          });

          if (generated?.error) {
            throw new Error(generated.error);
          }

          const generatedDraft = generated?.draft ?? generated;
          const draftProduct = mapDraftToProductData({
            id: String(
              generatedDraft.id ?? generatedDraft.draftId ?? crypto.randomUUID(),
            ),
            user_id: user.id,
            ai_trace: {},
            attribution_status: "unverified",
            artist: batchInput.artist,
            measures: batchInput.measures,
            price: String(generatedDraft.price ?? seedPrice),
            observations: String(
              generatedDraft.observations ?? batchInput.observations,
            ),
            image_url: preparedImage.imageBase64,
            original_image_url: item.imageBase64,
            processed_image_url: preparedImage.imageBase64,
            published_image_url: null,
            title: String(generatedDraft.title ?? ""),
            generated_title: String(generatedDraft.title ?? ""),
            final_title: String(generatedDraft.title ?? ""),
            artwork_name: String(generatedDraft.artwork_name ?? ""),
            description: String(generatedDraft.description ?? ""),
            generated_description: String(generatedDraft.description ?? ""),
            final_description: String(generatedDraft.description ?? ""),
            scene_type: String(generatedDraft.scene_type ?? ""),
            condition: Number(generatedDraft.condition ?? 3),
            condition_details: String(
              generatedDraft.condition_details ?? "Buen estado general",
            ),
            category: String(generatedDraft.category ?? "Arte"),
            id_section:
              typeof generatedDraft.id_section === "number"
                ? generatedDraft.id_section
                : DEFAULT_TC_SECTION,
            status: "pending_review",
            publication_status: "pending_review",
            source_type: "batch_upload",
            source_path: null,
            import_batch_id: null,
            inherited_artist: null,
            inherited_category: null,
            inherited_measures: null,
            inherited_price: null,
            is_user_edited: false,
            user_edited_fields: [],
            parsing_warnings: [],
            publish_attempts: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            tc_external_id: null,
            tc_last_error: null,
            tc_last_response: null,
            tc_published_at: null,
            estimated_minutes_saved: 0,
            generated_at: new Date().toISOString(),
            generated_snapshot: null,
            manual_edit_count: 0,
            quality_score: 0,
            review_checklist: {
              imageChecked: false,
              titleChecked: false,
              descriptionChecked: false,
              categoryChecked: false,
              priceChecked: false,
            },
            review_completed_at: null,
            review_status: "pending_review",
          });
          const { enrichedProduct } = enrichProductOperationalData(
            draftProduct,
            preparedImage.imageBase64,
          );
          const priceEstimate = estimatePriceForProduct(
            enrichedProduct,
            {
              min: batchInput.priceRangeMin,
              max: batchInput.priceRangeMax,
            },
            batchInput.autoEstimatePrice,
          );
          product = priceEstimate
            ? {
                ...enrichedProduct,
                price: String(priceEstimate.recommended),
                priceEstimate,
              }
            : enrichedProduct;

          if (isPaused) {
            await upsertLocalDraft(
              buildDraftRecordFromProduct({
                product,
                userId: user.id,
                artist: batchInput.artist,
                measures: batchInput.measures,
                originalImageUrl: item.imageBase64,
                processedImageUrl: preparedImage.imageBase64,
                source: "batch_generation_local",
                sourceType: "batch_upload",
              }),
            );
          } else if (product.id) {
            const { error: updateError } = await supabase
              .from("art_drafts")
              .update({
                price: product.price,
                image_url: preparedImage.imageBase64,
                original_image_url: item.imageBase64,
                processed_image_url: preparedImage.imageBase64,
                published_image_url: null,
                status: "pending_review",
                publication_status: "pending_review",
                source_type: "batch_upload",
                ai_trace: {
                  source: "batch_generation",
                  generatedAt: product.generatedAt,
                  priceEstimate,
                },
                generated_at: product.generatedAt,
                generated_snapshot: product.generatedSnapshot,
                quality_score: product.qualityScore ?? 0,
                review_checklist: product.reviewChecklist,
                review_completed_at: product.reviewCompletedAt,
                review_status: product.reviewStatus ?? "pending_review",
                estimated_minutes_saved: product.estimatedMinutesSaved ?? 0,
                manual_edit_count: product.manualEditCount ?? 0,
              })
              .eq("id", product.id);

            if (updateError) throw updateError;
          }

          setRemainingBatchFileNames((prev) =>
            prev.filter((name) => name !== item.fileName),
          );
        } catch (error) {
          setRemainingBatchFileNames((prev) =>
            prev.includes(item.fileName) ? prev : [...prev, item.fileName],
          );
          const failedIndex = nextResults.findIndex(
            (result) => result.fileName === item.fileName,
          );
          const failedResult = {
            fileName: item.fileName,
            status: "failed" as const,
            message: `No se creo borrador: la descripcion premium es obligatoria. ${getErrorMessage(error)}`,
          };

          if (failedIndex >= 0) {
            nextResults.splice(failedIndex, 1, failedResult);
          } else {
            nextResults.push(failedResult);
          }

          setBatchResults([...nextResults]);
          continue;
        }

        if (!product) {
          continue;
        }

        const existingFailedIndex = nextResults.findIndex(
          (result) => result.fileName === item.fileName,
        );
        const successResult: BatchPublishResult = {
          fileName: item.fileName,
          status: shouldAutoPublish ? "published" : "drafted",
          title: product.title,
          message: shouldAutoPublish
            ? "Publicada en Todocoleccion."
            : "Borrador generado para revision humana.",
        };

        if (existingFailedIndex >= 0) {
          nextResults.splice(existingFailedIndex, 1, successResult);
        } else {
          nextResults.push(successResult);
        }

        setBatchResults([...nextResults]);

        const hasMoreFiles = index < selectedItems.length - 1;
        const delayMs = Math.max(0, batchInput.delaySeconds) * 1000;

        if (hasMoreFiles && delayMs > 0) {
          setBatchProgressText(
            `Esperando ${batchInput.delaySeconds}s antes de continuar con la siguiente imagen...`,
          );
          await sleep(delayMs);
        }
      }

      const failedCount = nextResults.filter(
        (result) => result.status === "failed",
      ).length;
      const publishedCount = nextResults.filter(
        (result) => result.status === "published",
      ).length;
      const draftedCount = nextResults.filter(
        (result) => result.status === "drafted",
      ).length;

      setBatchProgressText(
        failedCount > 0
          ? `Lote finalizado: ${publishedCount} publicadas, ${draftedCount} borradores, ${failedCount} pendientes por error.`
          : shouldAutoPublish
            ? `Lote finalizado: ${publishedCount} publicadas.`
            : `Lote finalizado: ${draftedCount} borradores listos para revisar.`,
      );
      triggerRefresh();

      toast({
        title: "Lote procesado",
        description:
          failedCount > 0
            ? `${publishedCount} publicadas, ${draftedCount} borradores, ${failedCount} pendientes por error.`
            : shouldAutoPublish
              ? `${publishedCount} publicadas correctamente.`
              : `${draftedCount} borradores generados para revisar.`,
        variant: failedCount > 0 ? "destructive" : "default",
      });
    } finally {
      setIsBatchPublishing(false);
    }
  };

  const handleBatchPublish = async (batchInput: BatchPublishInput) => {
    await runBatchPublish(batchInput);
  };

  const handleRetryFailedBatch = async () => {
    if (!lastBatchInput) {
      toast({
        title: "No hay lote previo",
        description: "Primero publica un lote para poder reintentar fallidos.",
        variant: "destructive",
      });
      return;
    }

    const failedFiles = lastBatchInput.items.filter((item) =>
      batchResults.some(
        (result) => result.status === "failed" && result.fileName === item.fileName,
      ),
    );

    if (failedFiles.length === 0) {
      toast({
        title: "No hay fallidos",
        description: "Todos los articulos del lote ya estan publicados.",
      });
      return;
    }

    await runBatchPublish(lastBatchInput, failedFiles);
  };

  const handleFolderImport = async (folderInput: FolderImportInput) => {
    setIsFolderImporting(true);
    setFolderImportProgress({
      status: "processing",
      total: folderInput.items.length,
      processed: 0,
      failed: 0,
      ready: 0,
      currentFile: null,
      failedItems: [],
    });

    let importBatchId: string | null = null;
    const rootName = folderInput.items[0]?.folders[0] ?? "Importacion";
    const batchWarnings: Array<{ file: string; warnings: string[] }> =
      folderInput.items
        .filter((item) => item.warnings.length > 0)
        .map((item) => ({
          file: item.relativePath,
          warnings: item.warnings,
        }));

    if (!isPaused) {
      try {
        const { data: batch, error } = await supabase
          .from("import_batches")
          .insert({
            user_id: user.id,
            root_name: rootName,
            status: "processing",
            total_images: folderInput.items.length,
            pending_images: folderInput.items.length,
            parsing_warnings: batchWarnings,
          })
          .select("id")
          .single();

        if (!error && batch?.id) {
          importBatchId = batch.id;
        }
      } catch {
        importBatchId = null;
      }
    }

    let processed = 0;
    let failed = 0;
    let ready = 0;
    const failedItems: FolderImportProgress["failedItems"] = [];
    const runtimeWarnings: Array<{ file: string; error: string }> = [];
    const analysisDelaySeconds = Math.max(0, folderInput.delaySeconds || 0);
    const analysisDelayMs = analysisDelaySeconds * 1000;

    const processImportedItem = async (
      item: FolderImportInput["items"][number],
    ) => {
      const originalImage = await readFileAsDataUrl(item.file);
      const preparedImage = await prepareArtworkImage({
        imageBase64: originalImage,
        autoCrop: folderInput.autoCrop,
        autoOrient: folderInput.autoOrient,
        detectOrientation: detectImageOrientationWithDesk,
        useOrientationVariants: false,
      });
      const generated = await generateProductDraftWithDesk({
        imageBase64: preparedImage.imageBase64,
        artist: item.metadata.artist ?? "",
        artworkTitle: "",
        measures: item.metadata.measures ?? "",
        price: item.metadata.price ?? "",
        observations: item.metadata.observations ?? "",
        sourceType: "folder_import",
        sourcePath: item.relativePath,
        importBatchId,
        inheritedArtist: item.metadata.artist,
        inheritedCategory: item.metadata.category,
        inheritedMeasures: item.metadata.measures,
        inheritedPrice: item.metadata.priceNumber,
        parsingWarnings: item.warnings,
        imageUrl: preparedImage.imageBase64,
      });

      if (generated?.error) throw new Error(generated.error);

      const generatedDraft = generated?.draft ?? generated;
      const draftId = String(
        generatedDraft.id ?? generatedDraft.draftId ?? crypto.randomUUID(),
      );
      const draftProduct = mapDraftToProductData({
        id: draftId,
        user_id: user.id,
        artist: item.metadata.artist ?? "",
        measures: item.metadata.measures ?? "",
        price: String(generatedDraft.price ?? item.metadata.price ?? ""),
        observations: String(
          generatedDraft.observations ?? item.metadata.observations ?? "",
        ),
        image_url: preparedImage.imageBase64,
        original_image_url: originalImage,
        processed_image_url: preparedImage.imageBase64,
        published_image_url: null,
        artwork_name: String(generatedDraft.artwork_name ?? ""),
        title: String(generatedDraft.title ?? ""),
        description: String(generatedDraft.description ?? ""),
        scene_type: String(
          generatedDraft.scene_type ?? item.metadata.sceneType ?? "",
        ),
        category: String(
          generatedDraft.category ?? item.metadata.category ?? "Arte",
        ),
        condition: Number(generatedDraft.condition ?? 3),
        condition_details: String(
          generatedDraft.condition_details ?? "Buen estado general",
        ),
        id_section:
          typeof generatedDraft.id_section === "number"
            ? generatedDraft.id_section
            : DEFAULT_TC_SECTION,
        status: "pending_review",
        publication_status: "pending_review",
        source_type: "folder_import",
        source_path: item.relativePath,
        import_batch_id: importBatchId,
        inherited_artist: item.metadata.artist,
        inherited_category: item.metadata.category,
        inherited_measures: item.metadata.measures,
        inherited_price: item.metadata.priceNumber,
        is_user_edited: false,
        user_edited_fields: [],
        generated_title: String(generatedDraft.title ?? ""),
        final_title: String(generatedDraft.title ?? ""),
        generated_description: String(generatedDraft.description ?? ""),
        final_description: String(generatedDraft.description ?? ""),
        parsing_warnings: item.warnings,
        publish_attempts: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ai_trace: {},
        attribution_status: "unverified",
        generated_at: new Date().toISOString(),
        generated_snapshot: null,
        manual_edit_count: 0,
        quality_score: 0,
        review_checklist: {
          imageChecked: false,
          titleChecked: false,
          descriptionChecked: false,
          categoryChecked: false,
          priceChecked: false,
        },
        review_completed_at: null,
        review_status: "pending_review",
        tc_external_id: null,
        tc_last_error: null,
        tc_last_response: null,
        tc_published_at: null,
        estimated_minutes_saved: 0,
      });
      const { enrichedProduct } = enrichProductOperationalData(
        draftProduct,
        preparedImage.imageBase64,
      );

      if (isPaused) {
        await upsertLocalDraft(
          buildDraftRecordFromProduct({
            product: enrichedProduct,
            userId: user.id,
            artist: item.metadata.artist ?? "",
            measures: item.metadata.measures ?? "",
            originalImageUrl: originalImage,
            processedImageUrl: preparedImage.imageBase64,
            source: "folder_import_local",
            sourceType: "folder_import",
            sourcePath: item.relativePath,
            importBatchId: null,
            inheritedArtist: item.metadata.artist,
            inheritedCategory: item.metadata.category,
            inheritedMeasures: item.metadata.measures,
            inheritedPrice: item.metadata.priceNumber,
            parsingWarnings: item.warnings,
          }),
        );
      } else if (draftId) {
        const { error: updateError } = await supabase
          .from("art_drafts")
          .update({
            source_type: "folder_import",
            source_path: item.relativePath,
            import_batch_id: importBatchId,
            inherited_artist: item.metadata.artist,
            inherited_category: item.metadata.category,
            inherited_measures: item.metadata.measures,
            inherited_price: item.metadata.priceNumber,
            parsing_warnings: item.warnings,
            image_url: preparedImage.imageBase64,
            original_image_url: originalImage,
            processed_image_url: preparedImage.imageBase64,
            status: "pending_review",
            publication_status: "pending_review",
            review_status: "pending_review",
            generated_title: String(generatedDraft.title ?? ""),
            final_title: String(generatedDraft.title ?? ""),
            generated_description: String(generatedDraft.description ?? ""),
            final_description: String(generatedDraft.description ?? ""),
            ai_trace: {
              source: "folder_import",
              sourcePath: item.relativePath,
              parsingLogs: item.logs,
              parsingWarnings: item.warnings,
            },
          })
          .eq("id", draftId);

        if (updateError) throw updateError;
      }
    };

    try {
      for (const [index, item] of folderInput.items.entries()) {
        if (index > 0 && analysisDelayMs > 0) {
          setFolderImportProgress({
            status: "processing",
            total: folderInput.items.length,
            processed,
            failed,
            ready,
            currentFile: `Esperando ${analysisDelaySeconds}s antes de analizar ${item.fileName}`,
            failedItems: [...failedItems],
          });
          await sleep(analysisDelayMs);
        }

        setFolderImportProgress({
          status: "processing",
          total: folderInput.items.length,
          processed,
          failed,
          ready,
          currentFile: item.fileName,
          failedItems: [...failedItems],
        });

        try {
          await processImportedItem(item);

          processed += 1;
          ready += 1;
          triggerRefresh();
        } catch (error) {
          failed += 1;
          const runtimeError = `No se creo borrador: la descripcion premium es obligatoria. ${getErrorMessage(error)}`;
          runtimeWarnings.push({
            file: item.relativePath,
            error: runtimeError,
          });
          const existingFailedItemIndex = failedItems.findIndex(
            (failedItem) => failedItem.relativePath === item.relativePath,
          );
          const failedItem = {
            fileName: item.fileName,
            relativePath: item.relativePath,
            error: runtimeError,
          };

          if (existingFailedItemIndex >= 0) {
            failedItems.splice(existingFailedItemIndex, 1, failedItem);
          } else {
            failedItems.push(failedItem);
          }

          setFolderImportProgress({
            status: "processing",
            total: folderInput.items.length,
            processed,
            failed,
            ready,
            currentFile:
              `Sin descripcion premium: ${item.fileName} queda para reintento`,
            failedItems: [...failedItems],
          });
        }

        if (importBatchId && !isPaused) {
          await supabase
            .from("import_batches")
            .update({
              processed_images: processed,
              failed_images: failed,
              ready_for_review: ready,
              pending_images: Math.max(
                0,
                folderInput.items.length - processed - failed,
              ),
              parsing_warnings: [...batchWarnings, ...runtimeWarnings],
            })
            .eq("id", importBatchId);
        }

        setFolderImportProgress({
          status: "processing",
          total: folderInput.items.length,
          processed,
          failed,
          ready,
          currentFile: item.fileName,
          failedItems: [...failedItems],
        });
      }

      const finalStatus =
        failed > 0 ? "completed_with_errors" : "completed";

      if (importBatchId && !isPaused) {
        await supabase
          .from("import_batches")
          .update({
            status: finalStatus,
            processed_images: processed,
            failed_images: failed,
            ready_for_review: ready,
            pending_images: 0,
            completed_at: new Date().toISOString(),
            parsing_warnings: [...batchWarnings, ...runtimeWarnings],
          })
          .eq("id", importBatchId);
      }

      setFolderImportProgress({
        status: finalStatus,
        total: folderInput.items.length,
        processed,
        failed,
        ready,
        currentFile: null,
        failedItems: [...failedItems],
      });
      triggerRefresh();
      const firstRuntimeError = runtimeWarnings[0]?.error;
      toast({
        title: "Importacion por carpetas finalizada",
        description:
          failed > 0
            ? `${ready} fichas listas para revisar y ${failed} con error.${firstRuntimeError ? ` Primer error: ${firstRuntimeError}` : ""}`
            : `${ready} fichas listas para revisar.`,
        variant: failed > 0 ? "destructive" : "default",
      });
    } finally {
      setIsFolderImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <img
              src="/artficha-favicon.jpeg"
              alt="ArtFicha"
              className="h-8 w-8 rounded-lg object-cover"
            />
            <span className="text-lg font-extrabold tracking-tight text-slate-950">
              ArtFicha
            </span>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-700 md:flex">
            <button
              type="button"
              onClick={() => scrollToSection("generar-ficha")}
              className="transition-colors hover:text-slate-950"
            >
              Generar ficha
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("importacion-por-carpetas")}
              className="transition-colors hover:text-slate-950"
            >
              Importacion por carpetas
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("revision-masiva")}
              className="transition-colors hover:text-slate-950"
            >
              Revision masiva
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("publicacion-por-lote")}
              className="transition-colors hover:text-slate-950"
            >
              Publicacion por lote
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("ajustes")}
              className="transition-colors hover:text-slate-950"
            >
              Ajustes
            </button>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-[220px] truncate text-sm text-slate-500 sm:block">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        <section className="mx-auto max-w-5xl text-center">
          <div className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">
            IA para catalogacion visual
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-950 sm:text-6xl">
            <span className="block">
              <span className="text-blue-600">ArtFicha</span> automatiza
            </span>
            <span className="block pt-3">fichas de producto</span>
            <span className="block pt-3 text-[0.94em] text-slate-500">
              desde <span className="text-blue-600">imagenes</span>
            </span>
          </h1>
          <p className="mx-auto mt-7 max-w-4xl text-lg leading-8 text-slate-600">
            Sube una imagen y genera fichas listas para revisar y publicar en
            un flujo claro.
          </p>
          <p className="mx-auto mt-4 max-w-3xl rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm leading-6 text-slate-500">
            Hoy ArtFicha esta centrado en arte plastico, como lienzos,
            dibujos, acuarelas y obra sobre papel. Mas adelante ampliaremos la
            herramienta a nuevas tipologias de obra y catalogacion.
          </p>
        </section>

        <section id="ajustes" className="scroll-mt-6">
          <div className={`${balancedSplitGrid} auto-rows-fr items-stretch`}>
            <div className="h-full">
              <Suspense fallback={<PanelFallback />}>
                <SettingsPanel
                  onCredentialsChange={setCredentials}
                  onGrokCredentialsChange={setGrokCredentials}
                />
              </Suspense>
            </div>
            {isPaused ? (
              <div className="flex h-full min-h-[8.75rem] flex-col justify-center rounded-[1.5rem] border border-blue-100 bg-blue-50/90 px-6 py-6 text-sm text-blue-900 shadow-[0_24px_80px_-55px_rgba(15,23,42,0.25)]">
                <p className="text-base font-semibold tracking-tight">
                  Modo desarrollo sin registro
                </p>
                <p className="mt-2 max-w-xl text-[15px] leading-7 text-blue-800">
                  Puedes trabajar sin crear cuenta: los borradores se guardan en
                  este navegador y la publicacion usa tus credenciales configuradas.
                </p>
              </div>
            ) : (
              <div className="h-full">
                <Suspense fallback={<PanelFallback />}>
                  <DraftsList
                    onLoadDraft={handleLoadDraft}
                    onPublishDraft={handlePublishDraft}
                    refreshTrigger={refreshTrigger}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </section>

        <div
          id="generar-ficha"
          className={`scroll-mt-6 ${balancedSplitGrid} items-start`}
        >
          <section className="h-full">
            <div className={`${elevatedPanelClass} min-h-[31rem]`}>
              <button
                type="button"
                onClick={() => setIsSingleFormOpen((prev) => !prev)}
                className="flex w-full items-start justify-between gap-4 text-left"
              >
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-slate-950">
                    Subir imagen
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Recorte, autogiro y datos base en un solo paso.
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    isSingleFormOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isSingleFormOpen && (
                <div className="mt-6 flex-1">
                  <Suspense fallback={<PanelFallback />}>
                    <UploadForm
                      onGenerate={handleGenerate}
                      isLoading={isGenerating}
                      detectOrientation={detectImageOrientationWithDesk}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </section>

          <section className="h-full">
            <div className={`${elevatedPanelClass} min-h-[31rem]`}>
              <button
                type="button"
                onClick={() => setIsGeneratedCardOpen((prev) => !prev)}
                className="flex w-full items-start justify-between gap-4 text-left"
              >
                <div>
                  <h2 className="text-base font-semibold tracking-tight text-slate-950">
                    Ficha generada
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Revisa, corrige y publica el resultado.
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    isGeneratedCardOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isGeneratedCardOpen && (
                <div className="mt-6 flex-1">
                  {isGenerating ? (
                    <div className="flex min-h-[24rem] flex-col items-center justify-center gap-3 text-muted-foreground">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      <p className="text-sm">Analizando imagen con IA...</p>
                    </div>
                  ) : productData && imagePreview ? (
                    <Suspense fallback={<PanelFallback />}>
                      <ProductCard
                        data={productData}
                        imagePreview={imagePreview}
                        onSaveDraft={handleSaveDraft}
                        onPublish={handlePublish}
                        isSaving={isSaving}
                        isPublishing={isPublishing}
                        savedMessage={savedMessage}
                        hasCredentials={!!credentials}
                      />
                    </Suspense>
                  ) : (
                    <div className="flex min-h-[24rem] flex-col items-center justify-center gap-2 rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50/70 px-6 text-muted-foreground">
                      <Palette className="h-12 w-12 opacity-20" />
                      <p className="max-w-sm text-center text-sm leading-6">
                        Sube una imagen y completa los datos para generar una ficha
                        automaticamente.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <section id="importacion-por-carpetas" className="scroll-mt-6">
          <Suspense fallback={<PanelFallback />}>
            <FolderImportPanel
              onFolderImport={handleFolderImport}
              isImporting={isFolderImporting}
              progress={folderImportProgress}
              storageMode={isPaused ? "local" : "supabase"}
            />
          </Suspense>
        </section>

        <section id="revision-masiva" className="scroll-mt-6">
          <Suspense fallback={<PanelFallback />}>
            <ReviewQueuePanel
              refreshTrigger={refreshTrigger}
              hasCredentials={!!credentials}
              onPublishDraft={handlePublishDraft}
              storageMode={isPaused ? "local" : "supabase"}
            />
          </Suspense>
        </section>

        {!isPaused && (
          <Suspense fallback={<PanelFallback />}>
            <BusinessHealthPanel refreshTrigger={refreshTrigger} />
          </Suspense>
        )}

        <section id="publicacion-por-lote" className="scroll-mt-6">
          <Suspense fallback={<PanelFallback />}>
            <BatchPublishPanel
              onBatchPublish={handleBatchPublish}
              onRetryFailed={handleRetryFailedBatch}
              isPublishing={isBatchPublishing}
              progressText={batchProgressText}
              results={batchResults}
              remainingFileNames={remainingBatchFileNames}
              hasCredentials={!!credentials}
            />
          </Suspense>
        </section>
      </main>
    </div>
  );
};

export default Index;
