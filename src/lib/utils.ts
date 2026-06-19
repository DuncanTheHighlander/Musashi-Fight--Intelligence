import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Retry dynamic import on ChunkLoadError (common when dev server rebuilds or chunk paths change) */
export async function retryDynamicImport<T>(
  importFn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await importFn()
    } catch (err) {
      lastErr = err
      const isChunkError =
        err instanceof Error &&
        (err.name === 'ChunkLoadError' ||
          err.message?.includes('Loading chunk') ||
          err.message?.includes('Loading CSS chunk'))
      if (!isChunkError || i === maxRetries - 1) throw err
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw lastErr
}
