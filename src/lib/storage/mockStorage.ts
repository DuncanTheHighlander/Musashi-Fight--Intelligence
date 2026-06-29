/**
 * Local filesystem storage for dev/mock mode.
 * Files land in .uploads/ (gitignored). Never used in production R2 mode.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const UPLOAD_ROOT = join(process.cwd(), '.uploads')

function objectPath(objectKey: string): string {
  const safe = objectKey.replace(/[^a-zA-Z0-9/_.-]/g, '_')
  const full = join(UPLOAD_ROOT, safe)
  if (!full.startsWith(UPLOAD_ROOT)) throw new Error('Invalid object key')
  return full
}

export function writeMockObject(objectKey: string, data: Buffer | Uint8Array): void {
  const path = objectPath(objectKey)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
}

export function readMockObject(objectKey: string): Buffer {
  const path = objectPath(objectKey)
  if (!existsSync(path)) throw new Error('OBJECT_NOT_FOUND')
  return readFileSync(path)
}

export function mockObjectExists(objectKey: string): boolean {
  return existsSync(objectPath(objectKey))
}

export function mockObjectSize(objectKey: string): number {
  const path = objectPath(objectKey)
  if (!existsSync(path)) return 0
  return statSync(path).size
}
