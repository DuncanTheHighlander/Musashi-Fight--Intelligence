---
name: playwright
description: Use Playwright for browser automation, end-to-end tests, screenshots, traces, and local web app verification from Codex.
---

# Playwright

Use this skill when the user asks to create, run, debug, or maintain Playwright tests, automate a browser with Playwright, capture screenshots, verify a local web app, or investigate browser-only behavior.

## Workflow

1. Inspect the project first.
   - Prefer the repo's existing Playwright config, package manager, scripts, fixtures, test directories, and naming conventions.
   - Look for `playwright.config.*`, `package.json`, `tests/`, `e2e/`, and existing CI commands before adding anything.

2. Install or bootstrap only when needed.
   - If Playwright is already present, use the local install through the repo package manager.
   - If it is missing and the user asked for Playwright setup, add it using the repo's package manager and create the smallest useful config.
   - Install browsers with the matching local command, such as `pnpm exec playwright install`, `npm exec playwright install`, or `npx playwright install`.

3. Run targeted checks.
   - Prefer a single focused spec or project first.
   - Use headed mode, screenshots, traces, or the Playwright inspector when the failure needs visual diagnosis.
   - Keep generated screenshots, traces, and reports in ignored or artifact directories unless the user asks to keep them.

4. Verify local apps carefully.
   - Start the app server when required and reuse existing scripts.
   - Wait for the app to be reachable before running tests.
   - Test the user-visible workflow rather than only checking for a non-error page load.

## Commands

Common commands, adapted to the repo package manager:

```bash
pnpm exec playwright test
pnpm exec playwright test tests/example.spec.ts --project=chromium
pnpm exec playwright test --headed
pnpm exec playwright test --debug
pnpm exec playwright show-report
pnpm exec playwright show-trace path/to/trace.zip
```

For a quick page smoke test with this plugin's helper script:

```bash
node ./plugins/playwright/scripts/playwright-smoke.mjs http://localhost:3000 --screenshot ./.codex-artifacts/playwright-smoke.png
```

## Test Style

- Use role, label, placeholder, and text locators before brittle CSS selectors.
- Assert meaningful UI state with `expect`, not only that navigation completed.
- Keep waits event-based: prefer locator assertions, `waitForURL`, and network or load-state waits over fixed sleeps.
- Use `test.step` for multi-action flows that will need readable traces.
- Store repeated setup in fixtures or helpers when at least two specs need it.

## Safety

- Do not automate destructive production actions unless the user explicitly asks and confirms the target environment.
- Do not commit Playwright report output, screenshots, videos, traces, or downloaded browser binaries unless they are intentional fixtures.
- Avoid adding broad end-to-end coverage when a narrow regression test proves the requested behavior.
