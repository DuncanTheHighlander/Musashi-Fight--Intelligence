#!/usr/bin/env node
/**
 * Release gate for Capacitor mobile shells.
 * Fails if store-bound config is unsafe or drifted.
 *
 * Usage: node scripts/check-mobile-release.mjs
 *        node scripts/check-mobile-release.mjs --allow-dev-cleartext  (LAN testing only)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const allowDevCleartext = process.argv.includes('--allow-dev-cleartext')
const errors = []
const warnings = []

const EXPECTED_APP_ID = 'ai.musashi.app'
const PLACEHOLDER_RE = /YOUR_|your-subdomain|localhost|127\.0\.0\.1|example\.com/i

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function checkCapacitorConfig() {
  const path = join(root, 'mobile', 'capacitor.config.json')
  if (!existsSync(path)) {
    errors.push('Missing mobile/capacitor.config.json — use the canonical Musashi repo mobile/ tree')
    return null
  }
  const cfg = readJson(path)
  if (cfg.appId !== EXPECTED_APP_ID) {
    errors.push(`appId must be "${EXPECTED_APP_ID}" (found "${cfg.appId}")`)
  }
  if (cfg.appName !== 'Musashi') {
    warnings.push(`appName is "${cfg.appName}" (expected "Musashi")`)
  }
  const server = cfg.server || {}
  const url = String(server.url || '')
  if (!url) {
    errors.push('server.url is empty — set the production HTTPS URL before store builds')
  } else {
    if (PLACEHOLDER_RE.test(url)) {
      errors.push(`server.url looks like a placeholder or local URL: ${url}`)
    }
    if (!url.startsWith('https://') && !(allowDevCleartext && url.startsWith('http://'))) {
      errors.push(`server.url must be https:// for release (found ${url})`)
    }
  }
  if (server.cleartext === true && !allowDevCleartext) {
    errors.push('server.cleartext is true — never ship cleartext to Play/App Store (use --allow-dev-cleartext for LAN only)')
  }
  if (server.androidScheme === 'http' && !allowDevCleartext) {
    errors.push('server.androidScheme is http — use https for release builds')
  }
  return cfg
}

function checkAndroidManifest() {
  const path = join(root, 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
  if (!existsSync(path)) {
    warnings.push('mobile/android/.../AndroidManifest.xml missing — run cap add android')
    return
  }
  const xml = readFileSync(path, 'utf8')
  if (/android:allowBackup\s*=\s*"true"/i.test(xml)) {
    errors.push('AndroidManifest allowBackup="true" — set allowBackup="false" for store releases')
  }
  if (!/android.permission.INTERNET/.test(xml)) {
    errors.push('AndroidManifest missing INTERNET permission')
  }
  if (!/android.permission.CAMERA/.test(xml)) {
    warnings.push('AndroidManifest missing CAMERA permission — live pose will fail until added')
  }
  if (!/android.permission.READ_MEDIA_VIDEO/.test(xml)) {
    warnings.push('AndroidManifest missing READ_MEDIA_VIDEO — gallery picks on API 33+ may fail')
  }
  const gradlePath = join(root, 'mobile', 'android', 'app', 'build.gradle')
  if (existsSync(gradlePath)) {
    const gradle = readFileSync(gradlePath, 'utf8')
    const idMatch = gradle.match(/applicationId\s+"([^"]+)"/)
    if (idMatch && idMatch[1] !== EXPECTED_APP_ID) {
      errors.push(`android applicationId must be "${EXPECTED_APP_ID}" (found "${idMatch[1]}")`)
    }
  }
}

function checkIosInfoPlist() {
  const path = join(root, 'mobile', 'ios', 'App', 'App', 'Info.plist')
  if (!existsSync(path)) {
    warnings.push('iOS Info.plist missing — iOS archive requires mobile/ios on a Mac')
    return
  }
  const plist = readFileSync(path, 'utf8')
  for (const key of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    if (!plist.includes(key)) {
      errors.push(`Info.plist missing ${key}`)
    }
  }
  const privacy = join(root, 'mobile', 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy')
  if (!existsSync(privacy)) {
    warnings.push('PrivacyInfo.xcprivacy missing — add before App Store submit')
  }
}

function checkSyncedCapConfig() {
  const synced = join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json')
  if (!existsSync(synced)) return
  const cfg = readJson(synced)
  if (cfg.appId && cfg.appId !== EXPECTED_APP_ID) {
    errors.push(`Synced android assets capacitor.config.json appId is "${cfg.appId}" — run pnpm mobile:sync after fixing`)
  }
  if (cfg.server?.cleartext === true && !allowDevCleartext) {
    errors.push('Synced android capacitor.config.json has cleartext:true — run pnpm mobile:sync after fixing mobile/capacitor.config.json')
  }
}

const cfg = checkCapacitorConfig()
checkAndroidManifest()
checkIosInfoPlist()
checkSyncedCapConfig()

if (cfg?.server?.url) {
  console.log(`Mobile release check — appId=${cfg.appId} url=${cfg.server.url}`)
}

for (const w of warnings) console.warn(`WARN: ${w}`)
for (const e of errors) console.error(`ERROR: ${e}`)

if (errors.length) {
  console.error(`\ncheck:mobile-release failed (${errors.length} error(s)). See docs/superpowers/specs/2026-07-09-mobile-store-gaps.md`)
  process.exit(1)
}

console.log('check:mobile-release OK')
