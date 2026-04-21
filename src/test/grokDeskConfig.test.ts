import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyGrokDesk,
  getApiRotationOrder,
  isGrokCapacityError,
  loadGrokDeskStore,
  saveGrokDeskStore,
} from "@/lib/grokDeskConfig";

describe("grokDeskConfig", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores Groq desks in sessionStorage instead of localStorage", () => {
    const desk = {
      ...createEmptyGrokDesk(1),
      apis: [
        {
          id: "api-1",
          apiKey: "gsk_test_123",
          status: "valid" as const,
          model: "vision",
          lastValidatedAt: null,
          lastError: null,
        },
      ],
      activeApiId: "api-1",
    };

    saveGrokDeskStore({ desks: [desk] }, desk.id);

    expect(window.sessionStorage.getItem("artficha_grok_desks")).toContain(
      "gsk_test_123",
    );
    expect(window.localStorage.getItem("artficha_grok_desks")).toBeNull();
    expect(loadGrokDeskStore().desks[0].apis[0].apiKey).toBe("gsk_test_123");
  });

  it("rotates from the active API first and keeps valid fallbacks", () => {
    const desk = createEmptyGrokDesk(1);
    const apis = [
      { ...desk.apis[0], id: "a", apiKey: "key-a", status: "valid" as const },
      { ...desk.apis[0], id: "b", apiKey: "key-b", status: "valid" as const },
      { ...desk.apis[0], id: "c", apiKey: "", status: "idle" as const },
    ];

    expect(
      getApiRotationOrder({ ...desk, apis, activeApiId: "b" }).map(
        (api) => api.id,
      ),
    ).toEqual(["b", "a"]);
  });

  it("detects token and rate-limit capacity errors", () => {
    expect(isGrokCapacityError(new Error("rate limit exceeded"))).toBe(true);
    expect(isGrokCapacityError(new Error("insufficient quota"))).toBe(true);
    expect(isGrokCapacityError(new Error("invalid api key"))).toBe(false);
  });
});
