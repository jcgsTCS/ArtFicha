import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  buildGeneratedSnapshot,
  countManualEdits,
  estimateMinutesSaved,
  evaluateProductReadiness,
  type GeneratedDraftSnapshot,
  type ReviewChecklist,
} from "@/lib/productReadiness";
import type { PriceEstimate } from "@/lib/artPricing";
import {
  Save,
  Send,
  CheckCircle,
  XCircle,
  Loader2,
  RotateCcw,
  Clock,
  ShieldCheck,
  TriangleAlert,
  Sparkles,
} from "lucide-react";

export interface ProductData {
  id?: string;
  artworkName: string;
  scene_type: string;
  title: string;
  description: string;
  condition: number;
  condition_details: string;
  category: string;
  id_section: number | null;
  price: string;
  observations: string;
  publicationStatus?: string;
  tcExternalId?: number | null;
  tcLastError?: string | null;
  tcPublishedAt?: string | null;
  reviewChecklist?: ReviewChecklist | null;
  reviewStatus?: string;
  reviewCompletedAt?: string | null;
  qualityScore?: number;
  estimatedMinutesSaved?: number;
  manualEditCount?: number;
  generatedSnapshot?: GeneratedDraftSnapshot | null;
  generatedAt?: string | null;
  priceEstimate?: PriceEstimate | null;
}

interface ProductCardProps {
  data: ProductData;
  imagePreview: string;
  onSaveDraft: (data: ProductData) => void;
  onPublish: (data: ProductData) => void;
  isSaving: boolean;
  isPublishing: boolean;
  savedMessage: string | null;
  hasCredentials: boolean;
}

const pubStatusConfig: Record<
  string,
  { icon: React.ReactNode; label: string; className: string }
> = {
  pending_review: {
    icon: <TriangleAlert className="w-4 h-4" />,
    label: "Pendiente revision",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  },
  ready_to_publish: {
    icon: <ShieldCheck className="w-4 h-4" />,
    label: "Lista para publicar",
    className: "bg-success/10 text-success border-success/20",
  },
  not_published: {
    icon: <Clock className="w-4 h-4" />,
    label: "Pendiente revision",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  },
  publishing: {
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    label: "Publicando...",
    className: "bg-accent/10 text-accent border-accent/20",
  },
  published: {
    icon: <CheckCircle className="w-4 h-4" />,
    label: "Publicado",
    className: "bg-success/10 text-success border-success/20",
  },
  failed: {
    icon: <XCircle className="w-4 h-4" />,
    label: "Error al publicar",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

const qualityBadgeConfig = {
  excellent: "bg-success/10 text-success border-success/20",
  solid: "bg-accent/10 text-accent border-accent/20",
  review: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  risk: "bg-destructive/10 text-destructive border-destructive/20",
} as const;

export function ProductCard({
  data,
  imagePreview,
  onSaveDraft,
  onPublish,
  isSaving,
  isPublishing,
  savedMessage,
  hasCredentials,
}: ProductCardProps) {
  const [form, setForm] = useState<ProductData>(data);

  useEffect(() => {
    setForm(data);
  }, [data]);

  const readiness = useMemo(
    () =>
      evaluateProductReadiness({
        artworkName: form.artworkName,
        title: form.title,
        description: form.description,
        category: form.category,
        price: form.price,
        observations: form.observations,
        condition: form.condition,
        conditionDetails: form.condition_details,
        sceneType: form.scene_type,
        idSection: form.id_section,
        imagePreview,
        reviewChecklist: form.reviewChecklist,
      }),
    [form, imagePreview],
  );

  const manualEditCount = useMemo(
    () =>
      countManualEdits(
        {
          artworkName: form.artworkName,
          title: form.title,
          description: form.description,
          category: form.category,
          price: form.price,
          observations: form.observations,
          condition: form.condition,
          conditionDetails: form.condition_details,
          sceneType: form.scene_type,
          idSection: form.id_section,
        },
        form.generatedSnapshot,
      ),
    [form],
  );

  const estimatedMinutesSaved = useMemo(
    () =>
      estimateMinutesSaved({
        score: readiness.score,
        manualEditCount,
        publicationStatus: form.publicationStatus,
      }),
    [form.publicationStatus, manualEditCount, readiness.score],
  );

  const update = (field: keyof ProductData, value: string | number | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateChecklist = (field: keyof ReviewChecklist, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      reviewChecklist: {
        ...readiness.checklist,
        [field]: checked,
      },
    }));
  };

  const buildSubmissionForm = (
    reviewStatusOverride?: "pending_review" | "ready_to_publish",
  ): ProductData => {
    const now = new Date().toISOString();
    const generatedSnapshot =
      form.generatedSnapshot ??
      buildGeneratedSnapshot({
        artworkName: data.artworkName,
        title: data.title,
        description: data.description,
        category: data.category,
        price: data.price,
        observations: data.observations,
        condition: data.condition,
        conditionDetails: data.condition_details,
        sceneType: data.scene_type,
        idSection: data.id_section,
      });

    const reviewStatus =
      reviewStatusOverride ??
      (form.reviewStatus === "ready_to_publish" ||
      form.publicationStatus === "ready_to_publish"
        ? "ready_to_publish"
        : "pending_review");
    const publicationStatus =
      reviewStatus === "ready_to_publish"
        ? "ready_to_publish"
        : form.publicationStatus === "published" ||
            form.publicationStatus === "failed"
          ? form.publicationStatus
          : "pending_review";

    return {
      ...form,
      reviewChecklist: readiness.checklist,
      reviewStatus,
      reviewCompletedAt: reviewStatus === "ready_to_publish"
        ? form.reviewCompletedAt || now
        : null,
      publicationStatus,
      qualityScore: readiness.score,
      estimatedMinutesSaved,
      manualEditCount,
      generatedSnapshot,
      generatedAt: form.generatedAt || now,
    };
  };

  const handleSave = () => {
    onSaveDraft(buildSubmissionForm());
  };

  const handleApprove = () => {
    onSaveDraft(buildSubmissionForm("ready_to_publish"));
  };

  const handlePublish = () => {
    onPublish(buildSubmissionForm());
  };

  const pubStatus = form.publicationStatus || "not_published";
  const statusCfg =
    pubStatusConfig[pubStatus] || pubStatusConfig.not_published;
  const canPublish =
    hasCredentials &&
    pubStatus !== "publishing" &&
    readiness.isReadyToPublish &&
    (form.reviewStatus === "ready_to_publish" ||
      form.publicationStatus === "ready_to_publish");
  const isRetry = pubStatus === "failed";

  return (
    <div className="space-y-5">
      <div className="rounded-lg overflow-hidden border border-border bg-card">
        <img
          src={imagePreview}
          alt="Obra"
          className="w-full max-h-[32rem] object-contain bg-muted/30"
          style={{ imageRendering: "auto" }}
        />
      </div>

      <div className="space-y-3 rounded-2xl border border-primary/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,247,252,0.92))] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={qualityBadgeConfig[readiness.status]}>
            Calidad {readiness.score}/100
          </Badge>
          <Badge variant="outline" className={statusCfg.className}>
            <span className="mr-1">{statusCfg.icon}</span>
            {statusCfg.label}
          </Badge>
          <Badge variant="outline">
            Revision {readiness.checklistProgress}%
          </Badge>
          <Badge variant="outline">
            Ahorro estimado {estimatedMinutesSaved} min
          </Badge>
          <Badge variant="outline">
            Ediciones manuales {manualEditCount}
          </Badge>
          {form.priceEstimate && (
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
              Precio IA {form.priceEstimate.recommended} EUR
            </Badge>
          )}
        </div>

        {form.priceEstimate && (
          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>
              Precio recomendado por calidad pictorica:{" "}
              {form.priceEstimate.recommended} EUR
            </AlertTitle>
            <AlertDescription>
              Rango {form.priceEstimate.min}-{form.priceEstimate.max} EUR.
              Calidad tecnica {form.priceEstimate.technicalQualityScore}/100,
              confianza {form.priceEstimate.confidence}%.{" "}
              {form.priceEstimate.reasoning}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">
              Preparacion de publicacion
            </span>
            <span className="text-muted-foreground">{readiness.score}%</span>
          </div>
          <Progress value={readiness.score} className="h-2.5" />
        </div>

        {readiness.blockers.length > 0 && (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Bloqueos antes de publicar</AlertTitle>
            <AlertDescription>
              {readiness.blockers.join(" ")}
            </AlertDescription>
          </Alert>
        )}

        {readiness.cautions.length > 0 && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Revision recomendada</AlertTitle>
            <AlertDescription>
              {readiness.cautions.join(" ")}
            </AlertDescription>
          </Alert>
        )}

        {readiness.strengths.length > 0 && (
          <div className="rounded-xl border border-success/20 bg-success/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <Sparkles className="h-4 w-4" />
              Senales positivas
            </div>
            <p className="mt-1 text-sm text-success/90">
              {readiness.strengths.join(" ")}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/80 p-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={readiness.checklist.imageChecked}
              onCheckedChange={(checked) =>
                updateChecklist("imageChecked", checked === true)
              }
              className="mt-0.5"
            />
            <span>He revisado la imagen, el giro y el recorte.</span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={readiness.checklist.titleChecked}
              onCheckedChange={(checked) =>
                updateChecklist("titleChecked", checked === true)
              }
              className="mt-0.5"
            />
            <span>El titulo ya suena vendible y preciso.</span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={readiness.checklist.descriptionChecked}
              onCheckedChange={(checked) =>
                updateChecklist("descriptionChecked", checked === true)
              }
              className="mt-0.5"
            />
            <span>La descripcion explica la obra sin humo ni errores.</span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={readiness.checklist.categoryChecked}
              onCheckedChange={(checked) =>
                updateChecklist("categoryChecked", checked === true)
              }
              className="mt-0.5"
            />
            <span>Categoria y seccion de Todocoleccion revisadas.</span>
          </label>
          <label className="flex items-start gap-3 text-sm sm:col-span-2">
            <Checkbox
              checked={readiness.checklist.priceChecked}
              onCheckedChange={(checked) =>
                updateChecklist("priceChecked", checked === true)
              }
              className="mt-0.5"
            />
            <span>Precio y estado final validados antes de publicar.</span>
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold text-foreground">
          {form.artworkName || "Sin nombre"}
        </h3>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">
          {form.scene_type || "Sin clasificar"}
        </span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">{form.category}</span>
        <span className="text-xs text-muted-foreground">·</span>
        <span
          className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${statusCfg.className}`}
        >
          {statusCfg.icon}
          {statusCfg.label}
        </span>
      </div>

      {form.tcExternalId && (
        <p className="text-xs text-success">
          ID Todocoleccion: {form.tcExternalId}
        </p>
      )}

      {pubStatus === "failed" && form.tcLastError && (
        <div className="text-xs p-2.5 rounded-lg bg-destructive/5 text-destructive border border-destructive/20">
          {form.tcLastError}
        </div>
      )}

      {form.tcPublishedAt && (
        <p className="text-xs text-muted-foreground">
          Publicado: {new Date(form.tcPublishedAt).toLocaleString("es-ES")}
        </p>
      )}

      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium mb-1.5 block">
            Nombre de obra
          </Label>
          <Input
            value={form.artworkName}
            onChange={(e) => update("artworkName", e.target.value)}
          />
        </div>

        <div>
          <Label className="text-sm font-medium mb-1.5 block">
            Titulo (ficha completa)
          </Label>
          <Input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </div>

        <div>
          <Label className="text-sm font-medium mb-1.5 block">
            Descripcion
          </Label>
          <Textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={5}
            className="resize-y"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium mb-1.5 block">
              Estado (1-5)
            </Label>
            <Input
              type="number"
              min={1}
              max={5}
              value={form.condition}
              onChange={(e) =>
                update("condition", Number.parseInt(e.target.value, 10) || 3)
              }
            />
          </div>
          <div>
            <Label className="text-sm font-medium mb-1.5 block">
              Detalle del estado
            </Label>
            <Input
              value={form.condition_details}
              onChange={(e) => update("condition_details", e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium mb-1.5 block">
              Precio
            </Label>
            <Input
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-sm font-medium mb-1.5 block">
              Categoria
            </Label>
            <Input
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium mb-1.5 block">
            Seccion Todocoleccion
          </Label>
          <Input
            type="number"
            min={1}
            value={form.id_section ?? ""}
            onChange={(e) =>
              update(
                "id_section",
                e.target.value
                  ? Number.parseInt(e.target.value, 10) || null
                  : null,
              )
            }
          />
        </div>

        <div>
          <Label className="text-sm font-medium mb-1.5 block">
            Observaciones
          </Label>
          <Textarea
            value={form.observations}
            onChange={(e) => update("observations", e.target.value)}
            rows={2}
          />
        </div>
      </div>

      {savedMessage && (
        <div className="flex items-center gap-2 text-sm p-3 rounded-lg bg-success/10 text-success border border-success/20">
          <CheckCircle className="w-4 h-4" />
          {savedMessage}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="secondary"
          className="flex-1 min-w-[140px]"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Guardar borrador
        </Button>

        <Button
          onClick={handleApprove}
          disabled={isSaving || !readiness.isReadyToPublish}
          variant="outline"
          className="flex-1 min-w-[140px]"
          title={
            !readiness.isReadyToPublish
              ? "Completa todos los datos y el checklist antes de aprobar"
              : undefined
          }
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          Aprobar revision
        </Button>

        <Button
          onClick={handlePublish}
          disabled={!canPublish || isPublishing}
          className="flex-1 min-w-[140px]"
          title={
            !hasCredentials
              ? "Configura tus credenciales de Todocoleccion primero"
              : !readiness.isReadyToPublish
                ? "Completa la revision y resuelve los bloqueos antes de publicar"
                : undefined
          }
        >
          {isPublishing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isRetry ? (
            <RotateCcw className="w-4 h-4" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {isRetry ? "Reintentar publicacion" : "Publicar en Todocoleccion"}
        </Button>
      </div>

      {!hasCredentials && (
        <p className="text-xs text-muted-foreground text-center">
          Configura tus credenciales de Todocoleccion para poder publicar
        </p>
      )}
    </div>
  );
}
