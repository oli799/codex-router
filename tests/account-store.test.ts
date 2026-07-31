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
  upsertAccount,
  loadAccount,
  listAccounts,
  findAccountByAuth,
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

  describe("upsertAccount", () => {
    it("writes account file with private permissions", async () => {
      await upsertAccount("private-account", makeFakeAuth());

      const path = join(
        state.tmpDir,
        ".codex-router",
        "accounts",
        "private-account.json"
      );
      const result = await stat(path);
      expect(result.mode & 0o777).toBe(0o600);
    });

    it("creates new account when missing", async () => {
      const auth = makeFakeAuth("first");
      await upsertAccount("upserted", auth);

      const loaded = await loadAccount("upserted");
      expect(loaded).not.toBeNull();
      expect(loaded!.auth.tokens.access_token).toBe("fake-access-token-first");
    });

    it("overwrites existing account", async () => {
      await upsertAccount("upserted", makeFakeAuth("old"));
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
      await upsertAccount("load-test", auth);

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
      await upsertAccount("charlie", makeFakeAuth("c"));
      await upsertAccount("alice", makeFakeAuth("a"));
      await upsertAccount("bob", makeFakeAuth("b"));

      const accounts = await listAccounts(null);
      expect(accounts).toHaveLength(3);
      expect(accounts.map((a) => a.name)).toEqual(["alice", "bob", "charlie"]);
    });

    it("marks active account correctly", async () => {
      const auth = makeFakeAuth("active");
      await upsertAccount("my-account", auth);

      const accounts = await listAccounts(auth);
      expect(accounts[0].isActive).toBe(true);
    });

    it("marks no account as active when token does not match", async () => {
      await upsertAccount("other", makeFakeAuth("other"));
      const accounts = await listAccounts(makeFakeAuth("different"));
      expect(accounts[0].isActive).toBe(false);
    });

    it("marks active account when tokens rotated but account_id matches", async () => {
      await upsertAccount("personal", makeFakeAuth("old", { account_id: "acct-1" }));

      const accounts = await listAccounts(makeFakeAuth("new", { account_id: "acct-1" }));
      expect(accounts[0].isActive).toBe(true);
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

  describe("findAccountByAuth", () => {
    it("returns matching account when access token matches", async () => {
      const auth = makeFakeAuth("personal");
      await upsertAccount("personal", auth);

      const match = await findAccountByAuth(auth);
      expect(match?.name).toBe("personal");
    });

    it("returns matching account when tokens rotated but account_id matches", async () => {
      await upsertAccount("personal", makeFakeAuth("old", { account_id: "acct-1" }));

      const match = await findAccountByAuth(makeFakeAuth("new", { account_id: "acct-1" }));
      expect(match?.name).toBe("personal");
    });

    it("returns null when no account matches", async () => {
      await upsertAccount("personal", makeFakeAuth("personal", { account_id: "acct-1" }));

      const match = await findAccountByAuth(makeFakeAuth("other", { account_id: "acct-2" }));
      expect(match).toBeNull();
    });
  });

  describe("removeAccount", () => {
    it("removes existing account and returns true", async () => {
      await upsertAccount("to-remove", makeFakeAuth());
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
