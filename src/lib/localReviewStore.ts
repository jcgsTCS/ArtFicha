import type { Tables } from "@/integrations/supabase/types";

type Draft = Tables<"art_drafts">;

const LOCAL_DRAFTS_KEY = "artficha-local-review-drafts-v1";
const DB_NAME = "artficha-local-review-db";
const DB_VERSION = 1;
const DRAFTS_STORE = "drafts";

function canUseLocalStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function canUseIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function sortDrafts(drafts: Draft[]) {
  return [...drafts].sort(
    (left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("No se pudo acceder a IndexedDB."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("No se pudo guardar en IndexedDB."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Guardado local cancelado."));
  });
}

async function openLocalDb() {
  if (!canUseIndexedDb()) {
    throw new Error("IndexedDB no esta disponible en este navegador.");
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;

    if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
      const store = db.createObjectStore(DRAFTS_STORE, { keyPath: "id" });
      store.createIndex("updated_at", "updated_at");
      store.createIndex("publication_status", "publication_status");
    }
  };

  return await requestToPromise(request);
}

async function getAllDraftsFromIndexedDb() {
  const db = await openLocalDb();

  try {
    const transaction = db.transaction(DRAFTS_STORE, "readonly");
    const store = transaction.objectStore(DRAFTS_STORE);
    const drafts = await requestToPromise<Draft[]>(store.getAll());
    await transactionDone(transaction);
    return sortDrafts(drafts);
  } finally {
    db.close();
  }
}

async function saveDraftsToIndexedDb(drafts: Draft[]) {
  const db = await openLocalDb();

  try {
    const transaction = db.transaction(DRAFTS_STORE, "readwrite");
    const store = transaction.objectStore(DRAFTS_STORE);
    store.clear();

    for (const draft of drafts) {
      store.put(draft);
    }

    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

function loadLegacyLocalStorageDrafts() {
  if (!canUseLocalStorage()) return [];

  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFTS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Draft[];
    return Array.isArray(parsed) ? sortDrafts(parsed) : [];
  } catch {
    return [];
  }
}

function removeLegacyLocalStorageDrafts() {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.removeItem(LOCAL_DRAFTS_KEY);
  } catch {
    // Ignore cleanup failures.
  }
}

function stripHeavyImageFields(draft: Draft): Draft {
  return {
    ...draft,
    image_url: null,
    original_image_url: null,
    processed_image_url: null,
    published_image_url: null,
  };
}

function saveLightweightFallback(drafts: Draft[]) {
  if (!canUseLocalStorage()) return;

  const lightweightDrafts = drafts.map(stripHeavyImageFields);
  window.localStorage.setItem(
    LOCAL_DRAFTS_KEY,
    JSON.stringify(sortDrafts(lightweightDrafts)),
  );
}

async function migrateLegacyStorageIfNeeded(currentDrafts: Draft[]) {
  if (currentDrafts.length > 0) return currentDrafts;

  const legacyDrafts = loadLegacyLocalStorageDrafts();
  if (legacyDrafts.length === 0) return currentDrafts;

  await saveDraftsToIndexedDb(legacyDrafts);
  removeLegacyLocalStorageDrafts();

  return legacyDrafts;
}

export async function loadLocalDrafts(): Promise<Draft[]> {
  try {
    const drafts = await getAllDraftsFromIndexedDb();
    return await migrateLegacyStorageIfNeeded(drafts);
  } catch {
    return loadLegacyLocalStorageDrafts();
  }
}

export async function saveLocalDrafts(drafts: Draft[]) {
  try {
    await saveDraftsToIndexedDb(sortDrafts(drafts));
    removeLegacyLocalStorageDrafts();
  } catch {
    saveLightweightFallback(drafts);
  }
}

export async function upsertLocalDraft(draft: Draft) {
  const nextDraft = {
    ...draft,
    updated_at: new Date().toISOString(),
  };

  try {
    const db = await openLocalDb();

    try {
      const transaction = db.transaction(DRAFTS_STORE, "readwrite");
      transaction.objectStore(DRAFTS_STORE).put(nextDraft);
      await transactionDone(transaction);
      removeLegacyLocalStorageDrafts();
    } finally {
      db.close();
    }
  } catch {
    const drafts = await loadLocalDrafts();
    const index = drafts.findIndex((item) => item.id === draft.id);

    if (index >= 0) {
      drafts.splice(index, 1, stripHeavyImageFields(nextDraft));
    } else {
      drafts.unshift(stripHeavyImageFields(nextDraft));
    }

    saveLightweightFallback(drafts);
  }

  return nextDraft;
}

export async function updateLocalDraft(
  id: string,
  updater: (draft: Draft) => Draft,
): Promise<Draft | null> {
  const drafts = await loadLocalDrafts();
  const index = drafts.findIndex((item) => item.id === id);

  if (index < 0) return null;

  const nextDraft = {
    ...updater(drafts[index]),
    updated_at: new Date().toISOString(),
  };

  drafts.splice(index, 1, nextDraft);
  await saveLocalDrafts(drafts);

  return nextDraft;
}

export async function bulkUpdateLocalDrafts(
  ids: string[],
  updater: (draft: Draft) => Draft,
) {
  const drafts = await loadLocalDrafts();
  const idSet = new Set(ids);
  const nextDrafts = drafts.map((draft) =>
    idSet.has(draft.id)
      ? {
          ...updater(draft),
          updated_at: new Date().toISOString(),
        }
      : draft,
  );

  await saveLocalDrafts(nextDrafts);
  return sortDrafts(nextDrafts);
}

export async function deleteLocalDraft(id: string) {
  const drafts = (await loadLocalDrafts()).filter((draft) => draft.id !== id);
  await saveLocalDrafts(drafts);
}

export async function clearLocalDrafts() {
  try {
    const db = await openLocalDb();

    try {
      const transaction = db.transaction(DRAFTS_STORE, "readwrite");
      transaction.objectStore(DRAFTS_STORE).clear();
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  } catch {
    // If IndexedDB is unavailable, still clear the legacy fallback.
  }

  removeLegacyLocalStorageDrafts();
}
