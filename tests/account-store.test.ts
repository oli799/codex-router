import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { createTmpDir, cleanTmpDir, makeFakeAuth } from "./helpers.js";

const state = vi.hoisted(() => ({ tmpDir: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => state.tmpDir };
});

const {
  saveAccount,
  upsertAccount,
  loadAccount,
  listAccounts,
  removeAccount,
  validateAccountName,
  ensureAccountsDir,
} = await import("../src/account-store.js");

describe("account-store", () => {
  beforeEach(async () => {
    state.tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await cleanTmpDir(state.tmpDir);
  });

  describe("validateAccountName", () => {
    it("accepts valid names", () => {
      expect(() => validateAccountName("personal")).not.toThrow();
      expect(() => validateAccountName("work-2")).not.toThrow();
      expect(() => validateAccountName("my_account")).not.toThrow();
    });

    it("rejects empty name", () => {
      expect(() => validateAccountName("")).toThrow("cannot be empty");
    });

    it("rejects names with special characters", () => {
      expect(() => validateAccountName("my account")).toThrow();
      expect(() => validateAccountName("../hack")).toThrow();
      expect(() => validateAccountName("foo/bar")).toThrow();
    });
  });

  describe("saveAccount", () => {
    it("saves account to disk", async () => {
      const auth = makeFakeAuth();
      await saveAccount("test-account", auth);

      const loaded = await loadAccount("test-account");
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe("test-account");
      expect(loaded!.auth).toEqual(auth);
      expect(loaded!.savedAt).toBeTruthy();
    });

    it("rejects duplicate names", async () => {
      const auth = makeFakeAuth();
      await saveAccount("dup", auth);
      await expect(saveAccount("dup", auth)).rejects.toThrow("already exists");
    });

    it("rejects invalid names", async () => {
      await expect(saveAccount("", makeFakeAuth())).rejects.toThrow();
    });

    it("writes account file with private permissions", async () => {
      await saveAccount("private-account", makeFakeAuth());

      const path = join(
        state.tmpDir,
        ".codex-router",
        "accounts",
        "private-account.json"
      );
      const result = await stat(path);
      expect(result.mode & 0o777).toBe(0o600);
    });
  });

  describe("upsertAccount", () => {
    it("creates new account when missing", async () => {
      const auth = makeFakeAuth("first");
      await upsertAccount("upserted", auth);

      const loaded = await loadAccount("upserted");
      expect(loaded).not.toBeNull();
      expect(loaded!.auth.tokens.access_token).toBe("fake-access-token-first");
    });

    it("overwrites existing account", async () => {
      await saveAccount("upserted", makeFakeAuth("old"));
      await upsertAccount("upserted", makeFakeAuth("new"));

      const loaded = await loadAccount("upserted");
      expect(loaded).not.toBeNull();
      expect(loaded!.auth.tokens.access_token).toBe("fake-access-token-new");
    });

    it("enforces private permissions when overwriting", async () => {
      const path = join(state.tmpDir, ".codex-router", "accounts", "upserted.json");
      await mkdir(join(state.tmpDir, ".codex-router", "accounts"), { recursive: true });
      await writeFile(path, JSON.stringify({ old: true }), "utf-8");
      await chmod(path, 0o644);

      await upsertAccount("upserted", makeFakeAuth("new"));

      const result = await stat(path);
      expect(result.mode & 0o777).toBe(0o600);
    });
  });

  describe("loadAccount", () => {
    it("returns null for non-existent account", async () => {
      await ensureAccountsDir();
      const result = await loadAccount("nope");
      expect(result).toBeNull();
    });

    it("loads a previously saved account", async () => {
      const auth = makeFakeAuth("load");
      await saveAccount("load-test", auth);

      const loaded = await loadAccount("load-test");
      expect(loaded!.auth.tokens.access_token).toBe("fake-access-token-load");
    });

    it("throws verbose error for malformed account json", async () => {
      const badPath = join(
        state.tmpDir,
        ".codex-router",
        "accounts",
        "broken.json"
      );
      await mkdir(join(state.tmpDir, ".codex-router", "accounts"), {
        recursive: true,
      });
      await writeFile(badPath, "{ not json");

      await expect(loadAccount("broken")).rejects.toThrow(
        `Invalid account file "${badPath}"`
      );
    });
  });

  describe("listAccounts", () => {
    it("returns empty array when no accounts exist", async () => {
      const accounts = await listAccounts(null);
      expect(accounts).toEqual([]);
    });

    it("lists all saved accounts sorted by name", async () => {
      await saveAccount("charlie", makeFakeAuth("c"));
      await saveAccount("alice", makeFakeAuth("a"));
      await saveAccount("bob", makeFakeAuth("b"));

      const accounts = await listAccounts(null);
      expect(accounts).toHaveLength(3);
      expect(accounts.map((a) => a.name)).toEqual(["alice", "bob", "charlie"]);
    });

    it("marks active account correctly", async () => {
      const auth = makeFakeAuth("active");
      await saveAccount("my-account", auth);

      const accounts = await listAccounts(auth.tokens.access_token);
      expect(accounts[0].isActive).toBe(true);
    });

    it("marks no account as active when token does not match", async () => {
      await saveAccount("other", makeFakeAuth("other"));
      const accounts = await listAccounts("different-token");
      expect(accounts[0].isActive).toBe(false);
    });

    it("throws verbose error if an account file is malformed", async () => {
      const badPath = join(
        state.tmpDir,
        ".codex-router",
        "accounts",
        "broken.json"
      );
      await mkdir(join(state.tmpDir, ".codex-router", "accounts"), {
        recursive: true,
      });
      await writeFile(badPath, "{ not json");

      await expect(listAccounts(null)).rejects.toThrow(
        `Invalid account file "${badPath}"`
      );
    });
  });

  describe("removeAccount", () => {
    it("removes existing account and returns true", async () => {
      await saveAccount("to-remove", makeFakeAuth());
      const removed = await removeAccount("to-remove");
      expect(removed).toBe(true);

      const loaded = await loadAccount("to-remove");
      expect(loaded).toBeNull();
    });

    it("returns false for non-existent account", async () => {
      await ensureAccountsDir();
      const removed = await removeAccount("ghost");
      expect(removed).toBe(false);
    });

    it("rethrows non-ENOENT unlink errors", async () => {
      const dirPath = join(
        state.tmpDir,
        ".codex-router",
        "accounts",
        "locked.json"
      );
      await mkdir(dirPath, { recursive: true });

      await expect(removeAccount("locked")).rejects.toThrow();
    });
  });
});
