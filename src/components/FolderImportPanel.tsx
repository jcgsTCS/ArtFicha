import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  buildFolderImportItems,
  DEFAULT_FOLDER_PARSING_RULES,
  type FolderImportParsedItem,
  type FolderParsingRules,
} from "@/lib/folderImportParser";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FolderTree,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

export type FolderImportFailure = {
  fileName: string;
  relativePath: string;
  error: string;
};

export type FolderImportProgress = {
  status: "idle" | "uploaded" | "processing" | "completed" | "completed_with_errors" | "failed";
  total: number;
  processed: number;
  failed: number;
  ready: number;
  currentFile?: string | null;
  failedItems: FolderImportFailure[];
};

export type FolderImportInput = {
  items: FolderImportParsedItem[];
  rules: FolderParsingRules;
  autoCrop: boolean;
  autoOrient: boolean;
  delaySeconds: number;
};

type FolderImportPanelProps = {
  onFolderImport: (input: FolderImportInput) => Promise<void>;
  isImporting: boolean;
  progress: FolderImportProgress;
  storageMode?: "local" | "supabase";
};

const toNumber = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export function FolderImportPanel({
  onFolderImport,
  isImporting,
  progress,
  storageMode = "supabase",
}: FolderImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [artistLevel, setArtistLevel] = useState(
    String(DEFAULT_FOLDER_PARSING_RULES.artistLevel + 1),
  );
  const [categoryLevel, setCategoryLevel] = useState(
    String(DEFAULT_FOLDER_PARSING_RULES.categoryLevel + 1),
  );
  const [measuresPriceLevel, setMeasuresPriceLevel] = useState(
    String(DEFAULT_FOLDER_PARSING_RULES.measuresPriceLevel + 1),
  );
  const [autoCrop, setAutoCrop] = useState(false);
  const [autoOrient, setAutoOrient] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState("0");

  const rules = useMemo<FolderParsingRules>(
    () => ({
      artistLevel: toNumber(artistLevel, 1) - 1,
      categoryLevel: toNumber(categoryLevel, 2) - 1,
      measuresPriceLevel: toNumber(measuresPriceLevel, 3) - 1,
      observationsFromLevelsAfter: Math.max(
        toNumber(measuresPriceLevel, 3),
        3,
      ),
    }),
    [artistLevel, categoryLevel, measuresPriceLevel],
  );

  const items = useMemo(
    () => buildFolderImportItems(files, rules),
    [files, rules],
  );

  const warningCount = items.reduce(
    (total, item) => total + item.warnings.length,
    0,
  );
  const progressValue =
    progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const failedItemMap = useMemo(
    () =>
      new Map(
        progress.failedItems.map((item) => [item.relativePath, item] as const),
      ),
    [progress.failedItems],
  );

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    setFiles(Array.from(fileList));
  };

  const copyFailedItems = async () => {
    if (progress.failedItems.length === 0) return;

    const text = progress.failedItems
      .map(
        (item, index) =>
          `${index + 1}. ${item.fileName}\nRuta: ${item.relativePath}\nMotivo: ${item.error}`,
      )
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Silent fallback: user can still read the list on screen.
    }
  };

  const handleImport = async () => {
    if (!items.length || isImporting) return;
    await onFolderImport({
      items,
      rules,
      autoCrop,
      autoOrient,
      delaySeconds: Math.max(0, Number.parseInt(delaySeconds, 10) || 0),
    });
  };

  return (
    <section className="rounded-[1.35rem] border border-slate-200 bg-white p-5 shadow-[0_24px_80px_-55px_rgba(15,23,42,0.45)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            <FolderTree className="h-3.5 w-3.5" />
            Importacion avanzada por carpetas
          </div>
          <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-950">
            Hereda artista, tecnica, medidas y precio desde la ruta
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Selecciona una carpeta raiz. ArtFicha leera subcarpetas,
            generara borradores en revision y nunca detendra todo el lote por
            una carpeta mal nombrada.
          </p>
          {storageMode === "local" && (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-blue-700">
              Modo desarrollo activo: los borradores importados se guardan en
              este navegador y se pueden revisar sin registro.
            </p>
          )}
        </div>
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isImporting}
          className="rounded-xl bg-blue-600 text-white hover:bg-blue-700"
        >
          <FolderTree className="h-4 w-4" />
          Seleccionar carpeta
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="folder-artist-level" className="text-xs font-semibold text-slate-700">
            Nivel artista
          </Label>
          <Input
            id="folder-artist-level"
            type="number"
            min="1"
            value={artistLevel}
            onChange={(event) => setArtistLevel(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="folder-category-level" className="text-xs font-semibold text-slate-700">
            Nivel tecnica/categoria
          </Label>
          <Input
            id="folder-category-level"
            type="number"
            min="1"
            value={categoryLevel}
            onChange={(event) => setCategoryLevel(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="folder-measures-level" className="text-xs font-semibold text-slate-700">
            Nivel medidas/precio
          </Label>
          <Input
            id="folder-measures-level"
            type="number"
            min="1"
            value={measuresPriceLevel}
            onChange={(event) => setMeasuresPriceLevel(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="folder-delay-seconds" className="text-xs font-semibold text-slate-700">
            Espera extra entre IA (seg)
          </Label>
          <Input
            id="folder-delay-seconds"
            type="number"
            min="0"
            step="1"
            value={delaySeconds}
            onChange={(event) => setDelaySeconds(event.target.value)}
          />
          <p className="mt-1 text-[11px] leading-4 text-slate-500">
            ArtFicha ya aplica 10s automaticos para proteger el TPM de Groq.
          </p>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <Checkbox
            checked={autoCrop}
            onCheckedChange={(checked) => setAutoCrop(checked === true)}
            disabled={isImporting}
            className="mt-0.5"
          />
          <span>
            Autocorte opcional. Activarlo procesa la imagen y puede tardar mas.
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <Checkbox
            checked={autoOrient}
            onCheckedChange={(checked) => setAutoOrient(checked === true)}
            disabled={isImporting}
            className="mt-0.5"
          />
          <span>
            Autogiro IA opcional. Activarlo anade un analisis extra por imagen.
          </span>
        </label>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Imagenes</p>
          <p className="text-xl font-bold text-slate-950">{items.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Warnings</p>
          <p className="text-xl font-bold text-amber-700">{warningCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Procesadas</p>
          <p className="text-xl font-bold text-slate-950">{progress.processed}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Fallidas</p>
          <p className="text-xl font-bold text-red-600">{progress.failed}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Para revisar</p>
          <p className="text-xl font-bold text-blue-700">{progress.ready}</p>
        </div>
      </div>

      {isImporting && (
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-center justify-between gap-3 text-sm text-blue-950">
            <span className="font-semibold">
              Procesando carpeta: {progress.currentFile || "preparando..."}
            </span>
            <span>{progressValue}%</span>
          </div>
          <Progress value={progressValue} className="mt-3 h-2.5" />
        </div>
      )}

      {progress.failedItems.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-red-200 bg-red-50/70">
          <div className="flex flex-col gap-3 border-b border-red-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-red-950">
                Fallidas en esta importacion ({progress.failedItems.length})
              </p>
              <p className="mt-1 text-xs text-red-800">
                Aqui tienes la ruta exacta y el motivo para no duplicar piezas
                al reintentar.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void copyFailedItems()}
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar lista
            </Button>
          </div>
          <div className="max-h-[18rem] overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              {progress.failedItems.map((item) => (
                <article
                  key={item.relativePath}
                  className="rounded-xl border border-red-200 bg-white px-4 py-3"
                >
                  <div className="flex items-start gap-2">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">
                        {item.fileName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {item.relativePath}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-red-800">
                        {item.error}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-950">
              Vista previa de herencia
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFiles([...files])}
              disabled={isImporting}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reanalizar
            </Button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {items.slice(0, 120).map((item) => (
              <div
                key={item.id}
                className={`grid grid-cols-1 gap-3 border-b px-4 py-3 text-sm last:border-b-0 lg:grid-cols-[1.4fr_0.7fr_0.8fr_0.6fr_0.6fr_1fr] ${
                  failedItemMap.has(item.relativePath)
                    ? "border-red-100 bg-red-50/60"
                    : "border-slate-100"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {item.fileName}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {item.relativePath}
                  </p>
                </div>
                <span>{item.metadata.artist || "No detectado"}</span>
                <span>{item.metadata.category || "No detectada"}</span>
                <span>{item.metadata.measures || "-"}</span>
                <span>{item.metadata.price || "-"}</span>
                <div className="space-y-1">
                  {failedItemMap.has(item.relativePath) ? (
                    <div className="space-y-1">
                      <p className="flex items-start gap-1 text-xs font-semibold text-red-700">
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Fallida
                      </p>
                      <p className="text-xs leading-5 text-red-800">
                        {failedItemMap.get(item.relativePath)?.error}
                      </p>
                    </div>
                  ) : item.warnings.length === 0 ? (
                    <p className="flex items-center gap-1 text-xs text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      OK
                    </p>
                  ) : (
                    item.warnings.slice(0, 2).map((warning) => (
                      <p
                        key={warning}
                        className="flex items-start gap-1 text-xs text-amber-700"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {warning}
                      </p>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          La importacion crea borradores en `pending_review`; publicar queda
          bloqueado hasta aprobarlos manualmente. La descripcion premium es
          obligatoria: si Groq no la devuelve, esa imagen queda como fallida para
          reintentar y no se crea una ficha base.
        </p>
        <Button
          type="button"
          onClick={() => void handleImport()}
          disabled={!items.length || isImporting}
          className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
        >
          {isImporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FolderTree className="h-4 w-4" />
          )}
          Generar borradores para revisar
        </Button>
      </div>
    </section>
  );
}
