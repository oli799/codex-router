import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, writeFile, mkdir, rm, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTmpDir, cleanTmpDir, makeFakeAuth } from "./helpers.js";

const state = vi.hoisted(() => ({ tmpDir: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => state.tmpDir };
});

const { readCodexAuth, writeCodexAuth, backupCodexAuth, getCodexAuthPath } =
  await import("../src/codex-auth.js");

describe("codex-auth", () => {
  let authFile: string;
  let authBackupFile: string;

  beforeEach(async () => {
    state.tmpDir = await createTmpDir();
    authFile = join(state.tmpDir, ".codex", "auth.json");
    authBackupFile = join(state.tmpDir, ".codex", "auth.json.bak");
    await mkdir(join(state.tmpDir, ".codex"), { recursive: true });
  });

  afterEach(async () => {
    await cleanTmpDir(state.tmpDir);
  });

  describe("getCodexAuthPath", () => {
    it("returns path under homedir", () => {
      const path = getCodexAuthPath();
      expect(path).toContain(".codex");
      expect(path).toContain("auth.json");
    });
  });

  describe("readCodexAuth", () => {
    it("returns null when file does not exist", async () => {
      const result = await readCodexAuth();
      expect(result).toBeNull();
    });

    it("reads and parses valid auth file", async () => {
      const auth = makeFakeAuth();
      await writeFile(authFile, JSON.stringify(auth));

      const result = await readCodexAuth();
      expect(result).toEqual(auth);
    });

    it("throws on invalid json", async () => {
      await writeFile(authFile, "not json");
      await expect(readCodexAuth()).rejects.toThrow();
    });

    it("throws when required fields are missing", async () => {
      await writeFile(authFile, JSON.stringify({ tokens: {} }));
      await expect(readCodexAuth()).rejects.toThrow("missing required token fields");
    });
  });

  describe("writeCodexAuth", () => {
    it("writes auth file atomically", async () => {
      const auth = makeFakeAuth();
      await writeCodexAuth(auth);

      const raw = await readFile(authFile, "utf-8");
      expect(JSON.parse(raw)).toEqual(auth);
    });

    it("writes auth file with private permissions", async () => {
      await writeCodexAuth(makeFakeAuth());

      const result = await stat(authFile);
      expect(result.mode & 0o777).toBe(0o600);
    });

    it("creates backup of existing file before writing", async () => {
      const oldAuth = makeFakeAuth("old");
      await writeFile(authFile, JSON.stringify(oldAuth));

      const newAuth = makeFakeAuth("new");
      await writeCodexAuth(newAuth);

      const backupRaw = await readFile(authBackupFile, "utf-8");
      expect(JSON.parse(backupRaw)).toEqual(oldAuth);

      const currentRaw = await readFile(authFile, "utf-8");
      expect(JSON.parse(currentRaw)).toEqual(newAuth);
    });

    it("succeeds even without existing auth file to backup", async () => {
      const auth = makeFakeAuth();
      await expect(writeCodexAuth(auth)).resolves.toBeUndefined();
    });

    it("returns clear error when ~/.codex directory is missing", async () => {
      await rm(join(state.tmpDir, ".codex"), { recursive: true, force: true });

      const auth = makeFakeAuth();
      await expect(writeCodexAuth(auth)).rejects.toThrow(
        "Missing ~/.codex directory"
      );
    });
  });

  describe("backupCodexAuth", () => {
    it("copies auth.json to auth.json.bak", async () => {
      const auth = makeFakeAuth();
      await writeFile(authFile, JSON.stringify(auth));

      await backupCodexAuth();

      const backupRaw = await readFile(authBackupFile, "utf-8");
      expect(JSON.parse(backupRaw)).toEqual(auth);
    });

    it("does not throw when no auth.json exists", async () => {
      await expect(backupCodexAuth()).resolves.toBeUndefined();
    });

    it("rethrows non-ENOENT copy errors", async () => {
      await mkdir(authFile, { recursive: true });
      await expect(backupCodexAuth()).rejects.toThrow();
    });
  });

  describe("writeCodexAuth permission errors", () => {
    it("rethrows unexpected codex directory access errors", async () => {
      await chmod(join(state.tmpDir, ".codex"), 0o000);

      try {
        await expect(writeCodexAuth(makeFakeAuth())).rejects.toThrow();
      } finally {
        await chmod(join(state.tmpDir, ".codex"), 0o700);
      }
    });
  });
});
