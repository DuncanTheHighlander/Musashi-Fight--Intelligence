/**
 * Detection for the Capacitor native shells (mobile/). Capacitor injects a
 * `window.Capacitor` bridge into the WebView even when loading a remote URL,
 * which is how the web app knows it is running inside the Android/iOS app.
 *
 * Used for App Store compliance: Apple Guideline 3.1.1 forbids selling digital
 * subscriptions via external checkout (Stripe) inside the iOS app, so purchase
 * UI is hidden there. Marketplace coach services are exempt (real-world
 * services, 3.1.5) and are NOT gated.
 */

type CapacitorGlobal = { getPlatform?: () => string }

export const getNativePlatform = (): 'ios' | 'android' | null => {
  if (typeof window === 'undefined') return null
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
  const platform = cap?.getPlatform?.()
  return platform === 'ios' || platform === 'android' ? platform : null
}

export const isIosNativeApp = (): boolean => getNativePlatform() === 'ios'
