import {
  readFile,
  writeFile,
  readdir,
  unlink,
  mkdir,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CodexAuthFile, AccountMetadata, AccountSummary } from "./types.js";
import { authsMatch } from "./auth-identity.js";

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PRIVATE_CREDENTIAL_FILE_MODE = 0o600;

function accountsDir(): string {
  return join(homedir(), ".codex-router", "accounts");
}

function accountPath(name: string): string {
  return join(accountsDir(), `${name}.json`);
}

function parseAccountMetadata(raw: string, filePath: string): AccountMetadata {
  try {
    return JSON.parse(raw) as AccountMetadata;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid account file "${filePath}": ${reason}`);
  }
}

async function writeAccountFile(path: string, metadata: AccountMetadata): Promise<void> {
  await writeFile(path, JSON.stringify(metadata, null, 2), {
    encoding: "utf-8",
    mode: PRIVATE_CREDENTIAL_FILE_MODE,
  });
  await chmod(path, PRIVATE_CREDENTIAL_FILE_MODE);
}

export async function ensureAccountsDir(): Promise<void> {
  await mkdir(accountsDir(), { recursive: true });
}

export function validateAccountName(name: string): void {
  if (!name) {
    throw new Error("Account name cannot be empty");
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      "Account name can only contain letters, numbers, hyphens, and underscores"
    );
  }
}

export async function saveAccount(
  name: string,
  auth: CodexAuthFile
): Promise<void> {
  validateAccountName(name);
  await ensureAccountsDir();

  const path = accountPath(name);
  try {
    await readFile(path, "utf-8");
    throw new Error(
      `Account "${name}" already exists. Remove it first with \`codex-router remove ${name}\`.`
    );
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  const metadata: AccountMetadata = {
    name,
    savedAt: new Date().toISOString(),
    auth,
  };

  await writeAccountFile(path, metadata);
}

export async function upsertAccount(
  name: string,
  auth: CodexAuthFile
): Promise<void> {
  validateAccountName(name);
  await ensureAccountsDir();

  const metadata: AccountMetadata = {
    name,
    savedAt: new Date().toISOString(),
    auth,
  };

  await writeAccountFile(accountPath(name), metadata);
}

export async function loadAccount(
  name: string
): Promise<AccountMetadata | null> {
  validateAccountName(name);
  const path = accountPath(name);
  try {
    const raw = await readFile(path, "utf-8");
    return parseAccountMetadata(raw, path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function listAccounts(
  currentAuth: CodexAuthFile | null
): Promise<AccountSummary[]> {
  await ensureAccountsDir();

  const dir = accountsDir();
  const files = await readdir(dir);
  const results: AccountSummary[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const path = join(dir, file);
    const raw = await readFile(path, "utf-8");
    const meta = parseAccountMetadata(raw, path);

    results.push({
      name: meta.name,
      savedAt: meta.savedAt,
      isActive: currentAuth !== null && authsMatch(meta.auth, currentAuth),
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findAccountByAuth(
  auth: CodexAuthFile
): Promise<AccountMetadata | null> {
  await ensureAccountsDir();

  const dir = accountsDir();
  const files = await readdir(dir);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const path = join(dir, file);
    const raw = await readFile(path, "utf-8");
    const meta = parseAccountMetadata(raw, path);

    if (authsMatch(meta.auth, auth)) {
      return meta;
    }
  }

  return null;
}

export async function removeAccount(name: string): Promise<boolean> {
  validateAccountName(name);
  try {
    await unlink(accountPath(name));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }
}
