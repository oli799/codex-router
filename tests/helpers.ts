import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CodexAuthFile } from "../src/types.js";

export async function createTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "codex-router-test-"));
}

export async function cleanTmpDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function makeFakeAuth(
  suffix = "1",
  options?: { account_id?: string; auth_mode?: string }
): CodexAuthFile {
  return {
    tokens: {
      access_token: `fake-access-token-${suffix}`,
      refresh_token: `fake-refresh-token-${suffix}`,
      id_token: `fake-id-token-${suffix}`,
      ...(options?.account_id ? { account_id: options.account_id } : {}),
    },
    last_refresh: new Date().toISOString(),
    ...(options?.auth_mode ? { auth_mode: options.auth_mode } : {}),
  };
}
