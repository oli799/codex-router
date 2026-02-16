import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isAccessTokenExpired,
  refreshTokens,
  refreshAuthIfExpired,
} from "../src/token-refresh.js";
import type { CodexAuthFile } from "../src/types.js";

const fetchMock = vi.fn();

/** Build a fake JWT with the given payload. Signature is not verified. */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

function makeAuth(accessToken: string): CodexAuthFile {
  return {
    tokens: {
      access_token: accessToken,
      refresh_token: "refresh-tok",
      id_token: "id-tok",
    },
    last_refresh: new Date().toISOString(),
  };
}

describe("token-refresh", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isAccessTokenExpired", () => {
    it("returns true for non-JWT token", () => {
      const auth = makeAuth("not-a-jwt");
      expect(isAccessTokenExpired(auth)).toBe(true);
    });

    it("returns true when exp is in the past", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 300;
      const auth = makeAuth(fakeJwt({ exp: pastExp, sub: "user" }));
      expect(isAccessTokenExpired(auth)).toBe(true);
    });

    it("returns true when exp is within 60s grace period", () => {
      const soonExp = Math.floor(Date.now() / 1000) + 30;
      const auth = makeAuth(fakeJwt({ exp: soonExp, sub: "user" }));
      expect(isAccessTokenExpired(auth)).toBe(true);
    });

    it("returns false when exp is well in the future", () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const auth = makeAuth(fakeJwt({ exp: futureExp, sub: "user" }));
      expect(isAccessTokenExpired(auth)).toBe(false);
    });

    it("returns true when JWT has no exp field", () => {
      const auth = makeAuth(fakeJwt({ sub: "user" }));
      expect(isAccessTokenExpired(auth)).toBe(true);
    });
  });

  describe("refreshTokens", () => {
    it("returns new tokens on success", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-access",
          refresh_token: "new-refresh",
          id_token: "new-id",
          expires_in: 3600,
        }),
      });

      const result = await refreshTokens("old-refresh");
      expect(result.access_token).toBe("new-access");
      expect(result.refresh_token).toBe("new-refresh");
      expect(result.id_token).toBe("new-id");
      expect(result.expires_in).toBe(3600);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://auth.openai.com/oauth/token");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init.body))).toEqual({
        grant_type: "refresh_token",
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        refresh_token: "old-refresh",
      });
    });

    it("throws on HTTP error", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(refreshTokens("bad-refresh")).rejects.toThrow(
        "Token refresh failed (HTTP 403)"
      );
    });

    it("throws when response is missing fields", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "new-access" }),
      });

      await expect(refreshTokens("refresh-tok")).rejects.toThrow(
        "missing required fields"
      );
    });

    it("bubbles up network errors", async () => {
      fetchMock.mockRejectedValueOnce(new Error("network down"));
      await expect(refreshTokens("refresh-tok")).rejects.toThrow("network down");
    });
  });

  describe("refreshAuthIfExpired", () => {
    it("returns original auth if token is not expired", async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const auth = makeAuth(fakeJwt({ exp: futureExp, sub: "user" }));

      const { auth: result, refreshed } = await refreshAuthIfExpired(auth);
      expect(refreshed).toBe(false);
      expect(result).toBe(auth); // same reference
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refreshes and returns updated auth if token is expired", async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 300;
      const auth: CodexAuthFile = {
        ...makeAuth(fakeJwt({ exp: pastExp, sub: "user" })),
        auth_mode: "oauth",
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "refreshed-access",
          refresh_token: "refreshed-refresh",
          id_token: "refreshed-id",
          expires_in: 3600,
        }),
      });

      const { auth: result, refreshed } = await refreshAuthIfExpired(auth);
      expect(refreshed).toBe(true);
      expect(result.tokens.access_token).toBe("refreshed-access");
      expect(result.tokens.refresh_token).toBe("refreshed-refresh");
      expect(result.tokens.id_token).toBe("refreshed-id");
      // Extra fields preserved
      expect(result.auth_mode).toBe("oauth");
    });

    it("keeps existing refresh token when response omits refresh_token", async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 300;
      const auth = makeAuth(fakeJwt({ exp: pastExp, sub: "user" }));

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "refreshed-access",
          id_token: "refreshed-id",
          expires_in: 3600,
        }),
      });

      const { auth: result, refreshed } = await refreshAuthIfExpired(auth);
      expect(refreshed).toBe(true);
      expect(result.tokens.access_token).toBe("refreshed-access");
      expect(result.tokens.id_token).toBe("refreshed-id");
      expect(result.tokens.refresh_token).toBe("refresh-tok");
    });
  });
});
