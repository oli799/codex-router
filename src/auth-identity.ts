import type { CodexAuthFile } from "./types.js";
import { decodeJwtPayload } from "./jwt.js";

function jwtSubject(token: string): string | null {
  const payload = decodeJwtPayload(token);
  return typeof payload?.sub === "string" ? payload.sub : null;
}

export function getAuthIdentity(auth: CodexAuthFile): string | null {
  if (typeof auth.tokens.account_id === "string" && auth.tokens.account_id.length > 0) {
    return `account:${auth.tokens.account_id}`;
  }

  const accessTokenSubject = jwtSubject(auth.tokens.access_token);
  if (accessTokenSubject) {
    return `sub:${accessTokenSubject}`;
  }

  const idTokenSubject = jwtSubject(auth.tokens.id_token);
  if (idTokenSubject) {
    return `sub:${idTokenSubject}`;
  }

  return null;
}

export function authsMatch(left: CodexAuthFile, right: CodexAuthFile): boolean {
  const leftIdentity = getAuthIdentity(left);
  const rightIdentity = getAuthIdentity(right);

  if (leftIdentity && rightIdentity) {
    return leftIdentity === rightIdentity;
  }

  return left.tokens.access_token === right.tokens.access_token;
}
