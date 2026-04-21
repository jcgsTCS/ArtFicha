import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  bulkUpdateLocalDrafts,
  clearLocalDrafts,
  deleteLocalDraft,
  loadLocalDrafts,
  updateLocalDraft,
} from "@/lib/localReviewStore";
import { renderPreparedImage } from "@/lib/artworkImageProcessing";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables, TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";

type Draft = Tables<"art_drafts">;
type DraftUpdate = TablesUpdate<"art_drafts">;

type ReviewQueuePanelProps = {
  refreshTrigger: number;
  hasCredentials: boolean;
  onPublishDraft: (draft: { id: string }) => Promise<void>;
  storageMode?: "local" | "supabase";
};

type EditableField =
  | "artist"
  | "artwork_name"
  | "title"
  | "description"
  | "scene_type"
  | "category"
  | "measures"
  | "price"
  | "observations"
  | "condition"
  | "condition_details"
  | "id_section";

const editableFields: EditableField[] = [
  "artist",
  "artwork_name",
  "title",
  "description",
  "scene_type",
  "category",
  "measures",
  "price",
  "observations",
  "condition",
  "condition_details",
  "id_section",
];

const statusStyles: Record<string, string> = {
  pending_review: "border-amber-200 bg-amber-50 text-amber-800",
  ready_to_publish: "border-emerald-200 bg-emerald-50 text-emerald-700",
  publishing: "border-blue-200 bg-blue-50 text-blue-700",
  published: "border-slate-200 bg-slate-100 text-slate-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  not_published: "border-amber-200 bg-amber-50 text-amber-800",
};

const statusLabels: Record<string, string> = {
  pending_review: "Pendiente de revision",
  ready_to_publish: "Lista para publicar",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Fallida",
  not_published: "Pendiente de revision",
};

const completeReviewChecklist = {
  imageChecked: true,
  titleChecked: true,
  descriptionChecked: true,
  categoryChecked: true,
  priceChecked: true,
} satisfies Record<string, boolean>;

const asString = (value: unknown) => String(value ?? "");

function getEditedFields(value: Json | null | undefined) {
  return Array.isArray(value)
    ? value.filter((field): field is string => typeof field === "string")
    : [];
}

function mergeEditedFields(current: Json | null | undefined, next: string[]) {
  return Array.from(new Set([...getEditedFields(current), ...next]));
}

function buildSuggestedTitle(draft: Partial<Draft>) {
  const artist = asString(draft.artist).trim();
  const name =
    asString(draft.artwork_name).trim() ||
    asString(draft.scene_type).trim() ||
    asString(draft.category).trim() ||
    "Obra";
  const measures = asString(draft.measures).trim();

  return [artist, name, measures].filter(Boolean).join(" - ");
}

function validateDraftForApproval(draft: Partial<Draft>) {
  const missing: string[] = [];

  if (!asString(draft.artist).trim()) missing.push("artista");
  if (!asString(draft.title).trim()) missing.push("titulo");
  const description = asString(draft.description).trim();
  if (!description) missing.push("descripcion");
  if (!asString(draft.price).trim() || Number.isNaN(Number.parseFloat(asString(draft.price)))) {
    missing.push("precio valido");
  }
  if (!asString(draft.category).trim()) missing.push("categoria");
  if (!Number(draft.id_section)) missing.push("seccion Todocoleccion");
  if (!Number(draft.condition)) missing.push("estado");

  return missing;
}

function hasCompleteReviewChecklist(value: Json | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const checklist = value as Record<string, unknown>;
  return Object.keys(completeReviewChecklist).every(
    (key) => checklist[key] === true,
  );
}

function mergeDraft(draft: Draft, edits: Partial<Draft> | undefined): Draft {
  return { ...draft, ...(edits ?? {}) };
}

function removeDraftState<T extends Record<string, unknown>>(
  current: T,
  id: string,
) {
  const next = { ...current };
  delete next[id];
  return next;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Error desconocido";
}

export function ReviewQueuePanel({
  refreshTrigger,
  hasCredentials,
  onPublishDraft,
  storageMode = "supabase",
}: ReviewQueuePanelProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Draft>>>({});
  const [dirtyFields, setDirtyFields] = useState<Record<string, string[]>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [artistFilter, setArtistFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [bulkArtist, setBulkArtist] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [isPublishingSelection, setIsPublishingSelection] = useState(false);
  const [publishQueueStatus, setPublishQueueStatus] = useState<string | null>(
    null,
  );
  const hasLoadedDraftsRef = useRef(false);

  const syncDrafts = useCallback((nextDrafts: Draft[]) => {
    const nextIds = new Set(nextDrafts.map((draft) => draft.id));

    setDrafts(nextDrafts);
    setEdits((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => nextIds.has(id)),
      ),
    );
    setDirtyFields((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => nextIds.has(id)),
      ),
    );
    setSelectedIds((current) => current.filter((id) => nextIds.has(id)));
  }, []);

  const fetchDrafts = useCallback(async () => {
    const shouldShowBlockingLoader = !hasLoadedDraftsRef.current;
    if (shouldShowBlockingLoader) {
      setIsLoading(true);
    }

    try {
      if (storageMode === "local") {
        const localDrafts = await loadLocalDrafts();
        syncDrafts(localDrafts);
        hasLoadedDraftsRef.current = true;
        return;
      }

      const { data, error } = await supabase
        .from("art_drafts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      const rows = (data as Draft[]) || [];
      syncDrafts(rows);
      hasLoadedDraftsRef.current = true;
    } catch (error) {
      toast({
        title: "No se pudo cargar la cola de revision",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      if (shouldShowBlockingLoader) {
        setIsLoading(false);
      }
    }
  }, [storageMode, syncDrafts]);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts, refreshTrigger]);

  const mergedDrafts = useMemo(
    () => drafts.map((draft) => mergeDraft(draft, edits[draft.id])),
    [drafts, edits],
  );

  const artists = useMemo(
    () =>
      Array.from(
        new Set(drafts.map((draft) => draft.artist).filter(Boolean) as string[]),
      ).sort(),
    [drafts],
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          drafts.map((draft) => draft.category).filter(Boolean) as string[],
        ),
      ).sort(),
    [drafts],
  );

  const filteredDrafts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const min = priceMin ? Number.parseFloat(priceMin) : null;
    const max = priceMax ? Number.parseFloat(priceMax) : null;

    return mergedDrafts.filter((draft) => {
      const status = draft.publication_status || "pending_review";
      const text = [
        draft.artist,
        draft.artwork_name,
        draft.title,
        draft.description,
        draft.category,
        draft.scene_type,
        draft.source_path,
      ]
        .join(" ")
        .toLowerCase();
      const price = Number.parseFloat(asString(draft.price));
      const issues = validateDraftForApproval(draft);

      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (artistFilter && draft.artist !== artistFilter) return false;
      if (categoryFilter && draft.category !== categoryFilter) return false;
      if (query && !text.includes(query)) return false;
      if (min != null && (Number.isNaN(price) || price < min)) return false;
      if (max != null && (Number.isNaN(price) || price > max)) return false;
      if (issuesOnly && issues.length === 0) return false;

      return true;
    });
  }, [
    artistFilter,
    categoryFilter,
    issuesOnly,
    mergedDrafts,
    priceMax,
    priceMin,
    search,
    statusFilter,
  ]);

  const selectedDrafts = filteredDrafts.filter((draft) =>
    selectedIds.includes(draft.id),
  );
  const readyDrafts = filteredDrafts.filter(
    (draft) =>
      draft.publication_status === "ready_to_publish" ||
      draft.review_status === "ready_to_publish",
  );
  const validateAndPublishDrafts = (
    selectedDrafts.length > 0 ? selectedDrafts : filteredDrafts
  ).filter((draft) => {
    const status =
      draft.publication_status || draft.review_status || draft.status || "pending_review";

    return !["published", "publishing", "failed"].includes(status);
  });

  const setDraftValue = (
    draft: Draft,
    field: EditableField,
    value: string | number | null,
  ) => {
    setEdits((current) => {
      const base = mergeDraft(draft, current[draft.id]);
      const nextDraft = {
        ...base,
        [field]: value,
      } as Draft;

      if (
        ["artist", "scene_type", "measures"].includes(field) &&
        !dirtyFields[draft.id]?.includes("title")
      ) {
        nextDraft.title = buildSuggestedTitle(nextDraft);
      }

      return {
        ...current,
        [draft.id]: {
          ...(current[draft.id] ?? {}),
          [field]: value,
          ...(nextDraft.title !== base.title ? { title: nextDraft.title } : {}),
        },
      };
    });

    setDirtyFields((current) => ({
      ...current,
      [draft.id]: Array.from(new Set([...(current[draft.id] ?? []), field])),
    }));
  };

  const buildUpdatePayload = (
    original: Draft,
    next: Draft,
    fields: string[],
    approve = false,
  ): DraftUpdate => {
    const now = new Date().toISOString();
    const shouldStayReady =
      approve ||
      (fields.length === 0 &&
        (original.publication_status === "ready_to_publish" ||
          original.review_status === "ready_to_publish"));

    return {
      artist: next.artist,
      artwork_name: next.artwork_name,
      title: next.title,
      final_title: next.title,
      description: next.description,
      final_description: next.description,
      scene_type: next.scene_type,
      category: next.category,
      measures: next.measures,
      price: next.price,
      observations: next.observations,
      condition: Number(next.condition) || 3,
      condition_details: next.condition_details,
      id_section: next.id_section ? Number(next.id_section) : null,
      is_user_edited: fields.length > 0 || next.is_user_edited,
      user_edited_fields: mergeEditedFields(next.user_edited_fields, fields),
      review_checklist: shouldStayReady
        ? (completeReviewChecklist as Json)
        : next.review_checklist,
      review_status: shouldStayReady ? "ready_to_publish" : "pending_review",
      publication_status: shouldStayReady ? "ready_to_publish" : "pending_review",
      status: shouldStayReady ? "ready_to_publish" : "pending_review",
      review_completed_at: shouldStayReady ? now : null,
    };
  };

  const saveDraft = async (
    draft: Draft,
    approve = false,
    options?: { quiet?: boolean },
  ) => {
    const merged = mergeDraft(draft, edits[draft.id]);
    const fields = dirtyFields[draft.id] ?? [];
    const missing = validateDraftForApproval(merged);

    if (approve && missing.length > 0) {
      toast({
        title: "No se puede aprobar todavia",
        description: `Falta revisar: ${missing.join(", ")}`,
        variant: "destructive",
      });
      return false;
    }

    setBusyIds((current) => [...current, draft.id]);
    try {
      if (storageMode === "local") {
        const updated = await updateLocalDraft(draft.id, (current) => ({
          ...current,
          ...buildUpdatePayload(draft, merged, fields, approve),
        }));

        if (!updated) {
          throw new Error("La ficha local ya no existe.");
        }

        setDrafts((current) =>
          current.map((item) => (item.id === draft.id ? updated : item)),
        );
      } else {
      const { data, error } = await supabase
        .from("art_drafts")
        .update(buildUpdatePayload(draft, merged, fields, approve))
        .eq("id", draft.id)
        .select("*")
        .single();

      if (error) throw error;

      setDrafts((current) =>
        current.map((item) => (item.id === draft.id ? (data as Draft) : item)),
      );
      }
      setEdits((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });
      setDirtyFields((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });

      if (!options?.quiet) {
        toast({
          title: approve ? "Ficha aprobada" : "Cambios guardados",
          description: approve
            ? "La ficha ya puede publicarse."
            : "La ficha vuelve a revision hasta aprobarla.",
        });
      }
      return true;
    } catch (error) {
      if (!options?.quiet) {
        toast({
          title: "No se pudo guardar la ficha",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      }
      return false;
    } finally {
      setBusyIds((current) => current.filter((id) => id !== draft.id));
    }
  };

  const approveSelected = async () => {
    for (const draft of selectedDrafts) {
      await saveDraft(draft, true);
    }
  };

  const removeDraft = async (draft: Draft) => {
    const label = draft.title || draft.artwork_name || draft.source_path || "esta ficha";
    const confirmed = window.confirm(
      `Quieres borrar "${label}" de la bandeja de revision? Esta accion no se puede deshacer.`,
    );

    if (!confirmed) return;

    setBusyIds((current) => [...current, draft.id]);

    try {
      if (storageMode === "local") {
        await deleteLocalDraft(draft.id);
      } else {
        const { error } = await supabase
          .from("art_drafts")
          .delete()
          .eq("id", draft.id);

        if (error) throw error;
      }

      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setSelectedIds((current) => current.filter((id) => id !== draft.id));
      setEdits((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });
      setDirtyFields((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });

      toast({
        title: "Ficha borrada",
        description: "Se ha eliminado de la bandeja de revision.",
      });
    } catch (error) {
      toast({
        title: "No se pudo borrar la ficha",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusyIds((current) => current.filter((id) => id !== draft.id));
    }
  };

  const rotateDraftImage = async (draft: Draft, degrees: number) => {
    const imageSource =
      draft.processed_image_url || draft.image_url || draft.original_image_url;

    if (!imageSource) {
      toast({
        title: "No hay imagen para girar",
        variant: "destructive",
      });
      return;
    }

    setBusyIds((current) => [...current, draft.id]);

    try {
      const rotatedImage = await renderPreparedImage(imageSource, degrees, {
        autoCrop: false,
      });
      const updatePayload: DraftUpdate = {
        image_url: rotatedImage,
        processed_image_url: rotatedImage,
        publication_status:
          draft.publication_status === "published"
            ? "pending_review"
            : draft.publication_status,
        status:
          draft.publication_status === "published"
            ? "pending_review"
            : draft.status,
        review_status:
          draft.publication_status === "published"
            ? "pending_review"
            : draft.review_status,
        review_completed_at:
          draft.publication_status === "published"
            ? null
            : draft.review_completed_at,
      };

      if (storageMode === "local") {
        const updated = await updateLocalDraft(draft.id, (current) => ({
          ...current,
          ...updatePayload,
        }));

        if (!updated) throw new Error("No se encontro la ficha local.");

        setDrafts((current) =>
          current.map((item) => (item.id === draft.id ? updated : item)),
        );
      } else {
        const { data, error } = await supabase
          .from("art_drafts")
          .update(updatePayload)
          .eq("id", draft.id)
          .select("*")
          .single();

        if (error) throw error;

        setDrafts((current) =>
          current.map((item) => (item.id === draft.id ? (data as Draft) : item)),
        );
      }

      toast({ title: "Imagen girada y guardada" });
    } catch (error) {
      toast({
        title: "No se pudo girar la imagen",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBusyIds((current) => current.filter((id) => id !== draft.id));
    }
  };

  const prepareDraftForPublishing = async (draft: Draft) => {
    const original = drafts.find((item) => item.id === draft.id) ?? draft;
    const dirty = dirtyFields[draft.id] ?? [];
    const alreadyReady =
      draft.publication_status === "ready_to_publish" ||
      draft.review_status === "ready_to_publish";

    if (
      dirty.length === 0 &&
      alreadyReady &&
      hasCompleteReviewChecklist(draft.review_checklist)
    ) {
      return true;
    }

    return await saveDraft(original, true, { quiet: true });
  };

  const publishSingleDraft = async (draft: Draft) => {
    const prepared = await prepareDraftForPublishing(draft);

    if (!prepared) {
      toast({
        title: "Publicacion bloqueada",
        description: `${draft.title || draft.artwork_name || "Ficha"} necesita revision completa antes de publicarse.`,
        variant: "destructive",
      });
      return false;
    }

    await onPublishDraft({ id: draft.id });

    if (storageMode === "local") {
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setSelectedIds((current) => current.filter((id) => id !== draft.id));
      setEdits((current) => removeDraftState(current, draft.id));
      setDirtyFields((current) => removeDraftState(current, draft.id));
    }

    return true;
  };

  const publishDraftQueue = async (draftsToPublish: Draft[]) => {
    if (!draftsToPublish.length) return;

    let queued = 0;
    let blocked = 0;

    setIsPublishingSelection(true);
    setPublishQueueStatus(null);

    try {
      for (const [index, draft] of draftsToPublish.entries()) {
        const label = draft.title || draft.artwork_name || `Ficha ${index + 1}`;
        setPublishQueueStatus(
          `Publicando ${index + 1} de ${draftsToPublish.length}: ${label}`,
        );

        const published = await publishSingleDraft(draft);
        if (published) {
          queued += 1;
        } else {
          blocked += 1;
        }
      }

      setPublishQueueStatus(
        blocked > 0
          ? `Cola terminada: ${queued} enviadas y ${blocked} bloqueadas por revision o validacion.`
          : `Cola terminada: ${queued} fichas enviadas a Todocoleccion.`,
      );
      toast({
        title: "Publicacion por cola finalizada",
        description:
          blocked > 0
            ? `${queued} fichas enviadas y ${blocked} pendientes de revisar.`
            : `${queued} fichas enviadas directamente a Todocoleccion.`,
      });
    } finally {
      setIsPublishingSelection(false);
    }
  };

  const publishSelected = async () => {
    await publishDraftQueue(selectedDrafts);
  };

  const publishAllReady = async () => {
    await publishDraftQueue(readyDrafts);
  };

  const validateAndPublishAll = async () => {
    const targets = validateAndPublishDrafts;

    if (!targets.length) {
      toast({
        title: "No hay fichas para validar",
        description:
          "Selecciona fichas o deja visibles las pendientes que quieras validar y publicar.",
      });
      return;
    }

    if (!hasCredentials) {
      toast({
        title: "Faltan credenciales",
        description:
          "Configura las credenciales de Todocoleccion antes de publicar.",
        variant: "destructive",
      });
      return;
    }

    const blocked = targets
      .map((draft) => ({
        draft,
        missing: validateDraftForApproval(draft),
      }))
      .filter((item) => item.missing.length > 0);

    if (blocked.length > 0) {
      const examples = blocked
        .slice(0, 3)
        .map(
          ({ draft, missing }) =>
            `${draft.title || draft.artwork_name || draft.source_path || "Ficha"}: ${missing.join(", ")}`,
        )
        .join(" | ");

      toast({
        title: "No se puede validar todo todavia",
        description: examples,
        variant: "destructive",
      });
      return;
    }

    const confirmed = window.confirm(
      `Validar checklist completo y publicar ${targets.length} fichas directamente en Todocoleccion?\n\nTu confirmacion manda aunque la descripcion sea generica.`,
    );

    if (!confirmed) return;

    await publishDraftQueue(targets);
  };

  const applyBulkChanges = async () => {
    const updates: DraftUpdate = {};
    const changed: string[] = [];

    if (bulkArtist.trim()) {
      updates.artist = bulkArtist.trim();
      changed.push("artist");
    }
    if (bulkCategory.trim()) {
      updates.category = bulkCategory.trim();
      updates.scene_type = bulkCategory.trim();
      changed.push("category", "scene_type");
    }
    if (bulkPrice.trim()) {
      updates.price = bulkPrice.trim();
      changed.push("price");
    }

    if (!selectedIds.length || changed.length === 0) return;

    setIsLoading(true);
    try {
      if (storageMode === "local") {
        setDrafts(
          await bulkUpdateLocalDrafts(selectedIds, (draft) => ({
            ...draft,
            ...updates,
            is_user_edited: true,
            user_edited_fields: changed,
            review_status: "pending_review",
            publication_status: "pending_review",
            status: "pending_review",
            review_completed_at: null,
          })),
        );
      } else {
      const { error } = await supabase
        .from("art_drafts")
        .update({
          ...updates,
          is_user_edited: true,
          user_edited_fields: changed,
          review_status: "pending_review",
          publication_status: "pending_review",
          status: "pending_review",
          review_completed_at: null,
        })
        .in("id", selectedIds);

      if (error) throw error;
      }

      setBulkArtist("");
      setBulkCategory("");
      setBulkPrice("");
      await fetchDrafts();
      toast({ title: "Cambios masivos aplicados" });
    } catch (error) {
      toast({
        title: "No se pudieron aplicar los cambios masivos",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelected = (id: string, selected: boolean) => {
    setSelectedIds((current) =>
      selected ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id),
    );
  };

  const allVisibleSelected =
    filteredDrafts.length > 0 &&
    filteredDrafts.every((draft) => selectedIds.includes(draft.id));

  const clearLocalQueue = async () => {
    const confirmed = window.confirm(
      "Vas a borrar todos los borradores locales de este navegador. Esta accion no se puede deshacer. ¿Continuar?",
    );

    if (!confirmed) return;

    setIsLoading(true);
    try {
      await clearLocalDrafts();
      setDrafts([]);
      setEdits({});
      setDirtyFields({});
      setSelectedIds([]);
      setPublishQueueStatus(null);
      toast({ title: "Cola local borrada" });
    } catch (error) {
      toast({
        title: "No se pudo borrar la cola local",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="rounded-[1.35rem] border border-slate-200 bg-white p-5 shadow-[0_24px_80px_-55px_rgba(15,23,42,0.45)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Bandeja de doble verificacion
          </div>
          <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-950">
            Revisa, edita inline, aprueba y publica
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Las fichas generadas entran en `pending_review`. Solo las que
            apruebes pasan a `ready_to_publish` y pueden salir a Todocoleccion.
          </p>
          {storageMode === "local" && (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-blue-700">
              Modo desarrollo activo: la cola se guarda en este navegador y
              puede publicar con tus credenciales configuradas.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void fetchDrafts()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refrescar
        </Button>
        {storageMode === "local" && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void clearLocalQueue()}
            disabled={isLoading || isPublishingSelection || drafts.length === 0}
          >
            Borrar todo local
          </Button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[1.2fr_0.7fr_0.7fr_0.6fr_0.6fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titulo, artista, ruta..."
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">Todos los estados</option>
          <option value="pending_review">Pendientes</option>
          <option value="ready_to_publish">Listas</option>
          <option value="failed">Fallidas</option>
          <option value="published">Publicadas</option>
        </select>
        <select
          value={artistFilter}
          onChange={(event) => setArtistFilter(event.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Todos los artistas</option>
          {artists.map((artist) => (
            <option key={artist} value={artist}>
              {artist}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Todas las tecnicas</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={priceMin}
            onChange={(event) => setPriceMin(event.target.value)}
            placeholder="Min"
          />
          <Input
            value={priceMax}
            onChange={(event) => setPriceMax(event.target.value)}
            placeholder="Max"
          />
        </div>
        <label className="flex items-center gap-2 rounded-md border border-input bg-white px-3 py-2 text-sm">
          <Checkbox
            checked={issuesOnly}
            onCheckedChange={(checked) => setIssuesOnly(checked === true)}
          />
          Con errores
        </label>
      </div>

      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-950 lg:w-52">
            <SlidersHorizontal className="h-4 w-4" />
            Acciones masivas ({selectedIds.length})
          </div>
          <Input
            value={bulkArtist}
            onChange={(event) => setBulkArtist(event.target.value)}
            placeholder="Cambiar artista"
          />
          <Input
            value={bulkCategory}
            onChange={(event) => setBulkCategory(event.target.value)}
            placeholder="Cambiar tecnica/categoria"
          />
          <Input
            value={bulkPrice}
            onChange={(event) => setBulkPrice(event.target.value)}
            placeholder="Cambiar precio"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!selectedIds.length || isLoading || isPublishingSelection}
            onClick={() => void applyBulkChanges()}
          >
            Aplicar
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!selectedIds.length || isLoading || isPublishingSelection}
            onClick={() => void approveSelected()}
          >
            <CheckCircle2 className="h-4 w-4" />
            Aprobar
          </Button>
          <Button
            type="button"
            disabled={
              !selectedIds.length ||
              !hasCredentials ||
              isLoading ||
              isPublishingSelection
            }
            onClick={() => void publishSelected()}
          >
            {isPublishingSelection ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Publicar seleccionadas
          </Button>
          <Button
            type="button"
            disabled={
              validateAndPublishDrafts.length === 0 ||
              !hasCredentials ||
              isLoading ||
              isPublishingSelection
            }
            onClick={() => void validateAndPublishAll()}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isPublishingSelection ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Validar y publicar ({validateAndPublishDrafts.length})
          </Button>
          <Button
            type="button"
            disabled={
              readyDrafts.length === 0 ||
              !hasCredentials ||
              isLoading ||
              isPublishingSelection
            }
            onClick={() => void publishAllReady()}
            className="bg-slate-950 text-white hover:bg-slate-800"
          >
            {isPublishingSelection ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Publicar todo aprobado ({readyDrafts.length})
          </Button>
        </div>
        <p className="mt-3 text-xs text-blue-800">
          Si hay cambios inline sin guardar, ArtFicha los guarda y aprueba
          antes de lanzar la cola. Validar y publicar usa las seleccionadas; si
          no hay seleccion, usa todas las fichas visibles y marca el checklist
          humano completo. La publicacion sale directa a Todocoleccion, y la
          confirmacion del usuario manda aunque la descripcion sea generica. La
          espera solo se aplica a la generacion con IA.
        </p>
        {publishQueueStatus && (
          <p className="mt-2 rounded-lg border border-blue-200 bg-white/80 px-3 py-2 text-xs text-blue-900">
            {publishQueueStatus}
          </p>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between border-b border-slate-200 pb-3 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={(checked) =>
              setSelectedIds(
                checked === true ? filteredDrafts.map((draft) => draft.id) : [],
              )
            }
          />
          Seleccionar visibles
        </label>
        <span>
          {filteredDrafts.length} fichas visibles de {drafts.length}
        </span>
      </div>

      <div className="max-h-[68rem] space-y-4 overflow-y-auto py-4 pr-1">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando cola...
          </div>
        )}

        {!isLoading && filteredDrafts.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            No hay fichas con estos filtros.
          </p>
        )}

        {!isLoading &&
          filteredDrafts.map((draft) => {
            const original = drafts.find((item) => item.id === draft.id) ?? draft;
            const dirty = dirtyFields[draft.id] ?? [];
            const missing = validateDraftForApproval(draft);
            const busy = busyIds.includes(draft.id);
            const isSelected = selectedIds.includes(draft.id);
            const status = draft.publication_status || "pending_review";

            return (
              <article
                key={draft.id}
                className={`rounded-2xl border bg-white p-4 transition-colors ${
                  dirty.length > 0
                    ? "border-amber-300 shadow-[0_20px_70px_-55px_rgba(217,119,6,0.9)]"
                    : "border-slate-200"
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row">
                  <div className="flex gap-3 lg:w-72">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        toggleSelected(draft.id, checked === true)
                      }
                      className="mt-2"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="aspect-[4/3] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        {draft.processed_image_url || draft.image_url ? (
                          <img
                            src={draft.processed_image_url || draft.image_url || ""}
                            alt={draft.title || draft.artwork_name || "Obra"}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-xs text-slate-400">
                            Sin imagen
                          </div>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void rotateDraftImage(original, -90)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Izquierda
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void rotateDraftImage(original, 90)}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          Derecha
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge
                          variant="outline"
                          className={statusStyles[status] || statusStyles.pending_review}
                        >
                          {statusLabels[status] || status}
                        </Badge>
                        {draft.source_type === "folder_import" && (
                          <Badge variant="outline">Carpeta</Badge>
                        )}
                      </div>
                      {draft.source_path && (
                        <p className="mt-2 break-all text-xs text-slate-500">
                          {draft.source_path}
                        </p>
                      )}
                      {missing.length > 0 && (
                        <p className="mt-2 flex items-start gap-1 text-xs text-amber-700">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          Falta: {missing.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <div>
                        <Label className="text-xs">Artista</Label>
                        <Input
                          value={asString(draft.artist)}
                          list="review-artists"
                          onChange={(event) =>
                            setDraftValue(original, "artist", event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Tipo / tecnica</Label>
                        <Input
                          value={asString(draft.scene_type)}
                          list="review-categories"
                          onChange={(event) =>
                            setDraftValue(original, "scene_type", event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Categoria</Label>
                        <Input
                          value={asString(draft.category)}
                          list="review-categories"
                          onChange={(event) =>
                            setDraftValue(original, "category", event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Seccion TC</Label>
                        <Input
                          type="number"
                          value={draft.id_section ?? ""}
                          onChange={(event) =>
                            setDraftValue(
                              original,
                              "id_section",
                              event.target.value
                                ? Number.parseInt(event.target.value, 10)
                                : null,
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <Label className="text-xs">Nombre obra</Label>
                        <Input
                          value={asString(draft.artwork_name)}
                          onChange={(event) =>
                            setDraftValue(
                              original,
                              "artwork_name",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Medidas</Label>
                        <Input
                          value={asString(draft.measures)}
                          onChange={(event) =>
                            setDraftValue(original, "measures", event.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Precio</Label>
                        <Input
                          value={asString(draft.price)}
                          onChange={(event) =>
                            setDraftValue(original, "price", event.target.value)
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs">Titulo</Label>
                      <Input
                        value={asString(draft.title)}
                        onChange={(event) =>
                          setDraftValue(original, "title", event.target.value)
                        }
                      />
                    </div>

                    <div>
                      <Label className="text-xs">Descripcion</Label>
                      <Textarea
                        value={asString(draft.description)}
                        rows={4}
                        onChange={(event) =>
                          setDraftValue(
                            original,
                            "description",
                            event.target.value,
                          )
                        }
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[0.35fr_1fr_1fr]">
                      <div>
                        <Label className="text-xs">Estado</Label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          value={draft.condition ?? 3}
                          onChange={(event) =>
                            setDraftValue(
                              original,
                              "condition",
                              Number.parseInt(event.target.value, 10) || 3,
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Detalle estado</Label>
                        <Input
                          value={asString(draft.condition_details)}
                          onChange={(event) =>
                            setDraftValue(
                              original,
                              "condition_details",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Observaciones</Label>
                        <Input
                          value={asString(draft.observations)}
                          onChange={(event) =>
                            setDraftValue(
                              original,
                              "observations",
                              event.target.value,
                            )
                          }
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {dirty.length > 0 ? (
                          dirty.map((field) => (
                            <span
                              key={field}
                              className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700"
                            >
                              cambiado: {field}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500">
                            Sin cambios pendientes
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy || isPublishingSelection}
                          onClick={() => void removeDraft(original)}
                          className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                        >
                          <Trash2 className="h-4 w-4" />
                          Borrar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy || dirty.length === 0}
                          onClick={() => void saveDraft(original)}
                        >
                          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                          Guardar
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy || missing.length > 0}
                          onClick={() => void saveDraft(original, true)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Aprobar
                        </Button>
                        <Button
                          type="button"
                          disabled={
                            busy ||
                            !hasCredentials ||
                            isPublishingSelection
                          }
                          onClick={() => void publishSingleDraft(draft)}
                        >
                          <Send className="h-4 w-4" />
                          Validar y publicar
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
      </div>

      <datalist id="review-artists">
        {artists.map((artist) => (
          <option key={artist} value={artist} />
        ))}
      </datalist>
      <datalist id="review-categories">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </section>
  );
}
