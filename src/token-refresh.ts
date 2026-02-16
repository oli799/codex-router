import type { CodexAuthFile, TokenRefreshResult } from "./types.js";

const AUTH0_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const EXPIRY_GRACE_SECONDS = 60;

/**
 * Decode the payload of a JWT without verifying signature.
 * Returns null if the token is not a valid 3-part JWT.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check whether the access_token in an auth file has expired (or will expire within grace period).
 */
export function isAccessTokenExpired(auth: CodexAuthFile): boolean {
  const payload = decodeJwtPayload(auth.tokens.access_token);
  if (!payload || typeof payload.exp !== "number") {
    // Cannot determine expiry — treat as expired to be safe
    return true;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp - nowSeconds <= EXPIRY_GRACE_SECONDS;
}

/**
 * Exchange a refresh_token for new tokens via Auth0.
 */
export async function refreshTokens(
  refreshToken: string
): Promise<TokenRefreshResult> {
  const response = await fetch(AUTH0_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Token refresh failed (HTTP ${response.status}): ${body}`
    );
  }

  const data = (await response.json()) as TokenRefreshResult;

  if (!data.access_token || !data.id_token) {
    throw new Error("Token refresh response missing required fields");
  }

  return data;
}

/**
 * If the access token is expired, refresh it and return an updated CodexAuthFile.
 * Returns the original auth unchanged if the token is still valid.
 */
export async function refreshAuthIfExpired(
  auth: CodexAuthFile
): Promise<{ auth: CodexAuthFile; refreshed: boolean }> {
  if (!isAccessTokenExpired(auth)) {
    return { auth, refreshed: false };
  }

  const result = await refreshTokens(auth.tokens.refresh_token);

  const refreshedAuth: CodexAuthFile = {
    ...auth,
    tokens: {
      ...auth.tokens,
      access_token: result.access_token,
      refresh_token: result.refresh_token ?? auth.tokens.refresh_token,
      id_token: result.id_token,
    },
    last_refresh: new Date().toISOString(),
  };

  return { auth: refreshedAuth, refreshed: true };
}
