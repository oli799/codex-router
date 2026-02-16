# Codex Router

Switch between [Codex](https://github.com/openai/codex) accounts without leaving your terminal.

## Install

Install globally from npm:

```bash
npm install -g codex-router
```

## What it does

- Adds and stores multiple Codex accounts under friendly names.
- Lists stored accounts and marks the currently active one.
- Switches active account by rewriting `~/.codex/auth.json`.
- Backs up the current auth file to `~/.codex/auth.json.bak` before every switch.
- Refreshes expired access tokens during switch (using the saved refresh token).

## Requirements

- Node.js 18+ (Node 20+ recommended)
- npm
- Codex CLI installed and available as `codex` in your `PATH`

## Quick start

```bash
codex-router list
codex-router add <name>
codex-router switch <name>
codex-router remove <name>
```

## Typical workflow

```bash
# Save first account
codex-router add personal

# Save second account
codex-router add work

# Show saved accounts and which one is active
codex-router list

# Switch active auth to another saved account
codex-router switch personal
```

After `switch`, restart Codex CLI clients so they reload the updated auth file.

## Command reference

```text
codex-router list
  Lists all saved accounts.

codex-router add <name>
  Runs `codex login`, then saves the resulting account as <name>.
  If <name> already exists, it is replaced.

codex-router switch <name>
  Makes <name> the active account by writing ~/.codex/auth.json.
  If the saved access token is expired, tokens are refreshed first.

codex-router remove <name>
  Deletes the saved account from local storage.
```

Account name rules:

- Allowed characters: letters, numbers, `-`, `_`
- Examples: `personal`, `work-2`, `team_alpha`
- Invalid examples: `my account`, `../prod`, `foo/bar`

## Storage layout

| Path | Purpose |
| --- | --- |
| `~/.codex-router/accounts/<name>.json` | Saved account metadata + tokens |
| `~/.codex/auth.json` | Active account used by Codex CLI |
| `~/.codex/auth.json.bak` | Backup created before write |

## Safety notes

- Credentials are stored in plain JSON files on your local machine.
- `switch` always attempts to back up the current active auth file first.
- `add` depends on a successful interactive `codex login`.

## Local development

```bash
npm run dev            # TypeScript watch build
npm run build          # Compile to dist/ and run tests
npm run test           # Run unit tests
npm run test:coverage  # Run tests with coverage
```

## License

MIT
