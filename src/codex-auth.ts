import { readFile, writeFile, rename, copyFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { CodexAuthFile } from "./types.js";

const PRIVATE_CREDENTIAL_FILE_MODE = 0o600;

function codexDir(): string {
  return join(homedir(), ".codex");
}

function authFile(): string {
  return join(codexDir(), "auth.json");
}

function authBackup(): string {
  return join(codexDir(), "auth.json.bak");
}

async function ensureCodexDirExists(): Promise<void> {
  const dir = codexDir();
  try {
    await access(dir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(`Missing ~/.codex directory. Run \`codex login\` first.`);
    }
    throw err;
  }
}

export function getCodexAuthPath(): string {
  return authFile();
}

export async function readCodexAuth(): Promise<CodexAuthFile | null> {
  try {
    const raw = await readFile(authFile(), "utf-8");
    const parsed = JSON.parse(raw) as CodexAuthFile;

    if (
      !parsed.tokens?.access_token ||
      !parsed.tokens?.refresh_token ||
      !parsed.tokens?.id_token
    ) {
      throw new Error("auth.json is missing required token fields");
    }

    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function backupCodexAuth(): Promise<void> {
  try {
    await copyFile(authFile(), authBackup());
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }
}

export async function writeCodexAuth(auth: CodexAuthFile): Promise<void> {
  await ensureCodexDirExists();
  await backupCodexAuth();

  const dir = codexDir();
  const tmpFile = join(dir, `auth.json.tmp-${randomBytes(4).toString("hex")}`);
  await writeFile(tmpFile, JSON.stringify(auth, null, 2), {
    encoding: "utf-8",
    mode: PRIVATE_CREDENTIAL_FILE_MODE,
  });
  await rename(tmpFile, authFile());
}
