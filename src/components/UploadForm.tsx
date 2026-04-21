import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  cropImageBySelection as cropImageBySelectionShared,
  type DetectImageOrientationFn,
  prepareArtworkImage,
  renderPreparedImage,
} from "@/lib/artworkImageProcessing";
import {
  Crop,
  Upload,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  RotateCw,
  Sparkles,
} from "lucide-react";

interface UploadFormProps {
  onGenerate: (data: {
    image_base64: string;
    artist: string;
    artwork_title: string;
    measures: string;
    price: string;
    price_range_min: string;
    price_range_max: string;
    auto_estimate_price: boolean;
    observations: string;
  }) => void;
  isLoading: boolean;
  detectOrientation?: DetectImageOrientationFn;
}

type CropMargins = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropPoint = {
  x: number;
  y: number;
};

type StraightenEstimate = {
  angle: number;
  confidence: number;
  sampleCount: number;
};

const EMPTY_CROP: CropMargins = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};

export function UploadForm({
  onGenerate,
  isLoading,
  detectOrientation,
}: UploadFormProps) {
  const [artist, setArtist] = useState("");
  const [artworkTitle, setArtworkTitle] = useState("");
  const [measures, setMeasures] = useState("");
  const [price, setPrice] = useState("");
  const [priceRangeMin, setPriceRangeMin] = useState("");
  const [priceRangeMax, setPriceRangeMax] = useState("");
  const [autoEstimatePrice, setAutoEstimatePrice] = useState(true);
  const [observations, setObservations] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [isAutoCropEnabled, setIsAutoCropEnabled] = useState(true);
  const [isAutoOrientEnabled, setIsAutoOrientEnabled] = useState(false);
  const [isManualCropOpen, setIsManualCropOpen] = useState(false);
  const [cropMargins, setCropMargins] = useState<CropMargins>(EMPTY_CROP);
  const [manualSelection, setManualSelection] = useState<CropSelection | null>(null);
  const [manualCropFirstCorner, setManualCropFirstCorner] =
    useState<CropPoint | null>(null);
  const [manualCropHoverCorner, setManualCropHoverCorner] =
    useState<CropPoint | null>(null);
  const [isAutoOrienting, setIsAutoOrienting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const manualCropImageRef = useRef<HTMLImageElement>(null);

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo procesar la imagen."));
      img.src = src;
    });

  const clampChannel = (value: number) => Math.max(0, Math.min(255, value));

  const clampPercentage = (value: number) => Math.max(0, Math.min(100, value));

  const normalizeQuarterTurn = (value: number) => {
    if (!Number.isFinite(value)) return 0;

    const rounded = Math.round(value / 90) * 90;
    const normalized = ((rounded % 360) + 360) % 360;

    return normalized === 90 || normalized === 180 || normalized === 270
      ? normalized
      : 0;
  };

  const normalizeAxisDeviation = (angleDeg: number) => {
    let normalized = angleDeg % 180;
    if (normalized < -90) normalized += 180;
    if (normalized >= 90) normalized -= 180;

    const nearestAxis = Math.round(normalized / 90) * 90;
    let deviation = normalized - nearestAxis;

    if (deviation < -45) deviation += 90;
    if (deviation > 45) deviation -= 90;

    return deviation;
  };

  const buildSelectionFromCorners = (
    start: CropPoint,
    end: CropPoint,
  ): CropSelection | null => {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (width < 1 || height < 1) {
      return null;
    }

    return {
      x: left,
      y: top,
      width,
      height,
    };
  };

  const getCropPointFromClientPosition = (
    clientX: number,
    clientY: number,
  ): CropPoint | null => {
    const image = manualCropImageRef.current;
    if (!image) return null;

    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: clampPercentage(((clientX - rect.left) / rect.width) * 100),
      y: clampPercentage(((clientY - rect.top) / rect.height) * 100),
    };
  };

  const sampleBackgroundColor = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ) => {
    const sampleRadius = Math.max(2, Math.round(Math.min(width, height) * 0.05));
    const points = [
      [0, 0],
      [width - sampleRadius, 0],
      [0, height - sampleRadius],
      [width - sampleRadius, height - sampleRadius],
    ];

    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let count = 0;

    for (const [startX, startY] of points) {
      const endX = Math.min(width, startX + sampleRadius);
      const endY = Math.min(height, startY + sampleRadius);

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const index = (y * width + x) * 4;
          totalR += data[index];
          totalG += data[index + 1];
          totalB += data[index + 2];
          count += 1;
        }
      }
    }

    return {
      r: totalR / count,
      g: totalG / count,
      b: totalB / count,
    };
  };

  const detectArtworkBounds = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ) => {
    const background = sampleBackgroundColor(data, width, height);
    const threshold = 36;
    const minOpaque = 24;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        if (alpha < minOpaque) continue;

        const dr = data[index] - background.r;
        const dg = data[index + 1] - background.g;
        const db = data[index + 2] - background.b;
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);

        if (distance < threshold) continue;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX <= minX || maxY <= minY) return null;

    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    const areaRatio = (contentWidth * contentHeight) / (width * height);

    if (areaRatio > 0.96 || areaRatio < 0.08) {
      return null;
    }

    const paddingX = Math.max(12, Math.round(contentWidth * 0.04));
    const paddingY = Math.max(12, Math.round(contentHeight * 0.04));

    return {
      x: Math.max(0, minX - paddingX),
      y: Math.max(0, minY - paddingY),
      width: Math.min(width - Math.max(0, minX - paddingX), contentWidth + paddingX * 2),
      height: Math.min(
        height - Math.max(0, minY - paddingY),
        contentHeight + paddingY * 2,
      ),
    };
  };

  const cropCanvasToArtwork = (
    sourceCanvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
  ) => {
    const { width, height } = sourceCanvas;
    const imageData = context.getImageData(0, 0, width, height);
    const bounds = detectArtworkBounds(imageData.data, width, height);

    if (!bounds) return sourceCanvas;

    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = bounds.width;
    croppedCanvas.height = bounds.height;

    const croppedContext = croppedCanvas.getContext("2d");
    if (!croppedContext) {
      return sourceCanvas;
    }

    croppedContext.imageSmoothingEnabled = true;
    croppedContext.imageSmoothingQuality = "high";
    croppedContext.drawImage(
      sourceCanvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );

    return croppedCanvas;
  };

  const cropCanvasByMargins = (
    sourceCanvas: HTMLCanvasElement,
    margins: CropMargins,
  ) => {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    const left = Math.round((margins.left / 100) * width);
    const top = Math.round((margins.top / 100) * height);
    const right = Math.round((margins.right / 100) * width);
    const bottom = Math.round((margins.bottom / 100) * height);
    const croppedWidth = width - left - right;
    const croppedHeight = height - top - bottom;

    if (croppedWidth < 80 || croppedHeight < 80) {
      return sourceCanvas;
    }

    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = croppedWidth;
    croppedCanvas.height = croppedHeight;

    const croppedContext = croppedCanvas.getContext("2d");
    if (!croppedContext) {
      return sourceCanvas;
    }

    croppedContext.imageSmoothingEnabled = true;
    croppedContext.imageSmoothingQuality = "high";
    croppedContext.drawImage(
      sourceCanvas,
      left,
      top,
      croppedWidth,
      croppedHeight,
      0,
      0,
      croppedWidth,
      croppedHeight,
    );

    return croppedCanvas;
  };

  const cropImageBySelection = async (
    src: string,
    selection: CropSelection,
  ) => {
    const image = await loadImage(src);
    const cropX = Math.round((selection.x / 100) * image.width);
    const cropY = Math.round((selection.y / 100) * image.height);
    const cropWidth = Math.round((selection.width / 100) * image.width);
    const cropHeight = Math.round((selection.height / 100) * image.height);

    if (cropWidth < 40 || cropHeight < 40) {
      return src;
    }

    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("No se pudo aplicar el recorte manual.");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );

    return canvas.toDataURL("image/jpeg", 0.95);
  };

  const applyGlobalAdjustments = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ) => {
    const brightness = 0.07;
    const exposure = 0.1;
    const contrast = 1.15;
    const saturation = 1.08;
    const shadowLift = 0.2;
    const highlightReduction = 0.15;
    const redTemp = 1.01;
    const blueTemp = 0.99;
    const center = 128;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      r = r * (1 + brightness + exposure);
      g = g * (1 + brightness + exposure);
      b = b * (1 + brightness + exposure);

      r = (r - center) * contrast + center;
      g = (g - center) * contrast + center;
      b = (b - center) * contrast + center;

      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const shadowFactor = Math.max(0, (128 - luminance) / 128) * shadowLift;
      const highlightFactor =
        Math.max(0, (luminance - 180) / 75) * highlightReduction;

      r += shadowFactor * 55 - highlightFactor * 45;
      g += shadowFactor * 55 - highlightFactor * 45;
      b += shadowFactor * 55 - highlightFactor * 45;

      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;

      r *= redTemp;
      b *= blueTemp;

      data[i] = clampChannel(r);
      data[i + 1] = clampChannel(g);
      data[i + 2] = clampChannel(b);
    }

    return { data, width, height };
  };

  const sharpenImage = (
    source: Uint8ClampedArray,
    width: number,
    height: number,
  ) => {
    const output = new Uint8ClampedArray(source);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    const sharpenStrength = 0.2;
    const clarityStrength = 0.15;
    const textureStrength = 0.1;
    const blend = sharpenStrength + clarityStrength + textureStrength;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = (y * width + x) * 4;

        for (let channel = 0; channel < 3; channel += 1) {
          let value = 0;
          let kernelIndex = 0;

          for (let ky = -1; ky <= 1; ky += 1) {
            for (let kx = -1; kx <= 1; kx += 1) {
              const sampleIndex = ((y + ky) * width + (x + kx)) * 4 + channel;
              value += source[sampleIndex] * kernel[kernelIndex];
              kernelIndex += 1;
            }
          }

          output[index + channel] = clampChannel(
            source[index + channel] * (1 - blend) + value * blend,
          );
        }
      }
    }

    return output;
  };

  const estimateStraightenAngle = async (
    src: string,
  ): Promise<StraightenEstimate | null> => {
    const image = await loadImage(src);
    const maxSide = 720;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const drawWidth = Math.max(1, Math.round(image.width * scale));
    const drawHeight = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = drawWidth;
    canvas.height = drawHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, drawWidth, drawHeight);

    const workingCanvas = cropCanvasToArtwork(canvas, context);
    const workingContext = workingCanvas.getContext("2d");

    if (!workingContext) {
      return null;
    }

    const { width, height } = workingCanvas;
    if (width < 120 || height < 120) {
      return null;
    }

    const imageData = workingContext.getImageData(0, 0, width, height);
    const grayscale = new Float32Array(width * height);

    for (let i = 0; i < grayscale.length; i += 1) {
      const pixelIndex = i * 4;
      grayscale[i] =
        imageData.data[pixelIndex] * 0.299 +
        imageData.data[pixelIndex + 1] * 0.587 +
        imageData.data[pixelIndex + 2] * 0.114;
    }

    const buildEstimate = (preferOuterBand: boolean): StraightenEstimate | null => {
      const binSize = 0.5;
      const binCount = 181;
      const bins = new Float32Array(binCount);
      const sampleStep = 2;
      const edgeBand = Math.max(20, Math.round(Math.min(width, height) * 0.12));
      let totalWeight = 0;
      let sampleCount = 0;

      for (let y = 1; y < height - 1; y += sampleStep) {
        for (let x = 1; x < width - 1; x += sampleStep) {
          if (
            preferOuterBand &&
            x > edgeBand &&
            x < width - edgeBand &&
            y > edgeBand &&
            y < height - edgeBand
          ) {
            continue;
          }

          const topLeft = grayscale[(y - 1) * width + (x - 1)];
          const top = grayscale[(y - 1) * width + x];
          const topRight = grayscale[(y - 1) * width + (x + 1)];
          const left = grayscale[y * width + (x - 1)];
          const right = grayscale[y * width + (x + 1)];
          const bottomLeft = grayscale[(y + 1) * width + (x - 1)];
          const bottom = grayscale[(y + 1) * width + x];
          const bottomRight = grayscale[(y + 1) * width + (x + 1)];

          const gx =
            -topLeft +
            topRight -
            2 * left +
            2 * right -
            bottomLeft +
            bottomRight;
          const gy =
            topLeft +
            2 * top +
            topRight -
            bottomLeft -
            2 * bottom -
            bottomRight;
          const magnitude = Math.hypot(gx, gy);

          if (magnitude < 28) {
            continue;
          }

          const lineAngle = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
          const deviation = normalizeAxisDeviation(lineAngle);

          if (Math.abs(deviation) > 20) {
            continue;
          }

          const binIndex = Math.max(
            0,
            Math.min(binCount - 1, Math.round((deviation + 45) / binSize)),
          );

          bins[binIndex] += magnitude;
          totalWeight += magnitude;
          sampleCount += 1;
        }
      }

      if (totalWeight <= 0 || sampleCount < 60) {
        return null;
      }

      let peakIndex = 0;
      for (let i = 1; i < bins.length; i += 1) {
        if (bins[i] > bins[peakIndex]) {
          peakIndex = i;
        }
      }

      const radius = 4;
      let localWeight = 0;
      let weightedIndex = 0;

      for (
        let i = Math.max(0, peakIndex - radius);
        i <= Math.min(binCount - 1, peakIndex + radius);
        i += 1
      ) {
        localWeight += bins[i];
        weightedIndex += bins[i] * i;
      }

      if (localWeight <= 0) {
        return null;
      }

      const angle = (weightedIndex / localWeight) * binSize - 45;
      const confidence = localWeight / totalWeight;

      if (!Number.isFinite(angle)) {
        return null;
      }

      return { angle, confidence, sampleCount };
    };

    const outerEstimate = buildEstimate(true);
    const fallbackEstimate = buildEstimate(false);
    const estimate =
      outerEstimate && outerEstimate.confidence >= 0.16
        ? outerEstimate
        : fallbackEstimate;

    if (!estimate) {
      return null;
    }

    if (estimate.confidence < 0.12 || estimate.sampleCount < 80) {
      return null;
    }

    if (Math.abs(estimate.angle) > 12) {
      return null;
    }

    return estimate;
  };

  const renderImage = async (
    src: string,
    rotationDeg: number,
    options?: {
      autoCrop?: boolean;
      margins?: CropMargins;
    },
  ) => {
    const image = await loadImage(src);
    const normalizedRotation = ((rotationDeg % 360) + 360) % 360;
    const rotationRad = (normalizedRotation * Math.PI) / 180;
    const maxSide = 2200;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const drawWidth = Math.max(1, Math.round(image.width * scale));
    const drawHeight = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    const sin = Math.abs(Math.sin(rotationRad));
    const cos = Math.abs(Math.cos(rotationRad));

    canvas.width = Math.max(
      1,
      Math.ceil(drawWidth * cos + drawHeight * sin),
    );
    canvas.height = Math.max(
      1,
      Math.ceil(drawWidth * sin + drawHeight * cos),
    );

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("No se pudo preparar la imagen.");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(rotationRad);
    context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    let workingCanvas = options?.autoCrop === false
      ? canvas
      : cropCanvasToArtwork(canvas, context);

    if (options?.margins) {
      workingCanvas = cropCanvasByMargins(workingCanvas, options.margins);
    }

    const croppedContext = workingCanvas.getContext("2d");

    if (!croppedContext) {
      throw new Error("No se pudo recortar la imagen.");
    }

    const imageData = croppedContext.getImageData(
      0,
      0,
      workingCanvas.width,
      workingCanvas.height,
    );
    const adjusted = applyGlobalAdjustments(
      imageData.data,
      workingCanvas.width,
      workingCanvas.height,
    );
    const sharpened = sharpenImage(
      adjusted.data,
      adjusted.width,
      adjusted.height,
    );
    const finalImageData = new ImageData(
      sharpened,
      adjusted.width,
      adjusted.height,
    );
    croppedContext.putImageData(finalImageData, 0, 0);

    return workingCanvas.toDataURL("image/jpeg", 0.95);
  };

  const applyImageTransform = async (
    src: string,
    rotationDeg: number,
    margins = cropMargins,
    autoCropEnabled = isAutoCropEnabled,
  ) => {
    setIsProcessingImage(true);

    try {
      const transformed = margins && (
        margins.left !== 0 ||
        margins.top !== 0 ||
        margins.right !== 0 ||
        margins.bottom !== 0
      )
        ? await renderImage(src, rotationDeg, {
            autoCrop: autoCropEnabled,
            margins,
          })
        : await renderPreparedImage(src, rotationDeg, {
            autoCrop: autoCropEnabled,
          });
      setImagePreview(transformed);
      setImageBase64(transformed);
      setRotation(rotationDeg);
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();

    reader.onload = async (e) => {
      const result = e.target?.result as string;
      setSourceImage(result);
      setCropMargins(EMPTY_CROP);
      setManualSelection(null);
      setIsProcessingImage(true);

      try {
        const prepared = await prepareArtworkImage({
          imageBase64: result,
          autoCrop: isAutoCropEnabled,
          autoOrient: isAutoOrientEnabled,
          detectOrientation,
        });

        setImagePreview(prepared.imageBase64);
        setImageBase64(prepared.imageBase64);
        setRotation(prepared.totalRotation);
      } finally {
        setIsProcessingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRotate = async (delta: number) => {
    if (!sourceImage || isProcessingImage) return;
    await applyImageTransform(sourceImage, rotation + delta);
  };

  const handleAutoOrient = async () => {
    if (!sourceImage || !imagePreview || isProcessingImage || isAutoOrienting) {
      return;
    }

    setIsAutoOrienting(true);

    try {
      const prepared = await prepareArtworkImage({
        imageBase64: imagePreview,
        autoCrop: false,
        autoOrient: true,
        detectOrientation,
      });

      if (Math.abs(prepared.totalRotation) < 0.35) {
        toast({
          title: "La imagen ya parece bien colocada",
          description:
            prepared.reason ||
            "No se detecto un giro necesario para mejorar la vista.",
        });
        return;
      }

      await applyImageTransform(
        sourceImage,
        rotation + prepared.totalRotation,
        cropMargins,
        isAutoCropEnabled,
      );

      const appliedChanges: string[] = [];
      if (prepared.coarseRotation !== 0) {
        appliedChanges.push(`un giro de ${prepared.coarseRotation} grados`);
      }
      if (Math.abs(prepared.fineRotation) >= 0.35) {
        appliedChanges.push(
          `un ajuste fino de ${Math.abs(prepared.fineRotation).toFixed(1)} grados`,
        );
      }

      toast({
        title:
          prepared.coarseRotation !== 0 ? "Imagen autogirada" : "Imagen ajustada",
        description:
          appliedChanges.length > 0
            ? `Se ha aplicado ${appliedChanges.join(" y ")}.${prepared.reason ? ` ${prepared.reason}` : ""}`
            : prepared.reason || "Se ha ajustado la imagen.",
      });
    } catch (error) {
      toast({
        title: "Error al autogirar",
        description:
          error instanceof Error
            ? error.message
            : "No se pudo analizar la orientacion de la imagen.",
        variant: "destructive",
      });
    } finally {
      setIsAutoOrienting(false);
    }
  };

  const handleAutoCropToggle = async (checked: boolean) => {
    setIsAutoCropEnabled(checked);
    if (!sourceImage || isProcessingImage) return;
    await applyImageTransform(sourceImage, rotation, cropMargins, checked);
  };

  const handleAutoOrientToggle = async (checked: boolean) => {
    setIsAutoOrientEnabled(checked);

    if (!checked || !sourceImage || !imagePreview || isProcessingImage || isAutoOrienting) {
      return;
    }

    await handleAutoOrient();
  };

  const openManualCrop = () => {
    setManualSelection(null);
    setManualCropFirstCorner(null);
    setManualCropHoverCorner(null);
    setIsManualCropOpen(true);
  };

  const handleApplyManualCrop = async () => {
    if (!imagePreview || !manualSelection) {
      setIsManualCropOpen(false);
      return;
    }
    const cropped = await cropImageBySelectionShared(imagePreview, manualSelection);
    setSourceImage(cropped);
    setImagePreview(cropped);
    setImageBase64(cropped);
    setIsManualCropOpen(false);
    setManualSelection(null);
    setManualCropFirstCorner(null);
    setManualCropHoverCorner(null);
    setCropMargins(EMPTY_CROP);
    setRotation(0);
  };

  const handleResetCrop = () => {
    setManualSelection(null);
    setManualCropFirstCorner(null);
    setManualCropHoverCorner(null);
  };

  const handleManualCropMove = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!manualCropFirstCorner) return;

    const hoverPoint = getCropPointFromClientPosition(event.clientX, event.clientY);
    if (!hoverPoint) return;

    setManualCropHoverCorner(hoverPoint);
    setManualSelection(buildSelectionFromCorners(manualCropFirstCorner, hoverPoint));
  };

  const handleManualCropClick = (event: React.MouseEvent<HTMLImageElement>) => {
    const point = getCropPointFromClientPosition(event.clientX, event.clientY);
    if (!point) return;

    if (!manualCropFirstCorner) {
      setManualCropFirstCorner(point);
      setManualCropHoverCorner(point);
      setManualSelection(null);
      return;
    }

    const selection = buildSelectionFromCorners(manualCropFirstCorner, point);

    if (!selection) {
      setManualCropFirstCorner(point);
      setManualCropHoverCorner(point);
      setManualSelection(null);
      return;
    }

    setManualSelection(selection);
    setManualCropFirstCorner(null);
    setManualCropHoverCorner(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hasPriceRange = priceRangeMin.trim() && priceRangeMax.trim();
    if (!imageBase64 || !artist || (!price.trim() && !hasPriceRange)) return;

    onGenerate({
      image_base64: imageBase64,
      artist,
      artwork_title: artworkTitle,
      measures,
      price,
      price_range_min: priceRangeMin,
      price_range_max: priceRangeMax,
      auto_estimate_price: autoEstimatePrice,
      observations,
    });
  };

  const handleClear = () => {
    setArtist("");
    setArtworkTitle("");
    setMeasures("");
    setPrice("");
    setPriceRangeMin("");
    setPriceRangeMax("");
    setAutoEstimatePrice(true);
    setObservations("");
    setImagePreview(null);
    setImageBase64(null);
    setSourceImage(null);
    setRotation(0);
    setCropMargins(EMPTY_CROP);
    setManualSelection(null);
    setManualCropFirstCorner(null);
    setManualCropHoverCorner(null);
    setIsAutoCropEnabled(true);
    setIsAutoOrientEnabled(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const hasPriceRange = !!priceRangeMin.trim() && !!priceRangeMax.trim();
  const isValid =
    !!imageBase64 && !!artist.trim() && (!!price.trim() || hasPriceRange);
  const isBusy = isLoading || isProcessingImage || isAutoOrienting;

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <Label className="mb-3 block text-sm font-semibold text-slate-950">
          Imagen de la obra
        </Label>
        <div
          className={`relative overflow-hidden rounded-[1.35rem] border border-dashed transition-colors cursor-pointer ${
            dragOver
              ? "border-blue-500 bg-blue-50"
              : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/40"
          } ${imagePreview ? "p-3" : "min-h-[21rem] p-10"}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          {imagePreview ? (
            <div className="space-y-3">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-full max-h-[31rem] object-contain rounded-2xl bg-white"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    openManualCrop();
                  }}
                  disabled={isBusy}
                >
                  <Crop className="w-4 h-4" />
                  Recortar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleAutoOrient();
                  }}
                  disabled={isBusy}
                >
                  {isAutoOrienting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Autogirar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRotate(-90);
                  }}
                  disabled={isBusy}
                >
                  <RotateCcw className="w-4 h-4" />
                  Girar izquierda
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRotate(90);
                  }}
                  disabled={isBusy}
                >
                  <RotateCw className="w-4 h-4" />
                  Girar derecha
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 text-slate-500">
              <div className="rounded-full bg-white p-4 shadow-sm">
                <ImageIcon className="h-10 w-10 text-slate-700" />
              </div>
              <span className="text-base font-semibold text-slate-950">
                Subir archivo
              </span>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-500">
                .png .jpg .jpeg .bmp
              </span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      </div>

      {imagePreview && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id="autoCrop"
              checked={isAutoCropEnabled}
              onCheckedChange={(checked) => {
                void handleAutoCropToggle(checked === true);
              }}
              disabled={isBusy}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="autoCrop" className="cursor-pointer text-sm font-medium">
                Recorte automatico
              </Label>
              <p className="text-xs text-muted-foreground">
                Intenta eliminar fondo sobrante al cargar la imagen. Si no acierta,
                puedes usar el recorte manual por dos esquinas o el autogiro con IA.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="autoOrient"
              checked={isAutoOrientEnabled}
              onCheckedChange={(checked) => {
                void handleAutoOrientToggle(checked === true);
              }}
              disabled={isBusy}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="autoOrient" className="cursor-pointer text-sm font-medium">
                Autogiro automatico
              </Label>
              <p className="text-xs text-muted-foreground">
                Opcional. Usa IA y puede tardar; si no ve un giro claro, la deja
                como esta.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleAutoOrient()}
              disabled={isBusy}
            >
              {isAutoOrienting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Autogiro inteligente
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={openManualCrop}
              disabled={isBusy}
            >
              <Crop className="w-4 h-4" />
              Abrir recorte manual
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="artist" className="text-sm font-medium mb-1.5 block">
            Artista *
          </Label>
          <Input
            id="artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Ej: Luis Amer"
            required
          />
        </div>
        <div>
          <Label
            htmlFor="artworkTitle"
            className="text-sm font-medium mb-1.5 block"
          >
            Título de la obra
          </Label>
          <Input
            id="artworkTitle"
            value={artworkTitle}
            onChange={(e) => setArtworkTitle(e.target.value)}
            placeholder="Ej: Bodegón con vaso"
          />
        </div>
        <div>
          <Label
            htmlFor="measures"
            className="text-sm font-medium mb-1.5 block"
          >
            Medidas opcionales
          </Label>
          <Input
            id="measures"
            value={measures}
            onChange={(e) => setMeasures(e.target.value)}
            placeholder="Ej: 60x60 cm"
          />
        </div>
        <div>
          <Label htmlFor="price" className="text-sm font-medium mb-1.5 block">
            Precio final opcional
          </Label>
          <Input
            id="price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Ej: 350.00"
          />
        </div>
        <div className="sm:col-span-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <Label
                htmlFor="auto-estimate-price"
                className="cursor-pointer text-sm font-semibold text-blue-950"
              >
                Rango para estimar precio
              </Label>
              <p className="mt-1 text-xs leading-5 text-blue-800">
                Si no pones precio fijo, ArtFicha elegira un precio dentro del
                rango segun la calidad tecnica pictorica detectada.
              </p>
            </div>
            <Checkbox
              id="auto-estimate-price"
              checked={autoEstimatePrice}
              onCheckedChange={(checked) => setAutoEstimatePrice(checked === true)}
              disabled={isBusy}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="priceRangeMin" className="mb-1.5 block text-xs font-medium text-blue-950">
                Minimo EUR
              </Label>
              <Input
                id="priceRangeMin"
                value={priceRangeMin}
                onChange={(e) => setPriceRangeMin(e.target.value)}
                placeholder="Ej: 80"
              />
            </div>
            <div>
              <Label htmlFor="priceRangeMax" className="mb-1.5 block text-xs font-medium text-blue-950">
                Maximo EUR
              </Label>
              <Input
                id="priceRangeMax"
                value={priceRangeMax}
                onChange={(e) => setPriceRangeMax(e.target.value)}
                placeholder="Ej: 180"
              />
            </div>
          </div>
        </div>
        <div>
          <Label
            htmlFor="observations"
            className="text-sm font-medium mb-1.5 block"
          >
            Observaciones opcionales
          </Label>
          <Input
            id="observations"
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            placeholder="Ej: Óleo sobre lienzo"
          />
        </div>
      </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm font-semibold text-emerald-950">
            Doble revision activada
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            La ficha se generara como borrador pendiente. Primero se revisa y
            aprueba; solo despues se puede publicar en Todocoleccion.
          </p>
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          type="submit"
          disabled={!isValid || isBusy}
          className="flex-1 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
        >
          {isLoading || isProcessingImage || isAutoOrienting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {isLoading
                ? "Generando ficha..."
                : isAutoOrienting
                  ? "Autogirando imagen..."
                  : "Preparando imagen..."}
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Generar ficha
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleClear}
          disabled={isBusy}
        >
          Limpiar
        </Button>
      </div>
      </form>
      <Dialog
        open={isManualCropOpen}
        onOpenChange={(open) => {
          setIsManualCropOpen(open);
          if (!open) {
            handleResetCrop();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Recorte manual</DialogTitle>
            <DialogDescription>
              Haz clic en una esquina y luego en la esquina contraria del area
              que quieres conservar.
            </DialogDescription>
          </DialogHeader>

          {imagePreview && (
            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-muted/20 p-3 select-none">
                <div className="relative mx-auto w-fit">
                  <img
                    ref={manualCropImageRef}
                    src={imagePreview}
                    alt="Vista previa del recorte"
                    className="block max-h-[24rem] max-w-full rounded object-contain cursor-crosshair"
                    onClick={handleManualCropClick}
                    onMouseMove={handleManualCropMove}
                  />
                  {manualCropFirstCorner && (
                    <div
                      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-accent shadow"
                      style={{
                        left: `${manualCropFirstCorner.x}%`,
                        top: `${manualCropFirstCorner.y}%`,
                      }}
                    />
                  )}
                  {manualSelection && (
                    <div
                      className="pointer-events-none absolute border-2 border-accent bg-accent/15"
                      style={{
                        left: `${manualSelection.x}%`,
                        top: `${manualSelection.y}%`,
                        width: `${manualSelection.width}%`,
                        height: `${manualSelection.height}%`,
                      }}
                    />
                  )}
                  {manualCropHoverCorner && manualCropFirstCorner && (
                    <div
                      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-white/90 shadow"
                      style={{
                        left: `${manualCropHoverCorner.x}%`,
                        top: `${manualCropHoverCorner.y}%`,
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {manualCropFirstCorner
                    ? "Ahora marca la esquina contraria para cerrar el recorte."
                    : "Primer clic: primera esquina. Segundo clic: esquina opuesta."}
                </p>
                {manualSelection && (
                  <p className="text-xs text-muted-foreground">
                    Seleccion lista para aplicar.
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleResetCrop}>
              Limpiar seleccion
            </Button>
            <Button type="button" variant="secondary" onClick={() => setIsManualCropOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleApplyManualCrop()} disabled={!manualSelection}>
              Aplicar recorte
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
