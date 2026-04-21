import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Loader2,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

type DraftRow = Tables<"art_drafts">;

interface BusinessHealthPanelProps {
  refreshTrigger: number;
}

type HealthMetrics = {
  totalDrafts: number;
  publishedCount: number;
  failedCount: number;
  pendingReviewCount: number;
  avgQualityScore: number;
  reviewCoverage: number;
  publishSuccessRate: number;
  estimatedHoursSaved: number;
  avgManualEditCount: number;
  healthScore: number;
};

const EMPTY_METRICS: HealthMetrics = {
  totalDrafts: 0,
  publishedCount: 0,
  failedCount: 0,
  pendingReviewCount: 0,
  avgQualityScore: 0,
  reviewCoverage: 0,
  publishSuccessRate: 0,
  estimatedHoursSaved: 0,
  avgManualEditCount: 0,
  healthScore: 0,
};

function buildMetrics(drafts: DraftRow[]): HealthMetrics {
  if (drafts.length === 0) {
    return EMPTY_METRICS;
  }

  const totalDrafts = drafts.length;
  const publishedCount = drafts.filter(
    (draft) => draft.publication_status === "published",
  ).length;
  const failedCount = drafts.filter(
    (draft) => draft.publication_status === "failed",
  ).length;
  const pendingReviewCount = drafts.filter(
    (draft) => draft.review_status !== "reviewed",
  ).length;
  const totalQuality = drafts.reduce(
    (sum, draft) => sum + (draft.quality_score ?? 0),
    0,
  );
  const totalMinutesSaved = drafts.reduce(
    (sum, draft) => sum + (draft.estimated_minutes_saved ?? 0),
    0,
  );
  const totalManualEdits = drafts.reduce(
    (sum, draft) => sum + (draft.manual_edit_count ?? 0),
    0,
  );
  const publishedOrFailed = publishedCount + failedCount;
  const reviewCoverage = Math.round(
    ((totalDrafts - pendingReviewCount) / totalDrafts) * 100,
  );
  const publishSuccessRate =
    publishedOrFailed > 0
      ? Math.round((publishedCount / publishedOrFailed) * 100)
      : 0;
  const avgQualityScore = Math.round(totalQuality / totalDrafts);
  const avgManualEditCount = Number(
    (totalManualEdits / totalDrafts).toFixed(1),
  );
  const estimatedHoursSaved = Number((totalMinutesSaved / 60).toFixed(1));
  const healthScore = Math.round(
    avgQualityScore * 0.4 +
      publishSuccessRate * 0.35 +
      reviewCoverage * 0.15 +
      Math.max(0, 100 - avgManualEditCount * 12) * 0.1,
  );

  return {
    totalDrafts,
    publishedCount,
    failedCount,
    pendingReviewCount,
    avgQualityScore,
    reviewCoverage,
    publishSuccessRate,
    estimatedHoursSaved,
    avgManualEditCount,
    healthScore,
  };
}

export function BusinessHealthPanel({
  refreshTrigger,
}: BusinessHealthPanelProps) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchDrafts = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("art_drafts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);

        if (error) throw error;
        setDrafts((data as DraftRow[]) || []);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "No se pudo medir la salud";

        toast({
          title: "Error al cargar metricas",
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDrafts();
  }, [refreshTrigger]);

  const metrics = useMemo(() => buildMetrics(drafts), [drafts]);
  const hasData = metrics.totalDrafts > 0;

  const topRisk = !hasData
    ? "Aun no hay suficiente uso registrado para medir el producto."
    : metrics.pendingReviewCount > 0
      ? `Hay ${metrics.pendingReviewCount} fichas pendientes de revision humana.`
      : metrics.failedCount > 0
        ? `Hay ${metrics.failedCount} publicaciones fallidas que siguen drenando confianza.`
        : "No hay un riesgo dominante ahora mismo en el flujo registrado.";

  const topOpportunity = !hasData
    ? "Genera y guarda varias fichas para empezar a ver ROI y fiabilidad real."
    : metrics.avgQualityScore < 80
      ? "La palanca mas clara es subir la calidad media antes de acelerar mas publicaciones."
      : metrics.reviewCoverage < 90
        ? "La mayor mejora pasa por cerrar la revision humana de forma consistente."
        : "El siguiente salto es aumentar volumen sin perder la tasa de acierto.";

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-primary/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,247,252,0.94))] p-5 shadow-[0_24px_70px_-45px_hsla(234,39%,15%,0.55)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-primary/70">
              Salud Operativa
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Si ArtFicha quiere acercarse a un 9/10, tiene que ganar fiabilidad,
              revision y ROI medible.
            </p>
          </div>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Badge variant="outline" className="gap-1">
              <Activity className="h-3.5 w-3.5" />
              Score {metrics.healthScore}/100
            </Badge>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Calidad media
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold text-foreground">
                {metrics.avgQualityScore}/100
              </div>
              <Progress value={metrics.avgQualityScore} className="h-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Exito al publicar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold text-foreground">
                {metrics.publishSuccessRate}%
              </div>
              <p className="text-xs text-muted-foreground">
                {metrics.publishedCount} publicadas, {metrics.failedCount} fallidas
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Cobertura de revision
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold text-foreground">
                {metrics.reviewCoverage}%
              </div>
              <p className="text-xs text-muted-foreground">
                {metrics.pendingReviewCount} fichas siguen pendientes
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                ROI operativo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold text-foreground">
                {metrics.estimatedHoursSaved} h
              </div>
              <p className="text-xs text-muted-foreground">
                Ahorro estimado acumulado en {metrics.totalDrafts} fichas
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Alert variant={hasData && metrics.healthScore >= 80 ? "default" : "destructive"}>
            {hasData && metrics.healthScore >= 80 ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
            <AlertTitle>Riesgo principal</AlertTitle>
            <AlertDescription>{topRisk}</AlertDescription>
          </Alert>

          <Alert>
            <Sparkles className="h-4 w-4" />
            <AlertTitle>Mejor oportunidad inmediata</AlertTitle>
            <AlertDescription>{topOpportunity}</AlertDescription>
          </Alert>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            Borradores: {metrics.totalDrafts}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <TriangleAlert className="h-3.5 w-3.5" />
            Ediciones manuales medias: {metrics.avgManualEditCount}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Publicadas: {metrics.publishedCount}
          </Badge>
        </div>
      </div>
    </section>
  );
}
