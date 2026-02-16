import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { CliDeps, CliOutput } from "../src/index.js";
import { runCli } from "../src/index.js";
import { makeFakeAuth } from "./helpers.js";

function makeOutput(): { output: CliOutput; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    output: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
    logs,
    errors,
  };
}

function spawnClose(code: number | null): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  setTimeout(() => {
    child.emit("close", code);
  }, 0);
  return child;
}

function spawnError(err: Error): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  setTimeout(() => {
    child.emit("error", err);
  }, 0);
  return child;
}

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  const auth = makeFakeAuth("cli");

  return {
    spawn: vi.fn(() => spawnClose(0)) as CliDeps["spawn"],
    readCodexAuth: vi.fn(async () => auth),
    writeCodexAuth: vi.fn(async () => undefined),
    upsertAccount: vi.fn(async () => undefined),
    loadAccount: vi.fn(async () => ({
      name: "personal",
      savedAt: new Date().toISOString(),
      auth,
    })),
    listAccounts: vi.fn(async () => []),
    removeAccount: vi.fn(async () => true),
    validateAccountName: vi.fn((name: string) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error("Account name can only contain letters, numbers, hyphens, and underscores");
      }
    }),
    refreshAuthIfExpired: vi.fn(async (currentAuth) => ({
      auth: currentAuth,
      refreshed: false,
    })),
    ...overrides,
  };
}

describe("runCli", () => {
  it("shows usage for unknown command", async () => {
    const deps = makeDeps();
    const { output, logs, errors } = makeOutput();

    const code = await runCli(["unknown"], deps, output);

    expect(code).toBe(1);
    expect(logs[0]).toContain("Usage:");
    expect(errors).toHaveLength(0);
  });

  it("list returns success when no accounts are saved", async () => {
    const deps = makeDeps({
      readCodexAuth: vi.fn(async () => null),
      listAccounts: vi.fn(async () => []),
    });
    const { output, logs } = makeOutput();

    const code = await runCli(["list"], deps, output);

    expect(code).toBe(0);
    expect(logs.at(-1)).toContain("No saved accounts");
  });

  it("list prints saved accounts and active marker", async () => {
    const deps = makeDeps({
      readCodexAuth: vi.fn(async () => makeFakeAuth("active")),
      listAccounts: vi.fn(async () => [
        {
          name: "personal",
          savedAt: "2026-01-01T10:00:00.000Z",
          isActive: true,
        },
        {
          name: "work",
          savedAt: "2026-01-02T10:00:00.000Z",
          isActive: false,
        },
      ]),
    });
    const { output, logs } = makeOutput();

    const code = await runCli(["list"], deps, output);

    expect(code).toBe(0);
    expect(logs[0]).toBe("Saved accounts:");
    expect(logs[1]).toContain("personal (active)");
    expect(logs[2]).toContain("work");
  });

  it("add returns error for invalid account name", async () => {
    const deps = makeDeps();
    const { output, errors } = makeOutput();

    const code = await runCli(["add", "bad name"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Account name can only contain");
  });

  it("add returns verbose error when codex cannot be spawned", async () => {
    const err = Object.assign(new Error("spawn codex ENOENT"), {
      code: "ENOENT",
      errno: -2,
      syscall: "spawn codex",
      path: "codex",
      spawnargs: ["login"],
    });
    const deps = makeDeps({
      spawn: vi.fn(() => spawnError(err)) as CliDeps["spawn"],
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["add", "work"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Error: Failed to launch `codex login`");
    expect(errors[0]).toContain("spawn codex ENOENT");
    expect(errors[0]).toContain("code=ENOENT");
  });

  it("add handles non-Error spawn failures", async () => {
    const deps = makeDeps({
      spawn: vi.fn(() => spawnError("bad spawn" as unknown as Error)) as CliDeps["spawn"],
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["add", "work"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Error: Failed to launch `codex login`: bad spawn");
  });

  it("add returns error when codex login exits non-zero", async () => {
    const deps = makeDeps({
      spawn: vi.fn(() => spawnClose(2)) as CliDeps["spawn"],
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["add", "personal"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("codex login exited with code 2");
  });

  it("add persists account after successful login", async () => {
    const deps = makeDeps();
    const { output, logs } = makeOutput();

    const code = await runCli(["add", "personal"], deps, output);

    expect(code).toBe(0);
    expect(deps.upsertAccount).toHaveBeenCalledWith("personal", expect.any(Object));
    expect(logs.at(-1)).toContain('Account "personal" saved.');
  });

  it("add fails when login does not produce credentials", async () => {
    const deps = makeDeps({
      readCodexAuth: vi.fn(async () => null),
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["add", "personal"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Login did not produce credentials");
  });

  it("add fails when storing account fails", async () => {
    const deps = makeDeps({
      upsertAccount: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["add", "personal"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Error: disk full");
  });

  it("switch fails for invalid account names", async () => {
    const deps = makeDeps();
    const { output, errors } = makeOutput();

    const code = await runCli(["switch", "bad name"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Account name can only contain");
  });

  it("switch returns error when account does not exist", async () => {
    const deps = makeDeps({
      loadAccount: vi.fn(async () => null),
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["switch", "missing"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain('Account "missing" not found');
  });

  it("switch writes refreshed auth and updates stored account", async () => {
    const refreshed = makeFakeAuth("new");
    const deps = makeDeps({
      refreshAuthIfExpired: vi.fn(async () => ({
        auth: refreshed,
        refreshed: true,
      })),
    });
    const { output, logs } = makeOutput();

    const code = await runCli(["switch", "personal"], deps, output);

    expect(code).toBe(0);
    expect(deps.writeCodexAuth).toHaveBeenCalledWith(refreshed);
    expect(deps.upsertAccount).toHaveBeenCalledWith("personal", refreshed);
    expect(logs.at(-1)).toContain("tokens refreshed");
  });

  it("switch fails when writing auth fails", async () => {
    const deps = makeDeps({
      writeCodexAuth: vi.fn(async () => {
        throw new Error("write failed");
      }),
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["switch", "personal"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Error: write failed");
  });

  it("remove returns error when account does not exist", async () => {
    const deps = makeDeps({
      removeAccount: vi.fn(async () => false),
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["remove", "missing"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain('Account "missing" not found.');
  });

  it("remove fails for invalid account names", async () => {
    const deps = makeDeps();
    const { output, errors } = makeOutput();

    const code = await runCli(["remove", "bad name"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Account name can only contain");
  });

  it("remove returns success when account exists", async () => {
    const deps = makeDeps({
      removeAccount: vi.fn(async () => true),
    });
    const { output, logs } = makeOutput();

    const code = await runCli(["remove", "personal"], deps, output);

    expect(code).toBe(0);
    expect(logs[0]).toContain('Account "personal" removed.');
  });

  it("returns fatal error when dependency throws unexpectedly", async () => {
    const deps = makeDeps({
      listAccounts: vi.fn(async () => {
        throw new Error("unexpected failure");
      }),
    });
    const { output, errors } = makeOutput();

    const code = await runCli(["list"], deps, output);

    expect(code).toBe(1);
    expect(errors[0]).toContain("Fatal error: unexpected failure");
  });
});
