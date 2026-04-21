import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  FileText,
  Trash2,
  RefreshCw,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Pencil,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

type Draft = Tables<"art_drafts">;

interface DraftsListProps {
  onLoadDraft: (draft: Draft) => void;
  onPublishDraft: (draft: Draft) => void;
  refreshTrigger: number;
}

const statusIcons: Record<string, React.ReactNode> = {
  pending_review: <TriangleAlert className="w-3.5 h-3.5 text-amber-700" />,
  ready_to_publish: <ShieldCheck className="w-3.5 h-3.5 text-success" />,
  not_published: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
  publishing: <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />,
  published: <CheckCircle className="w-3.5 h-3.5 text-success" />,
  failed: <XCircle className="w-3.5 h-3.5 text-destructive" />,
};

const statusLabels: Record<string, string> = {
  pending_review: "Pendiente",
  ready_to_publish: "Lista",
  not_published: "Pendiente",
  publishing: "Publicando...",
  published: "Publicado",
  failed: "Error",
};

export function DraftsList({
  onLoadDraft,
  onPublishDraft,
  refreshTrigger,
}: DraftsListProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const fetchDrafts = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("art_drafts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setDrafts((data as Draft[]) || []);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "No se pudieron cargar";

      toast({
        title: "Error al cargar borradores",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchDrafts();
    }
  }, [isOpen, refreshTrigger]);

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("art_drafts").delete().eq("id", id);
      if (error) throw error;

      setDrafts((prev) => prev.filter((draft) => draft.id !== id));
      toast({ title: "Borrador eliminado" });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "No se pudo eliminar";

      toast({
        title: "Error al eliminar",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            Mis fichas ({drafts.length})
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
          <div className="flex justify-end">
            <Button
              onClick={() => void fetchDrafts()}
              variant="ghost"
              size="sm"
              disabled={isLoading}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          {drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No hay fichas guardadas
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {drafts.map((draft) => {
                const publishReady =
                  draft.review_status === "ready_to_publish" ||
                  draft.publication_status === "ready_to_publish";

                return (
                  <div
                    key={draft.id}
                    className="flex items-center gap-2 p-3 rounded-lg border border-border bg-background hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {draft.artwork_name || draft.title || "Sin titulo"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        <span>{draft.artist}</span>
                        <span>·</span>
                        <span>{draft.price || "-"} EUR</span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          {statusIcons[draft.publication_status] ||
                            statusIcons.not_published}
                          {statusLabels[draft.publication_status] ||
                            "Sin publicar"}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <span className="text-[11px] rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-muted-foreground">
                          Calidad {draft.quality_score ?? 0}/100
                        </span>
                        <span className="text-[11px] rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-muted-foreground">
                          Revision{" "}
                          {publishReady
                            ? "aprobada"
                            : "pendiente"}
                        </span>
                      </div>
                      {!publishReady && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                          <TriangleAlert className="h-3.5 w-3.5" />
                          Requiere revision humana antes de publicar.
                        </p>
                      )}
                      {publishReady && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-success">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Lista para publicar con bajo riesgo operativo.
                        </p>
                      )}
                      {draft.publication_status === "failed" &&
                        draft.tc_last_error && (
                          <p className="text-xs text-destructive mt-1 truncate">
                            {draft.tc_last_error}
                          </p>
                        )}
                      {draft.publication_status === "published" &&
                        draft.tc_external_id && (
                          <p className="text-xs text-success mt-1">
                            ID externo: {draft.tc_external_id}
                          </p>
                        )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        onClick={() => onLoadDraft(draft)}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Cargar borrador"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {(draft.publication_status === "ready_to_publish" ||
                        draft.publication_status === "not_published" ||
                        draft.publication_status === "pending_review" ||
                        draft.publication_status === "failed") &&
                        publishReady && (
                          <Button
                            onClick={() => onPublishDraft(draft)}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Publicar"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      <Button
                        onClick={() => void handleDelete(draft.id)}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
