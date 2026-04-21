import { z } from "zod";

const nonEmptyText = z.string().trim().min(1);
const base64Image = z
  .string()
  .trim()
  .min(40, "La imagen no parece valida.");

export const tcCredentialsSchema = z.object({
  userId: nonEmptyText,
  apiKey: nonEmptyText,
});

export const generateProductSchema = z.object({
  imageBase64: base64Image,
  artist: z.string().trim().optional().default(""),
  artworkTitle: z.string().trim().optional(),
  measures: z.string().trim().optional().default(""),
  price: z.string().trim().optional().default(""),
  observations: z.string().trim().optional().default(""),
  grokApiKey: z.string().trim().optional(),
  usePremiumAnalysis: z.boolean().optional(),
  sourceType: z
    .enum(["manual", "single_upload", "batch_upload", "folder_import"])
    .optional(),
  sourcePath: z.string().trim().nullable().optional(),
  importBatchId: z.string().uuid().nullable().optional(),
  inheritedArtist: z.string().trim().nullable().optional(),
  inheritedCategory: z.string().trim().nullable().optional(),
  inheritedMeasures: z.string().trim().nullable().optional(),
  inheritedPrice: z.number().positive().nullable().optional(),
  parsingWarnings: z.array(z.string()).optional(),
  imageUrl: z.string().trim().optional(),
});

export const publishProductSchema = z.object({
  credentials: tcCredentialsSchema,
  artwork: z.object({
    id: z.string().trim().optional(),
    artist: z.string().trim().optional(),
    measures: z.string().trim().optional(),
    price: nonEmptyText,
    observations: z.string().trim().optional(),
    imageBase64: z.string().trim().optional(),
    artworkName: z.string().trim().optional(),
    title: nonEmptyText.min(10, "El titulo es demasiado corto."),
    description: nonEmptyText.min(30, "La descripcion es demasiado corta."),
    sceneType: z.string().trim().optional(),
    category: z.string().trim().optional(),
    condition: z.number().int().min(1).max(5),
    conditionDetails: nonEmptyText,
    idSection: z.number().int().positive().optional(),
  }),
});

export const detectOrientationSchema = z.object({
  imageBase64: base64Image,
  grokApiKey: z.string().trim().optional(),
  variants: z
    .array(
      z.object({
        rotationDegrees: z.number().int(),
        imageBase64: base64Image,
      }),
    )
    .optional(),
});

export const validateGrokSchema = z.object({
  apiKey: nonEmptyText,
});

export function formatValidationError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join(" ");
  }

  return error instanceof Error ? error.message : "Datos no validos.";
}
