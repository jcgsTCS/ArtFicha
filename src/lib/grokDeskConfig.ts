export const GROK_DESKS_STORAGE_KEY = "artficha_grok_desks";
export const GROK_SELECTED_DESK_SESSION_KEY = "artficha_grok_selected_desk";
const LEGACY_GROK_STORAGE_KEY = "artficha_grok_credentials";

export type GrokApiStatus = "idle" | "valid" | "invalid";

export type GrokApiConfig = {
  id: string;
  apiKey: string;
  status: GrokApiStatus;
  model?: string | null;
  lastValidatedAt?: string | null;
  lastError?: string | null;
};

export type GrokDesk = {
  id: string;
  name: string;
  apis: GrokApiConfig[];
  activeApiId?: string | null;
  usePremiumAnalysis: boolean;
};

export type GrokDeskStore = {
  desks: GrokDesk[];
};

type LegacyGrokCredentials = {
  apiKey?: string;
  usePremiumAnalysis?: boolean;
};

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function canUseStorage() {
  return typeof window !== "undefined";
}

function readStorage(
  area: "localStorage" | "sessionStorage",
  key: string,
): string | null {
  if (!canUseStorage()) return null;

  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(
  area: "localStorage" | "sessionStorage",
  key: string,
  value: string,
) {
  if (!canUseStorage()) return;

  try {
    window[area].setItem(key, value);
  } catch {
    // Ignore storage errors and keep in-memory state working.
  }
}

function removeStorage(area: "localStorage" | "sessionStorage", key: string) {
  if (!canUseStorage()) return;

  try {
    window[area].removeItem(key);
  } catch {
    // Ignore storage errors and keep in-memory state working.
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function createEmptyGrokApiConfig(): GrokApiConfig {
  return {
    id: createId("grok-api"),
    apiKey: "",
    status: "idle",
    model: null,
    lastValidatedAt: null,
    lastError: null,
  };
}

export function createEmptyGrokDesk(index = 1): GrokDesk {
  const firstApi = createEmptyGrokApiConfig();

  return {
    id: createId("grok-desk"),
    name: `Desk ${index}`,
    apis: [firstApi],
    activeApiId: firstApi.id,
    usePremiumAnalysis: true,
  };
}

function sanitizeApiConfig(raw: unknown): GrokApiConfig {
  const api = raw as Partial<GrokApiConfig> | null | undefined;
  const status =
    api?.status === "valid" || api?.status === "invalid" ? api.status : "idle";

  return {
    id:
      typeof api?.id === "string" && api.id.trim()
        ? api.id
        : createId("grok-api"),
    apiKey: typeof api?.apiKey === "string" ? api.apiKey.trim() : "",
    status,
    model: typeof api?.model === "string" ? api.model : null,
    lastValidatedAt:
      typeof api?.lastValidatedAt === "string" ? api.lastValidatedAt : null,
    lastError: typeof api?.lastError === "string" ? api.lastError : null,
  };
}

function sanitizeDesk(raw: unknown, index: number): GrokDesk {
  const desk = raw as Partial<GrokDesk> | null | undefined;
  const apis =
    Array.isArray(desk?.apis) && desk?.apis.length > 0
      ? desk.apis.map(sanitizeApiConfig)
      : [createEmptyGrokApiConfig()];
  const usableApis = getUsableGrokApis({ apis });
  const requestedActiveApiId =
    typeof desk?.activeApiId === "string" ? desk.activeApiId : null;
  const activeApiId = usableApis.some((api) => api.id === requestedActiveApiId)
    ? requestedActiveApiId
    : usableApis[0]?.id ?? apis[0]?.id ?? null;

  return {
    id:
      typeof desk?.id === "string" && desk.id.trim()
        ? desk.id
        : createId("grok-desk"),
    name:
      typeof desk?.name === "string" && desk.name.trim()
        ? desk.name.trim()
        : `Desk ${index + 1}`,
    apis,
    activeApiId,
    usePremiumAnalysis: desk?.usePremiumAnalysis !== false,
  };
}

function migrateLegacyCredentials(
  legacyCredentials: LegacyGrokCredentials | null,
): GrokDeskStore | null {
  if (!legacyCredentials) return null;

  const apiKey =
    typeof legacyCredentials.apiKey === "string"
      ? legacyCredentials.apiKey.trim()
      : "";

  const firstApi = createEmptyGrokApiConfig();
  const migratedApi: GrokApiConfig = {
    ...firstApi,
    apiKey,
    status: apiKey ? "idle" : "idle",
  };

  return {
    desks: [
      {
        id: createId("grok-desk"),
        name: "Desk principal",
        apis: [migratedApi],
        activeApiId: migratedApi.id,
        usePremiumAnalysis: Boolean(legacyCredentials.usePremiumAnalysis),
      },
    ],
  };
}

export function sanitizeGrokDeskStore(raw: unknown): GrokDeskStore {
  const store = raw as Partial<GrokDeskStore> | null | undefined;
  const desks =
    Array.isArray(store?.desks) && store.desks.length > 0
      ? store.desks.map((desk, index) => sanitizeDesk(desk, index))
      : [createEmptyGrokDesk()];

  return { desks };
}

export function loadGrokDeskStore(): GrokDeskStore {
  const stored = parseJson<GrokDeskStore>(
    readStorage("sessionStorage", GROK_DESKS_STORAGE_KEY) ??
      readStorage("localStorage", GROK_DESKS_STORAGE_KEY),
  );

  if (stored) {
    return sanitizeGrokDeskStore(stored);
  }

  const legacy = parseJson<LegacyGrokCredentials>(
    readStorage("sessionStorage", LEGACY_GROK_STORAGE_KEY) ??
      readStorage("localStorage", LEGACY_GROK_STORAGE_KEY),
  );
  const migrated = migrateLegacyCredentials(legacy);

  return migrated ?? sanitizeGrokDeskStore(null);
}

export function saveSelectedDeskId(selectedDeskId: string) {
  if (!selectedDeskId.trim()) return;

  writeStorage("sessionStorage", GROK_SELECTED_DESK_SESSION_KEY, selectedDeskId);
}

export function loadSelectedDeskId(): string | null {
  return readStorage("sessionStorage", GROK_SELECTED_DESK_SESSION_KEY);
}

export function saveGrokDeskStore(
  store: GrokDeskStore,
  selectedDeskId?: string,
): GrokDeskStore {
  const sanitizedStore = sanitizeGrokDeskStore(store);
  const selectedDesk = getSelectedGrokDesk(sanitizedStore, selectedDeskId);

  writeStorage(
    "sessionStorage",
    GROK_DESKS_STORAGE_KEY,
    JSON.stringify(sanitizedStore),
  );

  if (selectedDesk) {
    saveSelectedDeskId(selectedDesk.id);
  }

  removeStorage("sessionStorage", LEGACY_GROK_STORAGE_KEY);
  removeStorage("localStorage", LEGACY_GROK_STORAGE_KEY);
  removeStorage("localStorage", GROK_DESKS_STORAGE_KEY);

  return sanitizedStore;
}

export function getSelectedGrokDesk(
  store: GrokDeskStore,
  requestedDeskId?: string | null,
): GrokDesk | null {
  const sanitizedStore = sanitizeGrokDeskStore(store);
  const requestedId = requestedDeskId ?? loadSelectedDeskId();
  return (
    sanitizedStore.desks.find((desk) => desk.id === requestedId) ??
    sanitizedStore.desks[0] ??
    null
  );
}

export function updateDeskInStore(
  store: GrokDeskStore,
  updatedDesk: GrokDesk,
): GrokDeskStore {
  const sanitizedStore = sanitizeGrokDeskStore(store);
  const deskIndex = sanitizedStore.desks.findIndex(
    (desk) => desk.id === updatedDesk.id,
  );
  const normalizedDesk = sanitizeDesk(
    updatedDesk,
    deskIndex >= 0 ? deskIndex : sanitizedStore.desks.length,
  );

  if (deskIndex === -1) {
    return {
      desks: [...sanitizedStore.desks, normalizedDesk],
    };
  }

  return {
    desks: sanitizedStore.desks.map((desk, index) =>
      index === deskIndex ? normalizedDesk : desk,
    ),
  };
}

export function persistSelectedGrokDesk(updatedDesk: GrokDesk): GrokDesk {
  const currentStore = loadGrokDeskStore();
  const nextStore = updateDeskInStore(currentStore, updatedDesk);

  saveGrokDeskStore(nextStore, updatedDesk.id);

  return getSelectedGrokDesk(nextStore, updatedDesk.id) ?? sanitizeDesk(updatedDesk, 0);
}

export function getUsableGrokApis(
  desk: Pick<GrokDesk, "apis">,
): GrokApiConfig[] {
  const populatedApis = desk.apis.filter((api) => api.apiKey.trim().length > 0);

  if (populatedApis.length === 0) {
    return [];
  }

  const validatedApis = populatedApis.filter((api) => api.status === "valid");

  return validatedApis.length > 0 ? validatedApis : populatedApis;
}

export function getApiRotationOrder(desk: GrokDesk): GrokApiConfig[] {
  const usableApis = getUsableGrokApis(desk);

  if (usableApis.length === 0) {
    return [];
  }

  const activeIndex = usableApis.findIndex((api) => api.id === desk.activeApiId);

  if (activeIndex <= 0) {
    return usableApis;
  }

  return [
    ...usableApis.slice(activeIndex),
    ...usableApis.slice(0, activeIndex),
  ];
}

export function getActiveGrokApi(desk: GrokDesk): GrokApiConfig | null {
  return getApiRotationOrder(desk)[0] ?? null;
}

export function maskGrokApiKey(apiKey: string) {
  if (!apiKey.trim()) return "Sin clave";
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}...${apiKey.slice(-2)}`;

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function isGrokCapacityError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const authPatterns = [
    "invalid api key",
    "api key invalida",
    "unauthorized",
    "authentication",
    "forbidden",
    "permission denied",
    "401",
    "403",
  ];

  if (authPatterns.some((pattern) => message.includes(pattern))) {
    return false;
  }

  const capacityPatterns = [
    "429",
    "rate limit",
    "too many requests",
    "quota",
    "capacity",
    "resource exhausted",
    "requests per minute",
    "tokens per minute",
    "token limit",
    "context length",
    "credit",
    "spend limit",
    "usage limit",
    "budget",
    "agot",
  ];

  return capacityPatterns.some((pattern) => message.includes(pattern));
}
