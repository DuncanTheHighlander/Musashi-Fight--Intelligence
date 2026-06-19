#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

function usage() {
  console.error(
    [
      "Usage: node scripts/playwright-smoke.mjs <url> [--screenshot <path>] [--browser chromium|firefox|webkit]",
      "",
      "Example:",
      "  node scripts/playwright-smoke.mjs http://localhost:3000 --screenshot ./.codex-artifacts/smoke.png",
    ].join("\n"),
  );
}

function readOption(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const url = args.find((arg) => !arg.startsWith("--"));
const screenshotPath = readOption("--screenshot");
const browserName = readOption("--browser", "chromium");

if (!url) {
  usage();
  process.exit(2);
}

if (!["chromium", "firefox", "webkit"].includes(browserName)) {
  console.error(`Unsupported browser "${browserName}". Use chromium, firefox, or webkit.`);
  process.exit(2);
}

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error(
    [
      "Could not import the local Playwright package.",
      "Install it in the current project first, for example:",
      "  npm install -D @playwright/test playwright",
      "  npx playwright install",
    ].join("\n"),
  );
  process.exit(1);
}

const browserType = playwright[browserName];
const browser = await browserType.launch();

try {
  const page = await browser.newPage();
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  const title = await page.title();
  const status = response?.status() ?? "unknown";

  if (screenshotPath) {
    const absoluteScreenshotPath = path.resolve(screenshotPath);
    await mkdir(path.dirname(absoluteScreenshotPath), { recursive: true });
    await page.screenshot({ path: absoluteScreenshotPath, fullPage: true });
    console.log(`screenshot=${absoluteScreenshotPath}`);
  }

  console.log(`url=${url}`);
  console.log(`status=${status}`);
  console.log(`title=${title}`);

  if (typeof status === "number" && status >= 400) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
