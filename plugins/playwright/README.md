# Playwright Codex Plugin

This local plugin adds a Playwright-focused Codex skill and a small smoke-test helper script.

## Contents

- `.codex-plugin/plugin.json` - plugin manifest
- `skills/playwright/SKILL.md` - instructions Codex should follow for Playwright work
- `scripts/playwright-smoke.mjs` - quick URL smoke test with optional screenshot output

## Smoke Test Helper

Run from the workspace root after Playwright is installed in the project:

```bash
node ./plugins/playwright/scripts/playwright-smoke.mjs http://localhost:3000 --screenshot ./.codex-artifacts/playwright-smoke.png
```

## Before Publishing

Fill the remaining `[TODO: ...]` manifest fields in `.codex-plugin/plugin.json`, especially author, homepage, repository, license, website, privacy policy, and terms of service.

Marketplace registration is not included yet. Add it only after choosing whether this plugin should be repo-local or home-local.
