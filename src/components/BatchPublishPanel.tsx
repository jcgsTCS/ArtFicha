import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  readFileAsDataUrl,
  renderPreparedImage,
} from "@/lib/artworkImageProcessing";
import {
  FolderUp,
  ImageIcon,
  Loader2,
  RotateCcw,
  RotateCw,
  XCircle,
  CheckCircle2,
  FileCheck2,
  ChevronDown,
} from "lucide-react";

export type BatchPublishItem = {
  id: string;
  fileName: string;
  originalImageBase64: string;
  imageBase64: string;
  rotation: number;
};

export type BatchPublishInput = {
  items: BatchPublishItem[];
  artist: string;
  measures: string;
  price: string;
  priceRangeMin: string;
  priceRangeMax: string;
  autoEstimatePrice: boolean;
  observations: string;
  delaySeconds: number;
  autoCrop: boolean;
  autoOrient: boolean;
  publicationMode: "drafts_only" | "auto_publish";
};

export type BatchPublishResult = {
  fileName: string;
  status: "drafted" | "published" | "failed";
  title?: string;
  message?: string;
  file?: File;
};

interface BatchPublishPanelProps {
  onBatchPublish: (input: BatchPublishInput) => Promise<void>;
  onRetryFailed: () => Promise<void>;
  isPublishing: boolean;
  progressText: string | null;
  results: BatchPublishResult[];
  remainingFileNames: string[];
  hasCredentials: boolean;
}

export function BatchPublishPanel({
  onBatchPublish,
  onRetryFailed,
  isPublishing,
  progressText,
  results,
  remainingFileNames,
  hasCredentials,
}: BatchPublishPanelProps) {
  const [items, setItems] = useState<BatchPublishItem[]>([]);
  const [artist, setArtist] = useState("");
  const [measures, setMeasures] = useState("");
  const [price, setPrice] = useState("");
  const [priceRangeMin, setPriceRangeMin] = useState("");
  const [priceRangeMax, setPriceRangeMax] = useState("");
  const [autoEstimatePrice, setAutoEstimatePrice] = useState(true);
  const [observations, setObservations] = useState("");
  const [delaySeconds, setDelaySeconds] = useState("0");
  const [isAutoCropEnabled, setIsAutoCropEnabled] = useState(false);
  const [isAutoOrientEnabled, setIsAutoOrientEnabled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fileSummary = useMemo(() => {
    const activeCount = remainingFileNames.length || items.length;
    if (activeCount === 0) return "No hay imagenes cargadas";
    if (activeCount === 1) {
      return remainingFileNames[0] || items[0]?.fileName || "1 imagen preparada";
    }
    return `${activeCount} imagenes pendientes de procesar`;
  }, [items, remainingFileNames]);

  const handleFiles = async (nextFiles: FileList | null) => {
    if (!nextFiles) return;
    const imageFiles = Array.from(nextFiles).filter((file) =>
      file.type.startsWith("image/"),
    );
    const nextItems = await Promise.all(
      imageFiles.map(async (file) => {
        const originalImageBase64 = await readFileAsDataUrl(file);

        return {
          id: `${file.name}-${file.lastModified}`,
          fileName: file.name,
          originalImageBase64,
          imageBase64: originalImageBase64,
          rotation: 0,
        };
      }),
    );
    setItems(nextItems);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const hasPriceRange = !!priceRangeMin.trim() && !!priceRangeMax.trim();
    if (
      !items.length ||
      !artist.trim() ||
      (!price.trim() && !hasPriceRange) ||
      isPublishing
    ) {
      return;
    }

    await onBatchPublish({
      items,
      artist: artist.trim(),
      measures: measures.trim(),
      price: price.trim(),
      priceRangeMin: priceRangeMin.trim(),
      priceRangeMax: priceRangeMax.trim(),
      autoEstimatePrice,
      observations: observations.trim(),
      delaySeconds: Math.max(0, Number.parseInt(delaySeconds, 10) || 0),
      autoCrop: isAutoCropEnabled,
      autoOrient: isAutoOrientEnabled,
      publicationMode: "drafts_only",
    });
  };

  const handleClear = () => {
    setItems([]);
    setArtist("");
    setMeasures("");
    setPrice("");
    setPriceRangeMin("");
    setPriceRangeMax("");
    setAutoEstimatePrice(true);
    setObservations("");
    setDelaySeconds("0");
    setIsAutoCropEnabled(false);
    setIsAutoOrientEnabled(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleRotateItem = async (itemId: string, delta: number) => {
    if (isPublishing) return;

    const currentItem = items.find((item) => item.id === itemId);
    if (!currentItem) return;

    const nextRotation = currentItem.rotation + delta;
    const rotatedImage = await renderPreparedImage(
      currentItem.originalImageBase64,
      nextRotation,
      { autoCrop: false },
    );

    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              imageBase64: rotatedImage,
              rotation: nextRotation,
            }
          : item,
      ),
    );
  };

  const hasPriceRange = !!priceRangeMin.trim() && !!priceRangeMax.trim();
  const canSubmit =
    items.length > 0 && !!artist.trim() && (!!price.trim() || hasPriceRange);
  const hasFailedItems = results.some((result) => result.status === "failed");
  const filesToDisplay =
    remainingFileNames.length > 0
      ? remainingFileNames
      : items.map((item) => item.fileName);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-primary/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,247,252,0.94))] p-5 shadow-[0_24px_70px_-45px_hsla(234,39%,15%,0.55)]">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-primary/70">
              Publicacion por lote
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sube varias imagenes con datos comunes y publicalas en cadena.
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {isOpen && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <div
            className="cursor-pointer rounded-xl border-2 border-dashed border-border p-6 transition-colors hover:border-accent/50 hover:bg-accent/5"
            onClick={() => fileRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
              <FolderUp className="h-10 w-10" />
              <p className="text-sm font-medium text-foreground">
                Sube varias imagenes con las mismas caracteristicas
              </p>
              <p className="text-xs">{fileSummary}</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleFiles(event.target.files);
              }}
            />
          </div>

          {items.length > 0 && (
            <div className="max-h-[40rem] space-y-4 overflow-y-auto rounded-xl border border-primary/10 bg-white/70 p-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-primary/10 bg-background/80 p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start">
                    <div className="overflow-hidden rounded-xl border border-primary/10 bg-muted/10 p-2">
                      <img
                        src={item.imageBase64}
                        alt={item.fileName}
                        className="mx-auto h-44 w-full max-w-[18rem] rounded object-contain bg-muted/20 md:h-52 md:w-52"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-center gap-2 text-sm text-foreground">
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="break-all font-medium">{item.fileName}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Vista previa ampliada para revisar mejor la orientacion y
                        el encuadre antes de publicar.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRotateItem(item.id, -90)}
                          disabled={isPublishing}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Izquierda
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRotateItem(item.id, 90)}
                          disabled={isPublishing}
                        >
                          <RotateCw className="h-4 w-4" />
                          Derecha
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-primary/10 bg-primary/[0.03] px-3 py-3 space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="batch-auto-crop"
                checked={isAutoCropEnabled}
                onCheckedChange={(checked) => setIsAutoCropEnabled(checked === true)}
                disabled={isPublishing}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="batch-auto-crop" className="cursor-pointer text-sm font-medium">
                  Recorte automatico del lote
                </Label>
                <p className="text-xs text-muted-foreground">
                  Opcional. Mejora encuadre, pero procesa cada imagen y puede
                  ralentizar el lote.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="batch-auto-orient"
                checked={isAutoOrientEnabled}
                onCheckedChange={(checked) => setIsAutoOrientEnabled(checked === true)}
                disabled={isPublishing}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="batch-auto-orient" className="cursor-pointer text-sm font-medium">
                  Autogiro del lote
                </Label>
                <p className="text-xs text-muted-foreground">
                  Opcional. Anade un analisis IA extra por imagen; activalo solo
                  si el lote trae fotos giradas.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3">
              <p className="text-sm font-medium text-emerald-950">
                Publicacion directa desactivada
              </p>
              <p className="mt-1 text-xs text-emerald-800">
                El lote siempre genera borradores en revision. Para publicar,
                aprueba las fichas en la bandeja de doble verificacion.
                {hasCredentials
                  ? " Tus credenciales se usaran solo tras aprobar."
                  : " Configura credenciales antes de publicar aprobadas."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="batch-artist" className="mb-1.5 block text-sm font-medium">
                Artista *
              </Label>
              <Input
                id="batch-artist"
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
                placeholder="Ej: Romero"
              />
            </div>
            <div>
              <Label htmlFor="batch-price" className="mb-1.5 block text-sm font-medium">
                Precio comun opcional
              </Label>
              <Input
                id="batch-price"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="Ej: 90"
              />
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <Label
                    htmlFor="batch-auto-estimate-price"
                    className="cursor-pointer text-sm font-semibold text-blue-950"
                  >
                    Estimar precio por rango en lote
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-blue-800">
                    Si no hay precio comun fijo, ArtFicha calcula cada precio
                    dentro del rango segun la calidad tecnica pictorica de cada
                    ficha.
                  </p>
                </div>
                <Checkbox
                  id="batch-auto-estimate-price"
                  checked={autoEstimatePrice}
                  onCheckedChange={(checked) =>
                    setAutoEstimatePrice(checked === true)
                  }
                  disabled={isPublishing}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label
                    htmlFor="batch-price-range-min"
                    className="mb-1.5 block text-xs font-medium text-blue-950"
                  >
                    Minimo EUR
                  </Label>
                  <Input
                    id="batch-price-range-min"
                    value={priceRangeMin}
                    onChange={(event) => setPriceRangeMin(event.target.value)}
                    placeholder="Ej: 80"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="batch-price-range-max"
                    className="mb-1.5 block text-xs font-medium text-blue-950"
                  >
                    Maximo EUR
                  </Label>
                  <Input
                    id="batch-price-range-max"
                    value={priceRangeMax}
                    onChange={(event) => setPriceRangeMax(event.target.value)}
                    placeholder="Ej: 180"
                  />
                </div>
              </div>
            </div>
            <div>
              <Label htmlFor="batch-measures" className="mb-1.5 block text-sm font-medium">
                Medidas comunes
              </Label>
              <Input
                id="batch-measures"
                value={measures}
                onChange={(event) => setMeasures(event.target.value)}
                placeholder="Ej: 50x70 cm"
              />
            </div>
            <div>
              <Label htmlFor="batch-observations" className="mb-1.5 block text-sm font-medium">
                Observacion comun
              </Label>
              <Input
                id="batch-observations"
                value={observations}
                onChange={(event) => setObservations(event.target.value)}
                placeholder="Ej: Acuarela"
              />
            </div>
            <div>
              <Label htmlFor="batch-delay" className="mb-1.5 block text-sm font-medium">
                Espera extra entre IA (seg)
              </Label>
              <Input
                id="batch-delay"
                type="number"
                min="0"
                step="1"
                value={delaySeconds}
                onChange={(event) => setDelaySeconds(event.target.value)}
                placeholder="Ej: 15"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                ArtFicha ya aplica 10s automaticos para proteger el TPM de Groq.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-primary/10 bg-primary/[0.03] p-3 text-xs text-muted-foreground">
            El lote genera cada ficha con los mismos datos base y separa cada
            analisis para controlar TPM y rate limits. Tras revisar y aprobar,
            podras publicarlas en cadena desde la bandeja de revision.
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={!canSubmit || isPublishing}
              className="flex-1"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando lote...
                </>
              ) : (
                <>
                  <FileCheck2 className="h-4 w-4" />
                  Generar borradores para revisar
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={handleClear} disabled={isPublishing}>
              Limpiar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onRetryFailed()}
              disabled={isPublishing || !hasFailedItems || !hasCredentials}
            >
              Reintentar fallidos
            </Button>
          </div>

          {progressText && (
            <div className="rounded-xl border border-primary/10 bg-white/80 p-3 text-sm text-foreground">
              {progressText}
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2 rounded-xl border border-primary/10 bg-white/80 p-3">
              {results.map((result) => (
                <div
                  key={`${result.fileName}-${result.status}-${result.title ?? ""}`}
                  className="flex items-start gap-2 text-sm"
                >
                  {result.status === "failed" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  ) : result.status === "published" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div>
                    <p className="font-medium text-foreground">{result.fileName}</p>
                    {result.title && (
                      <p className="text-muted-foreground">{result.title}</p>
                    )}
                    {result.message && (
                      <p className={result.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                        {result.message}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </form>
        )}
      </div>
    </section>
  );
}
