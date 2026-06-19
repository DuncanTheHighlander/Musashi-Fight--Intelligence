/**
 * Adaptive hardware profile — detects device capability at boot and picks
 * a tier so the skeleton "sizzle" always renders smoothly, even on thin
 * ultrabooks with shared-memory iGPUs (e.g. ASUS Zenbook 14 / Intel Arc).
 *
 * Three tiers:
 *   lite    — throttled pose cadence, no heavy WASM.
 *             Target: ~16GB RAM laptops with integrated graphics.
 *   balanced — default for most modern laptops with real GPUs.
 *   max     — workstations with discrete GPU + 32GB+ RAM. Full pipeline.
 *
 * These tiers feed:
 *   - pose detection cadence (ms between ticks)
 *   - whether GPU delegate is tried for MediaPipe
 *   - retry-landmarker max rate
 *   - video resolution cap for pose detection
 */

export type PerformanceTier = 'lite' | 'balanced' | 'max'

export interface PerformanceProfile {
  tier: PerformanceTier
  poseIntervalMs: number
  tryGpuDelegate: boolean
  cropRetryMinIntervalMs: number
  /**
   * Minimum interval between per-fighter crop-zoom refinements (ms).
   * Refinement re-runs pose detection on a zoomed crop around each fighter so
   * MediaPipe sees ~4x the pixels per body — dramatically tighter landmarks
   * (hands/feet stick to the body). 0 disables refinement for the tier.
   */
  refineMinIntervalMs: number
  maxPoseResolution: number // px, longest side for pose detection
  reason: string
  rawSignals: {
    deviceMemoryGb: number | null
    hardwareConcurrency: number
    webGPU: boolean
    userAgentMentions: string[]
  }
}

/**
 * SSR-safe default profile. Exported so client components can use the *exact
 * same* object during the server render and the first client render — that's
 * the only way to avoid a React hydration mismatch when the real device probe
 * (GPU/RAM/cores) later upgrades the tier on the client.
 */
export const SERVER_DEFAULT_PROFILE: PerformanceProfile = {
  tier: 'balanced',
  poseIntervalMs: 75,
  tryGpuDelegate: true,
  cropRetryMinIntervalMs: 300,
  refineMinIntervalMs: 120,
  maxPoseResolution: 1280,
  reason: 'server-default',
  rawSignals: {
    deviceMemoryGb: null,
    hardwareConcurrency: 4,
    webGPU: false,
    userAgentMentions: [],
  },
}

const DEFAULT_PROFILE: PerformanceProfile = SERVER_DEFAULT_PROFILE

let cached: PerformanceProfile | null = null

/**
 * Detect the device's performance tier. Called once on first use.
 * Safe on the server (returns a balanced default).
 */
export function getPerformanceProfile(): PerformanceProfile {
  if (cached) return cached
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    cached = DEFAULT_PROFILE
    return cached
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number
    gpu?: unknown
  }
  const mem = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
  const cores = nav.hardwareConcurrency || 4
  const webGPU = typeof nav.gpu !== 'undefined'
  const ua = navigator.userAgent || ''

  // Hardware hints we can read from the UA and GPU report.
  const uaLower = ua.toLowerCase()
  const hints: string[] = []
  if (uaLower.includes('mac')) hints.push('mac')
  if (uaLower.includes('windows nt')) hints.push('windows')
  if (uaLower.includes('arm64')) hints.push('arm64')

  // Try to sniff the GPU vendor via a WebGL debug info call — cheap and
  // reliable across Chrome/Edge/Firefox.
  let gpuVendor = ''
  let gpuRenderer = ''
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null
      if (dbg) {
        gpuVendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '')
        gpuRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
      }
      // Release the probe context immediately so we don't burn one of the
      // ~8-16 context limit.
      const loseCtx = gl.getExtension('WEBGL_lose_context')
      loseCtx?.loseContext()
    }
  } catch {
    /* best effort only */
  }

  const rendererLower = gpuRenderer.toLowerCase()
  const vendorLower = gpuVendor.toLowerCase()
  const isIntegratedGpu =
    rendererLower.includes('intel') ||
    rendererLower.includes('uhd graphics') ||
    rendererLower.includes('iris') ||
    rendererLower.includes('arc(tm) graphics') ||
    rendererLower.includes('radeon graphics') || // AMD APUs
    (rendererLower.includes('apple') && !rendererLower.includes('m3 max') && !rendererLower.includes('m2 max'))
  const isDiscreteGpu =
    rendererLower.includes('geforce') ||
    rendererLower.includes('rtx') ||
    rendererLower.includes('radeon rx') ||
    rendererLower.includes('radeon pro')

  if (gpuRenderer) hints.push(`gpu=${gpuRenderer.slice(0, 60)}`)
  if (gpuVendor) hints.push(`vendor=${gpuVendor.slice(0, 30)}`)

  // ── Tier selection ────────────────────────────────────────────────────
  // LITE: thin laptops (≤16GB RAM AND integrated GPU) OR very low core count.
  //   This is the ASUS Zenbook profile — the freeze risk is real.
  // MAX:  workstations with discrete GPU AND 24GB+ RAM AND 12+ cores.
  // BALANCED: everything else.
  const looksLite =
    (mem !== null && mem <= 8) ||
    cores <= 4 ||
    (isIntegratedGpu && (mem === null ? cores <= 8 : mem <= 16))

  const looksMax =
    isDiscreteGpu &&
    cores >= 12 &&
    (mem === null || mem >= 24)

  const tier: PerformanceTier = looksLite ? 'lite' : looksMax ? 'max' : 'balanced'

  const profile: PerformanceProfile = {
    tier,
    // Pose cadence is intentionally aggressive so the skeleton feels attached
    // to the displayed video frame. FightAnalyzer backs off slightly when
    // sustained detection cost gets too high.
    // Effective targets: lite ~21 Hz, balanced ~36 Hz, max ~56 Hz.
    poseIntervalMs: tier === 'lite' ? 48 : tier === 'max' ? 18 : 28,
    tryGpuDelegate: tier !== 'lite', // Lite uses CPU delegate only — no WebGL contention
    cropRetryMinIntervalMs: tier === 'lite' ? 600 : tier === 'max' ? 200 : 300,
    refineMinIntervalMs: tier === 'lite' ? 0 : tier === 'max' ? 60 : 120,
    maxPoseResolution: tier === 'lite' ? 960 : tier === 'max' ? 1920 : 1280,
    reason: looksLite
      ? `lite (mem=${mem ?? '?'}GB, cores=${cores}, integratedGPU=${isIntegratedGpu})`
      : looksMax
        ? `max (discreteGPU, cores=${cores}, mem=${mem ?? '?'}GB)`
        : `balanced (cores=${cores}, mem=${mem ?? '?'}GB)`,
    rawSignals: {
      deviceMemoryGb: mem,
      hardwareConcurrency: cores,
      webGPU,
      userAgentMentions: hints,
    },
  }

  cached = profile
  console.log('[PerfProfile]', profile.tier, '—', profile.reason, {
    poseHz: Math.round(1000 / profile.poseIntervalMs),
    signals: profile.rawSignals,
  })
  return profile
}

/**
 * Per-frame rolling budget check. If the last N pose detections took longer
 * than `budgetMs`, we're bleeding frames — the caller should throttle.
 * Returns true if the system is in "thermal/load trouble" territory.
 */
export class FrameBudget {
  private samples: number[] = []
  private readonly windowSize: number
  private readonly budgetMs: number
  constructor(budgetMs = 100, windowSize = 10) {
    this.budgetMs = budgetMs
    this.windowSize = windowSize
  }
  record(ms: number) {
    this.samples.push(ms)
    if (this.samples.length > this.windowSize) this.samples.shift()
  }
  /** True when the rolling average has exceeded the per-frame budget. */
  overBudget(): boolean {
    if (this.samples.length < this.windowSize) return false
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    return avg > this.budgetMs
  }
  reset() {
    this.samples = []
  }
  averageMs(): number {
    if (!this.samples.length) return 0
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length
  }
}
