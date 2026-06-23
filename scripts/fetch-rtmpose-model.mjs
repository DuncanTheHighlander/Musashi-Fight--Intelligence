#!/usr/bin/env node
/**
 * Download RTMPose Halpe-26 ONNX into public/models/ for local RTM testing.
 *
 *   pnpm fetch:rtm-model
 *
 * Then test in browser:
 *   http://localhost:3000/?fixtureVideo=/test-videos/test-video-for-app.mp4&poseBackend=rtmpose&qaLoop=1
 *
 * Requires network. If the default URL fails, export your own model per RTMPOSE_SETUP.md.
 */
import { mkdirSync, existsSync, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'public/models')
const outPath = join(outDir, 'rtmpose-halpe26.onnx')

/** Community exports — swap if a link 404s; verify with Netron after download. */
const CANDIDATE_URLS = [
  process.env.RTMPOSE_ONNX_URL,
  'https://huggingface.co/public-data/insightface/resolve/main/models/rtmpose/rtmpose-m_simcc-body7_pt-aic-coco_420e-256x192.onnx',
].filter(Boolean)

async function download(url) {
  console.log(`Fetching ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  mkdirSync(outDir, { recursive: true })
  await pipeline(res.body, createWriteStream(outPath))
  const { size } = await import('fs/promises').then((fs) => fs.stat(outPath))
  console.log(`Saved ${outPath} (${(size / 1e6).toFixed(1)} MB)`)
  if (size < 1_000_000) throw new Error('File too small — likely not a valid ONNX model')
}

async function main() {
  if (existsSync(outPath)) {
    console.log(`Already present: ${outPath}`)
    console.log('Delete it to re-download, or set RTMPOSE_ONNX_URL to a Halpe-26 export.')
    return
  }
  let lastErr
  for (const url of CANDIDATE_URLS) {
    try {
      await download(url)
      console.log('\nNext: open app with ?poseBackend=rtmpose and run pnpm test:loop')
      return
    } catch (e) {
      lastErr = e
      console.warn(`  failed: ${e.message}`)
    }
  }
  console.error('\nCould not download RTMPose ONNX automatically.')
  console.error('Manual: export Halpe-26 RTMPose-m to ONNX and place at public/models/rtmpose-halpe26.onnx')
  console.error('See RTMPOSE_SETUP.md')
  process.exit(1)
}

main()
