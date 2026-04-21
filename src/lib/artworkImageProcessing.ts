export type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StraightenEstimate = {
  angle: number;
  confidence: number;
  sampleCount: number;
};

export type OrientationDetectionResult = {
  rotationDegrees?: number;
  confidence?: number;
  minorCorrectionDegrees?: number;
  reason?: string;
};

export type OrientationVariant = {
  rotationDegrees: number;
  imageBase64: string;
};

export type DetectImageOrientationFn = (payload: {
  imageBase64: string;
  grokApiKey?: string;
  variants?: OrientationVariant[];
}) => Promise<OrientationDetectionResult>;

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo procesar la imagen."));
    img.src = src;
  });
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(new Error(`No se pudo leer la imagen ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, value));
}

export function normalizeQuarterTurn(value: number) {
  if (!Number.isFinite(value)) return 0;

  const rounded = Math.round(value / 90) * 90;
  const normalized = ((rounded % 360) + 360) % 360;

  return normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : 0;
}

function normalizeAxisDeviation(angleDeg: number) {
  let normalized = angleDeg % 180;
  if (normalized < -90) normalized += 180;
  if (normalized >= 90) normalized -= 180;

  const nearestAxis = Math.round(normalized / 90) * 90;
  let deviation = normalized - nearestAxis;

  if (deviation < -45) deviation += 90;
  if (deviation > 45) deviation -= 90;

  return deviation;
}

function sampleBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
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
}

function detectArtworkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const background = sampleBackgroundColor(data, width, height);
  const threshold = 36;
  const minOpaque = 24;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const isForegroundPixel = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    const alpha = data[index + 3];
    if (alpha < minOpaque) return false;

    const dr = data[index] - background.r;
    const dg = data[index + 1] - background.g;
    const db = data[index + 2] - background.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);

    return distance >= threshold;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isForegroundPixel(x, y)) continue;

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

  if (areaRatio > 0.96 || areaRatio < 0.05) {
    return null;
  }

  const minPixelsPerLine = Math.max(6, Math.round(contentWidth * 0.015));
  const minPixelsPerColumn = Math.max(6, Math.round(contentHeight * 0.015));

  const countForegroundInRow = (row: number) => {
    let count = 0;
    for (let x = minX; x <= maxX; x += 1) {
      if (isForegroundPixel(x, row)) count += 1;
    }
    return count;
  };

  const countForegroundInColumn = (column: number) => {
    let count = 0;
    for (let y = minY; y <= maxY; y += 1) {
      if (isForegroundPixel(column, y)) count += 1;
    }
    return count;
  };

  while (minY < maxY && countForegroundInRow(minY) < minPixelsPerLine) {
    minY += 1;
  }
  while (maxY > minY && countForegroundInRow(maxY) < minPixelsPerLine) {
    maxY -= 1;
  }
  while (minX < maxX && countForegroundInColumn(minX) < minPixelsPerColumn) {
    minX += 1;
  }
  while (maxX > minX && countForegroundInColumn(maxX) < minPixelsPerColumn) {
    maxX -= 1;
  }

  const refinedWidth = maxX - minX + 1;
  const refinedHeight = maxY - minY + 1;

  if (refinedWidth < 40 || refinedHeight < 40) {
    return null;
  }

  const paddingX = Math.max(8, Math.round(refinedWidth * 0.025));
  const paddingY = Math.max(8, Math.round(refinedHeight * 0.025));
  const x = Math.max(0, minX - paddingX);
  const y = Math.max(0, minY - paddingY);

  return {
    x,
    y,
    width: Math.min(width - x, refinedWidth + paddingX * 2),
    height: Math.min(height - y, refinedHeight + paddingY * 2),
  };
}

function cropCanvasToArtwork(
  sourceCanvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
) {
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
}

function applyGlobalAdjustments(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const brightness = 0;
  const exposure = 0;
  const contrast = 1.15;
  const saturation = 1.08;
  const shadowLift = 0;
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
}

function sharpenImage(
  source: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const output = new Uint8ClampedArray(source);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const sharpenStrength = 0.2;
  const clarityStrength = 0.15;
  const textureStrength = 0.1;
  const blend = sharpenStrength + clarityStrength + textureStrength;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
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
}

export async function cropImageBySelection(
  src: string,
  selection: CropSelection,
) {
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
}

export async function renderPreparedImage(
  src: string,
  rotationDeg: number,
  options?: {
    autoCrop?: boolean;
  },
) {
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

  canvas.width = Math.max(1, Math.ceil(drawWidth * cos + drawHeight * sin));
  canvas.height = Math.max(1, Math.ceil(drawWidth * sin + drawHeight * cos));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo preparar la imagen.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(rotationRad);
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  const workingCanvas = options?.autoCrop === false
    ? canvas
    : cropCanvasToArtwork(canvas, context);
  const workingContext = workingCanvas.getContext("2d");

  if (!workingContext) {
    throw new Error("No se pudo recortar la imagen.");
  }

  const imageData = workingContext.getImageData(
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
  workingContext.putImageData(finalImageData, 0, 0);

  return workingCanvas.toDataURL("image/jpeg", 0.95);
}

export async function optimizeImageForAiAnalysis(
  src: string,
  options?: {
    maxSide?: number;
    quality?: number;
  },
) {
  const image = await loadImage(src);
  const maxSide = options?.maxSide ?? 1280;
  const quality = options?.quality ?? 0.82;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return src;
  }

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

async function renderOrientationVariant(
  src: string,
  rotationDeg: number,
  maxSide = 960,
) {
  const image = await loadImage(src);
  const normalizedRotation = ((rotationDeg % 360) + 360) % 360;
  const rotationRad = (normalizedRotation * Math.PI) / 180;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const sin = Math.abs(Math.sin(rotationRad));
  const cos = Math.abs(Math.cos(rotationRad));

  canvas.width = Math.max(1, Math.ceil(drawWidth * cos + drawHeight * sin));
  canvas.height = Math.max(1, Math.ceil(drawWidth * sin + drawHeight * cos));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo preparar la variante de orientacion.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(rotationRad);
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  return canvas.toDataURL("image/jpeg", 0.9);
}

export async function buildOrientationVariants(
  src: string,
): Promise<OrientationVariant[]> {
  const rotations = [0, 90, 180, 270] as const;

  return await Promise.all(
    rotations.map(async (rotationDegrees) => ({
      rotationDegrees,
      imageBase64: await renderOrientationVariant(src, rotationDegrees),
    })),
  );
}

export async function estimateStraightenAngle(
  src: string,
): Promise<StraightenEstimate | null> {
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
}

export async function prepareArtworkImage(input: {
  imageBase64: string;
  autoCrop: boolean;
  autoOrient: boolean;
  detectOrientation?: DetectImageOrientationFn;
  useOrientationVariants?: boolean;
}) {
  let coarseRotation = 0;
  let fineRotation = 0;
  let reason = "";
  let confidence = 0;
  let usedAiOrientation = false;

  if (input.autoOrient) {
    if (input.detectOrientation) {
      try {
        const variants = input.useOrientationVariants === false
          ? undefined
          : await buildOrientationVariants(input.imageBase64);
        const orientation = await input.detectOrientation({
          imageBase64: input.imageBase64,
          variants,
        });

        coarseRotation = normalizeQuarterTurn(
          Number(orientation?.rotationDegrees) || 0,
        );
        fineRotation = Math.min(
          Math.max(Number(orientation?.minorCorrectionDegrees) || 0, -8),
          8,
        );
        reason = orientation?.reason || "";
        confidence = Math.min(
          Math.max(Number(orientation?.confidence) || 0, 0),
          1,
        );
        usedAiOrientation = true;

        if (coarseRotation !== 0 && confidence < 0.55) {
          coarseRotation = 0;
        }
      } catch {
        coarseRotation = 0;
        fineRotation = 0;
      }
    }

    if (coarseRotation === 0 && Math.abs(fineRotation) < 0.35) {
      const localEstimate = await estimateStraightenAngle(input.imageBase64);
      if (localEstimate && localEstimate.confidence >= 0.16) {
        fineRotation = Math.abs(localEstimate.angle) >= 0.35
          ? -localEstimate.angle
          : 0;
      }
    }
  }

  if (Math.abs(fineRotation) < 0.35) {
    fineRotation = 0;
  }

  const totalRotation = coarseRotation + fineRotation;
  const shouldRender = input.autoCrop || Math.abs(totalRotation) > 0;

  return {
    imageBase64: shouldRender
      ? await renderPreparedImage(input.imageBase64, totalRotation, {
          autoCrop: input.autoCrop,
        })
      : input.imageBase64,
    coarseRotation,
    fineRotation,
    totalRotation,
    reason,
    confidence,
    usedAiOrientation,
  };
}
