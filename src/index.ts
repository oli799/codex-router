#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCodexAuth, writeCodexAuth } from "./codex-auth.js";
import {
  upsertAccount,
  loadAccount,
  listAccounts,
  removeAccount,
  validateAccountName,
} from "./account-store.js";
import { refreshAuthIfExpired } from "./token-refresh.js";

export interface CliDeps {
  spawn: typeof spawn;
  readCodexAuth: typeof readCodexAuth;
  writeCodexAuth: typeof writeCodexAuth;
  upsertAccount: typeof upsertAccount;
  loadAccount: typeof loadAccount;
  listAccounts: typeof listAccounts;
  removeAccount: typeof removeAccount;
  validateAccountName: typeof validateAccountName;
  refreshAuthIfExpired: typeof refreshAuthIfExpired;
}

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaultDeps: CliDeps = {
  spawn,
  readCodexAuth,
  writeCodexAuth,
  upsertAccount,
  loadAccount,
  listAccounts,
  removeAccount,
  validateAccountName,
  refreshAuthIfExpired,
};

const defaultOutput: CliOutput = {
  log: console.log,
  error: console.error,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatSpawnError(command: string, args: string[], err: unknown): string {
  if (!(err instanceof Error)) {
    return `Failed to launch \`${command} ${args.join(" ")}\`: ${String(err)}`;
  }

  const spawnErr = err as Error & {
    code?: string;
    errno?: number | string;
    syscall?: string;
    path?: string;
    spawnargs?: string[];
  };
  const details: string[] = [];

  if (spawnErr.code) details.push(`code=${spawnErr.code}`);
  if (spawnErr.errno !== undefined) details.push(`errno=${spawnErr.errno}`);
  if (spawnErr.syscall) details.push(`syscall=${spawnErr.syscall}`);
  if (spawnErr.path) details.push(`path=${spawnErr.path}`);
  if (spawnErr.spawnargs?.length) details.push(`spawnargs=${spawnErr.spawnargs.join(" ")}`);

  const detailText = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `Failed to launch \`${command} ${args.join(" ")}\`: ${spawnErr.message}${detailText}`;
}

function usage(output: CliOutput): number {
  output.log(`Usage:
  codex-router list                 List saved accounts
  codex-router add <name>           Login and save a new account
  codex-router switch <name>        Switch to a saved account
  codex-router remove <name>        Remove a saved account`);
  return 1;
}

async function cmdList(deps: CliDeps, output: CliOutput): Promise<number> {
  const currentAuth = await deps.readCodexAuth();
  const currentToken = currentAuth?.tokens.access_token ?? null;
  const accounts = await deps.listAccounts(currentToken);

  if (accounts.length === 0) {
    output.log("No saved accounts. Use `codex-router add <name>` to save your current account.");
    return 0;
  }

  output.log("Saved accounts:");
  for (const a of accounts) {
    const marker = a.isActive ? " (active)" : "";
    const date = new Date(a.savedAt).toLocaleDateString();
    output.log(`  ${a.name}${marker} — saved ${date}`);
  }

  return 0;
}

async function cmdAdd(name: string, deps: CliDeps, output: CliOutput): Promise<number> {
  try {
    deps.validateAccountName(name);
  } catch (err: unknown) {
    output.error(`Error: ${errorMessage(err)}`);
    return 1;
  }

  output.log("Starting login flow...");

  // Spawn codex login and pipe its output directly to the terminal
  const command = "codex";
  const args = ["login"];
  const child = deps.spawn(command, args, {
    stdio: ["inherit", "inherit", "inherit"],
  });

  let exitCode: number | null;
  try {
    exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", (err) => {
        reject(new Error(formatSpawnError(command, args, err)));
      });
      child.once("close", (code) => {
        resolve(code);
      });
    });
  } catch (err: unknown) {
    output.error(`Error: ${errorMessage(err)}`);
    return 1;
  }

  if (exitCode !== 0) {
    output.error(`codex login exited with code ${exitCode}.`);
    return 1;
  }

  // After login completes, read the new auth and save it
  const newAuth = await deps.readCodexAuth();
  if (!newAuth) {
    output.error("Error: Login did not produce credentials.");
    return 1;
  }

  try {
    await deps.upsertAccount(name, newAuth);
    output.log(`Account "${name}" saved.`);
    return 0;
  } catch (err: unknown) {
    output.error(`Error: ${errorMessage(err)}`);
    return 1;
  }
}

async function cmdSwitch(name: string, deps: CliDeps, output: CliOutput): Promise<number> {
  try {
    deps.validateAccountName(name);
  } catch (err: unknown) {
    output.error(`Error: ${errorMessage(err)}`);
    return 1;
  }

  const account = await deps.loadAccount(name);
  if (!account) {
    output.error(`Error: Account "${name}" not found. Use \`codex-router list\` to see available accounts.`);
    return 1;
  }

  try {
    const { auth: freshAuth, refreshed } = await deps.refreshAuthIfExpired(account.auth);
    await deps.writeCodexAuth(freshAuth);

    if (refreshed) {
      await deps.upsertAccount(name, freshAuth);
    }

    const refreshNote = refreshed ? " (tokens refreshed)" : "";
    output.log(`Switched to account "${name}"${refreshNote}. Please restart Codex.`);
    return 0;
  } catch (err: unknown) {
    output.error(`Error: ${errorMessage(err)}`);
    return 1;
  }
}

async function cmdRemove(name: string, deps: CliDeps, output: CliOutput): Promise<number> {
  try {
    deps.validateAccountName(name);
  } catch (err: unknown) {
    output.error(`Error: ${errorMessage(err)}`);
    return 1;
  }

  const removed = await deps.removeAccount(name);
  if (!removed) {
    output.error(`Account "${name}" not found.`);
    return 1;
  }

  output.log(`Account "${name}" removed.`);
  return 0;
}

export async function runCli(
  argv: string[],
  deps: CliDeps = defaultDeps,
  output: CliOutput = defaultOutput
): Promise<number> {
  const [command, ...args] = argv;

  try {
    switch (command) {
      case "list":
        return await cmdList(deps, output);
      case "add":
        return args[0] ? await cmdAdd(args[0], deps, output) : usage(output);
      case "switch":
        return args[0] ? await cmdSwitch(args[0], deps, output) : usage(output);
      case "remove":
        return args[0] ? await cmdRemove(args[0], deps, output) : usage(output);
      default:
        return usage(output);
    }
  } catch (err: unknown) {
    output.error(`Fatal error: ${errorMessage(err)}`);
    return 1;
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    const currentModulePath = realpathSync(fileURLToPath(import.meta.url));
    const invokedPath = realpathSync(process.argv[1]);
    return currentModulePath === invokedPath;
  } catch {
    // Fallback for uncommon environments where realpath/fileURL conversion fails.
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((err: unknown) => {
      console.error(`Fatal error: ${errorMessage(err)}`);
      process.exit(1);
    });
}
