import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { validateGrok, validateTodocoleccion } from "@/lib/todocoleccionApi";
import {
  createEmptyGrokApiConfig,
  createEmptyGrokDesk,
  GROK_DESKS_STORAGE_KEY,
  getActiveGrokApi,
  getSelectedGrokDesk,
  getUsableGrokApis,
  loadGrokDeskStore,
  loadSelectedDeskId,
  maskGrokApiKey,
  sanitizeGrokDeskStore,
  saveGrokDeskStore,
  saveSelectedDeskId,
  updateDeskInStore,
  type GrokDesk,
  type GrokDeskStore,
} from "@/lib/grokDeskConfig";
import {
  CheckCircle,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

const TC_STORAGE_KEY = "artficha_tc_credentials";

export interface TcCredentials {
  userId: string;
  apiKey: string;
}

interface SettingsPanelProps {
  onCredentialsChange: (credentials: TcCredentials | null) => void;
  onGrokCredentialsChange: (credentials: GrokDesk | null) => void;
}

export function SettingsPanel({
  onCredentialsChange,
  onGrokCredentialsChange,
}: SettingsPanelProps) {
  const [userId, setUserId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<
    "idle" | "valid" | "invalid"
  >("idle");

  const [grokStore, setGrokStore] = useState<GrokDeskStore>({
    desks: [createEmptyGrokDesk()],
  });
  const [selectedGrokDeskId, setSelectedGrokDeskId] = useState("");
  const [showGrokKeys, setShowGrokKeys] = useState<Record<string, boolean>>({});
  const [validatingGrokApiIds, setValidatingGrokApiIds] = useState<
    Record<string, boolean>
  >({});

  const [isOpen, setIsOpen] = useState(false);

  const selectedGrokDesk = useMemo(
    () => getSelectedGrokDesk(grokStore, selectedGrokDeskId),
    [grokStore, selectedGrokDeskId],
  );
  const activeGrokApi = selectedGrokDesk
    ? getActiveGrokApi(selectedGrokDesk)
    : null;
  const usableGrokApis = selectedGrokDesk
    ? getUsableGrokApis(selectedGrokDesk)
    : [];

  const applyGrokState = useCallback(
    (
      nextStore: GrokDeskStore,
      requestedDeskId?: string | null,
      options?: { persist?: boolean },
    ) => {
      const sanitizedStore = sanitizeGrokDeskStore(nextStore);
      const effectiveSelectedDesk =
        getSelectedGrokDesk(sanitizedStore, requestedDeskId) ??
        sanitizedStore.desks[0] ??
        null;

      setGrokStore(sanitizedStore);

      if (!effectiveSelectedDesk) {
        setSelectedGrokDeskId("");
        onGrokCredentialsChange(null);
        return;
      }

      setSelectedGrokDeskId(effectiveSelectedDesk.id);
      saveSelectedDeskId(effectiveSelectedDesk.id);

      if (options?.persist) {
        saveGrokDeskStore(sanitizedStore, effectiveSelectedDesk.id);
      }

      onGrokCredentialsChange(effectiveSelectedDesk);
    },
    [onGrokCredentialsChange],
  );

  useEffect(() => {
    const saved =
      sessionStorage.getItem(TC_STORAGE_KEY) ||
      localStorage.getItem(TC_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as TcCredentials;
        setUserId(parsed.userId);
        setApiKey(parsed.apiKey);
        onCredentialsChange(parsed);
      } catch {
        sessionStorage.removeItem(TC_STORAGE_KEY);
        localStorage.removeItem(TC_STORAGE_KEY);
      }
    }

    const nextGrokStore = loadGrokDeskStore();
    const nextSelectedDesk =
      getSelectedGrokDesk(nextGrokStore, loadSelectedDeskId()) ??
      nextGrokStore.desks[0] ??
      null;

    if (nextSelectedDesk) {
      applyGrokState(nextGrokStore, nextSelectedDesk.id, { persist: true });
    }
  }, [applyGrokState, onCredentialsChange]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== GROK_DESKS_STORAGE_KEY) {
        return;
      }

      const refreshedStore = loadGrokDeskStore();
      const currentDeskId = loadSelectedDeskId() ?? selectedGrokDeskId;
      const refreshedDesk =
        getSelectedGrokDesk(refreshedStore, currentDeskId) ??
        refreshedStore.desks[0] ??
        null;

      if (refreshedDesk) {
        applyGrokState(refreshedStore, refreshedDesk.id);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [applyGrokState, selectedGrokDeskId]);

  const handleSaveTc = () => {
    if (!userId.trim() || !apiKey.trim()) {
      toast({
        title: "Credenciales incompletas",
        variant: "destructive",
      });
      return;
    }

    const creds: TcCredentials = {
      userId: userId.trim(),
      apiKey: apiKey.trim(),
    };

    sessionStorage.setItem(TC_STORAGE_KEY, JSON.stringify(creds));
    localStorage.removeItem(TC_STORAGE_KEY);
    onCredentialsChange(creds);
    toast({ title: "Credenciales de Todocoleccion guardadas" });
  };

  const handleClearTc = () => {
    sessionStorage.removeItem(TC_STORAGE_KEY);
    localStorage.removeItem(TC_STORAGE_KEY);
    setUserId("");
    setApiKey("");
    setValidationStatus("idle");
    onCredentialsChange(null);
    toast({ title: "Credenciales de Todocoleccion eliminadas" });
  };

  const handleValidateTc = async () => {
    if (!userId.trim() || !apiKey.trim()) {
      toast({
        title: "Introduce User ID y API Key primero",
        variant: "destructive",
      });
      return;
    }

    setIsValidating(true);
    setValidationStatus("idle");

    try {
      const data = await validateTodocoleccion({
        credentials: {
          userId: userId.trim(),
          apiKey: apiKey.trim(),
        },
      });

      if (data?.valid) {
        setValidationStatus("valid");
        toast({
          title: "Credenciales validas",
          description:
            data.details?.totalProducts != null
              ? `${data.details.totalProducts} productos en tu cuenta`
              : data.message,
        });
        handleSaveTc();
      } else {
        setValidationStatus("invalid");
        toast({
          title: "Credenciales invalidas",
          description: data?.message ?? "No se pudieron validar",
          variant: "destructive",
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "No se pudo validar";

      setValidationStatus("invalid");
      toast({
        title: "Error al validar",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const updateSelectedDeskLocally = (
    updater: (desk: GrokDesk) => GrokDesk,
    options?: { persist?: boolean },
  ) => {
    if (!selectedGrokDesk) return;

    const nextStore = updateDeskInStore(grokStore, updater(selectedGrokDesk));
    applyGrokState(nextStore, selectedGrokDesk.id, options);
  };

  const handleDeskSelectionChange = (deskId: string) => {
    const nextDesk = getSelectedGrokDesk(grokStore, deskId);
    if (!nextDesk) return;

    setSelectedGrokDeskId(nextDesk.id);
    saveSelectedDeskId(nextDesk.id);
    onGrokCredentialsChange(nextDesk);
  };

  const handleAddDesk = () => {
    const nextDesk = createEmptyGrokDesk(grokStore.desks.length + 1);
    applyGrokState(
      { desks: [...grokStore.desks, nextDesk] },
      nextDesk.id,
      { persist: true },
    );

    toast({
      title: "Desk anadido",
      description: "Ya puedes asignarle APIs distintas a esta pestana.",
    });
  };

  const handleClearGrok = () => {
    if (!selectedGrokDesk) return;

    if (grokStore.desks.length > 1) {
      const remainingDesks = grokStore.desks.filter(
        (desk) => desk.id !== selectedGrokDesk.id,
      );
      const fallbackDesk = remainingDesks[0];

      if (!fallbackDesk) return;

      applyGrokState({ desks: remainingDesks }, fallbackDesk.id, {
        persist: true,
      });
      toast({ title: "Desk eliminado" });
      return;
    }

    const resetDesk: GrokDesk = {
      ...createEmptyGrokDesk(1),
      id: selectedGrokDesk.id,
      name: selectedGrokDesk.name,
    };

    setShowGrokKeys({});
    applyGrokState(updateDeskInStore(grokStore, resetDesk), resetDesk.id, {
      persist: true,
    });
    toast({ title: "Desk reiniciado" });
  };

  const handleAddApi = () => {
    updateSelectedDeskLocally(
      (desk) => ({
        ...desk,
        apis: [...desk.apis, createEmptyGrokApiConfig()],
      }),
      { persist: true },
    );
  };

  const handleRemoveApi = (apiId: string) => {
    if (!selectedGrokDesk) return;

    const nextApis =
      selectedGrokDesk.apis.length > 1
        ? selectedGrokDesk.apis.filter((api) => api.id !== apiId)
        : [createEmptyGrokApiConfig()];

    setShowGrokKeys((prev) => {
      const next = { ...prev };
      delete next[apiId];
      return next;
    });

    updateSelectedDeskLocally(
      (desk) => ({
        ...desk,
        apis: nextApis,
      }),
      { persist: true },
    );
  };

  const handleApiKeyChange = (apiId: string, value: string) => {
    updateSelectedDeskLocally((desk) => ({
      ...desk,
      apis: desk.apis.map((api) =>
        api.id === apiId
          ? {
              ...api,
              apiKey: value,
              status: value.trim() === api.apiKey.trim() ? api.status : "idle",
              model:
                value.trim() === api.apiKey.trim() ? api.model ?? null : null,
              lastError:
                value.trim() === api.apiKey.trim() ? api.lastError ?? null : null,
              lastValidatedAt:
                value.trim() === api.apiKey.trim()
                  ? api.lastValidatedAt ?? null
                  : null,
            }
          : api,
      ),
    }));
  };

  const handleValidateGrokApi = async (apiId: string) => {
    const apiEntry = selectedGrokDesk?.apis.find((api) => api.id === apiId);

    if (!apiEntry?.apiKey.trim()) {
      toast({
        title: "Introduce una API key primero",
        variant: "destructive",
      });
      return;
    }

    setValidatingGrokApiIds((prev) => ({ ...prev, [apiId]: true }));

    try {
      const data = await validateGrok({
        apiKey: apiEntry.apiKey.trim(),
      });

      if (data?.valid) {
        updateSelectedDeskLocally(
          (desk) => ({
            ...desk,
            apis: desk.apis.map((api) =>
              api.id === apiId
                ? {
                    ...api,
                    apiKey: api.apiKey.trim(),
                    status: "valid",
                    model: data.model ?? null,
                    lastValidatedAt: new Date().toISOString(),
                    lastError: null,
                  }
                : api,
            ),
          }),
          { persist: true },
        );

        toast({
          title: "API de Groq valida",
          description:
            data.model != null
              ? `Lista para rotacion automatica con ${data.model}`
              : "La API se ha guardado como utilizable",
        });
      } else {
        updateSelectedDeskLocally(
          (desk) => ({
            ...desk,
            apis: desk.apis.map((api) =>
              api.id === apiId
                ? {
                    ...api,
                    apiKey: api.apiKey.trim(),
                    status: "invalid",
                    model: null,
                    lastValidatedAt: null,
                    lastError: data?.message ?? "No se pudo validar",
                  }
                : api,
            ),
          }),
          { persist: true },
        );

        toast({
          title: "API de Groq invalida",
          description: data?.message ?? "No se pudo validar",
          variant: "destructive",
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "No se pudo validar";

      updateSelectedDeskLocally(
        (desk) => ({
          ...desk,
          apis: desk.apis.map((api) =>
            api.id === apiId
              ? {
                  ...api,
                  apiKey: api.apiKey.trim(),
                  status: "invalid",
                  model: null,
                  lastValidatedAt: null,
                  lastError: message,
                }
              : api,
          ),
        }),
        { persist: true },
      );

      toast({
        title: "Error al validar Groq",
        description: message,
        variant: "destructive",
      });
    } finally {
      setValidatingGrokApiIds((prev) => {
        const next = { ...prev };
        delete next[apiId];
        return next;
      });
    }
  };

  const handleSaveGrok = () => {
    if (!selectedGrokDesk) return;

    const sanitizedStore = saveGrokDeskStore(grokStore, selectedGrokDesk.id);
    const nextSelectedDesk =
      getSelectedGrokDesk(sanitizedStore, selectedGrokDesk.id) ??
      sanitizedStore.desks[0] ??
      null;

    if (!nextSelectedDesk) return;

    setGrokStore(sanitizedStore);
    setSelectedGrokDeskId(nextSelectedDesk.id);
    onGrokCredentialsChange(nextSelectedDesk);

    toast({
      title: "Desk de Groq guardado",
      description:
        usableGrokApis.length > 0
          ? `Rotacion lista con ${usableGrokApis.length} API${usableGrokApis.length === 1 ? "" : "s"} utilizable${usableGrokApis.length === 1 ? "" : "s"}.`
          : "El desk se ha guardado. Anade y valida APIs para activar la rotacion.",
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_24px_80px_-55px_rgba(15,23,42,0.45)]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-[8.75rem] w-full items-start justify-between gap-4 px-6 py-6 text-left transition-colors hover:bg-slate-50/80"
      >
        <div className="flex items-start gap-3">
          <Settings className="mt-1 h-4 w-4 text-slate-500" />
          <div>
            <span className="text-base font-semibold tracking-tight text-slate-950">
              Configuracion de APIs
            </span>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Centraliza Todocoleccion y Groq en un panel ordenado, con el mismo
              ritmo visual que el resto de la cabecera.
            </p>
          </div>
        </div>
        <ChevronDown
          className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="space-y-6 border-t border-slate-100 px-6 pb-6 pt-5">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                Todocoleccion
              </span>
              {validationStatus === "valid" && (
                <CheckCircle className="w-4 h-4 text-success" />
              )}
              {validationStatus === "invalid" && (
                <XCircle className="w-4 h-4 text-destructive" />
              )}
            </div>

            <div>
              <Label className="text-sm font-medium mb-1.5 block">
                User ID
              </Label>
              <Input
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setValidationStatus("idle");
                }}
                placeholder="Tu ID de usuario en Todocoleccion"
              />
            </div>

            <div>
              <Label className="text-sm font-medium mb-1.5 block">
                API Key
              </Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setValidationStatus("idle");
                  }}
                  placeholder="Tu clave API de Todocoleccion"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleValidateTc}
                disabled={isValidating}
                variant="secondary"
                size="sm"
                className="flex-1"
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Validar
              </Button>
              <Button
                onClick={handleSaveTc}
                variant="secondary"
                size="sm"
                className="flex-1"
              >
                Guardar
              </Button>
              <Button onClick={handleClearTc} variant="outline" size="sm">
                Borrar
              </Button>
            </div>
          </div>

          <div className="space-y-4 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                API de Groq por desk
              </span>
            </div>

            {selectedGrokDesk && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <div>
                    <Label className="text-sm font-medium mb-1.5 block">
                      Desk activo en esta pestana
                    </Label>
                    <Select
                      value={selectedGrokDesk.id}
                      onValueChange={handleDeskSelectionChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un desk" />
                      </SelectTrigger>
                      <SelectContent>
                        {grokStore.desks.map((desk) => (
                          <SelectItem key={desk.id} value={desk.id}>
                            {desk.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="self-end"
                    onClick={handleAddDesk}
                  >
                    <Plus className="w-4 h-4" />
                    Nuevo desk
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-end"
                    onClick={handleClearGrok}
                  >
                    <Trash2 className="w-4 h-4" />
                    {grokStore.desks.length > 1 ? "Borrar desk" : "Vaciar desk"}
                  </Button>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-1.5 block">
                    Nombre del desk
                  </Label>
                  <Input
                    value={selectedGrokDesk.name}
                    onChange={(e) =>
                      updateSelectedDeskLocally((desk) => ({
                        ...desk,
                        name: e.target.value,
                      }))
                    }
                    placeholder="Ej: Publicador A"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    El selector de desk es por pestana para que varias ventanas
                    puedan trabajar con grupos distintos de APIs.
                  </p>
                </div>

                <div className="space-y-3 rounded-[1.1rem] border border-primary/10 bg-primary/[0.03] p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        APIs del desk
                      </p>
                      <p className="text-xs text-muted-foreground">
                        La app empezara por la API activa y saltara sola a la
                        siguiente del desk si detecta limite o cuota agotada.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleAddApi}
                    >
                      <Plus className="w-4 h-4" />
                      Anadir API
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {selectedGrokDesk.apis.map((api, index) => {
                      const isActive = activeGrokApi?.id === api.id;
                      const isValidating = validatingGrokApiIds[api.id] === true;

                      return (
                        <div
                          key={api.id}
                          className="space-y-3 rounded-[1rem] border border-border bg-background/80 p-3"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                API {index + 1}
                              </span>
                              {isActive && (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                  Activa
                                </span>
                              )}
                              {api.status === "valid" && (
                                <CheckCircle className="w-4 h-4 text-success" />
                              )}
                              {api.status === "invalid" && (
                                <XCircle className="w-4 h-4 text-destructive" />
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleRemoveApi(api.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                              Quitar
                            </Button>
                          </div>

                          <div className="relative">
                            <Input
                              type={showGrokKeys[api.id] ? "text" : "password"}
                              value={api.apiKey}
                              onChange={(e) =>
                                handleApiKeyChange(api.id, e.target.value)
                              }
                              placeholder="Tu clave API de GroqCloud"
                              className="pr-10"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowGrokKeys((prev) => ({
                                  ...prev,
                                  [api.id]: !prev[api.id],
                                }))
                              }
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                              {showGrokKeys[api.id] ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              onClick={() => void handleValidateGrokApi(api.id)}
                              disabled={isValidating}
                              variant="secondary"
                              size="sm"
                            >
                              {isValidating ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle className="w-4 h-4" />
                              )}
                              Validar
                            </Button>
                            {api.apiKey.trim() && (
                              <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                                {maskGrokApiKey(api.apiKey)}
                              </span>
                            )}
                          </div>

                          {api.status === "valid" && (
                            <p className="text-xs text-muted-foreground">
                              Lista para la rotacion automatica
                              {api.model ? ` con ${api.model}` : ""}.
                              {isActive
                                ? " Se usa ahora mismo en este desk."
                                : " Entrara en juego cuando le toque en la cadena."}
                            </p>
                          )}
                          {api.status === "invalid" && api.lastError && (
                            <p className="text-xs text-destructive">
                              {api.lastError}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-start gap-3 rounded-[1rem] border border-primary/10 bg-primary/[0.03] px-4 py-3">
                  <input
                    type="checkbox"
                    checked
                    readOnly
                    className="mt-1 h-4 w-4"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Analisis visual premium siempre activo
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Si este desk tiene APIs de Groq, ArtFicha las usa siempre
                      como primera opcion y rota a la siguiente si una falla.
                    </p>
                  </div>
                </label>

                <div className="rounded-[1rem] border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  {usableGrokApis.length > 0 ? (
                    <>
                      Rotacion lista con {usableGrokApis.length} API
                      {usableGrokApis.length === 1 ? "" : "s"} utilizable
                      {usableGrokApis.length === 1 ? "" : "s"}.
                      {activeGrokApi
                        ? ` Activa ahora: ${maskGrokApiKey(activeGrokApi.apiKey)}.`
                        : ""}
                    </>
                  ) : (
                    <>
                      Este desk aun no tiene APIs listas para rotacion. Puedes
                      guardar el desk vacio y validar las claves cuando quieras.
                    </>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveGrok}
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                  >
                    Guardar desk
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
