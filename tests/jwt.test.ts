import { describe, it, expect } from "vitest";
import { decodeJwtPayload } from "../src/jwt.js";

/** Build a fake JWT with the given payload. Signature is not verified. */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

describe("decodeJwtPayload", () => {
  it("decodes a valid JWT payload", () => {
    const token = fakeJwt({ sub: "user-1", exp: 1234567890 });
    expect(decodeJwtPayload(token)).toEqual({ sub: "user-1", exp: 1234567890 });
  });

  it("returns null for tokens without exactly three parts", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("two.parts")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    const header = Buffer.from("{}").toString("base64url");
    const token = `${header}.%%%invalid%%%.fake-signature`;
    expect(decodeJwtPayload(token)).toBeNull();
  });
});
