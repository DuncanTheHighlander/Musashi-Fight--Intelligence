/**
 * Cloudflare R2 (S3-compatible) presigned URL helpers.
 * When STORAGE_* env vars are missing, callers should use mock storage instead.
 */

export type StorageMode = 'mock' | 'r2'

export type StorageConfig = {
  mode: 'r2'
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
  region: string
}

export type SignedR2Url = {
  url: string
  method: 'PUT' | 'GET'
  headers: Record<string, string>
  expiresAt: string
}

const DEFAULT_UPLOAD_TTL_SEC = 15 * 60
const DEFAULT_READ_TTL_SEC = 10 * 60

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const sha256Hex = async (data: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(digest)
}

const hmacSha256 = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
  const raw = key instanceof Uint8Array ? new Uint8Array(key) : new Uint8Array(key)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

const getSignatureKey = async (
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> => {
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`), dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

const amzDates = (now = new Date()): { amzDate: string; dateStamp: string } => {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

const parseEndpoint = (endpoint: string, bucket: string): { host: string; basePath: string } => {
  const url = new URL(endpoint)
  const host = url.host
  const basePath = url.pathname.replace(/\/$/, '')
  // Path-style: https://account.r2.cloudflarestorage.com/bucket/key
  return { host, basePath: `${basePath}/${bucket}`.replace(/\/+/g, '/') }
}

export function resolveStorageMode(): StorageMode {
  const forced = String(process.env.MUSASHI_STORAGE_MODE || '').toLowerCase()
  const hasR2 =
    Boolean(process.env.STORAGE_SERVICE_URL?.trim()) &&
    Boolean(process.env.STORAGE_ACCESS_KEY?.trim()) &&
    Boolean(process.env.STORAGE_SECRET_KEY?.trim()) &&
    Boolean(process.env.STORAGE_BUCKET_NAME?.trim())
  if (forced === 'mock') return 'mock'
  if (forced === 'r2') {
    if (hasR2) return 'r2'
    if (process.env.NODE_ENV === 'production') return 'r2'
    return 'mock'
  }
  return hasR2 ? 'r2' : 'mock'
}

export function assertStorageConfigured(): StorageConfig {
  const endpoint = String(process.env.STORAGE_SERVICE_URL || '').trim()
  const accessKey = String(process.env.STORAGE_ACCESS_KEY || '').trim()
  const secretKey = String(process.env.STORAGE_SECRET_KEY || '').trim()
  const bucket = String(process.env.STORAGE_BUCKET_NAME || '').trim()
  if (!endpoint || !accessKey || !secretKey || !bucket) {
    throw new Error('STORAGE_NOT_CONFIGURED')
  }
  return {
    mode: 'r2',
    endpoint,
    accessKey,
    secretKey,
    bucket,
    region: 'auto',
  }
}

async function presignUrl(args: {
  config: StorageConfig
  method: 'PUT' | 'GET'
  objectKey: string
  contentType?: string
  expiresSeconds: number
}): Promise<SignedR2Url> {
  const { config, method, objectKey, contentType, expiresSeconds } = args
  const { host, basePath } = parseEndpoint(config.endpoint, config.bucket)
  const canonicalUri = `${basePath}/${objectKey.split('/').map(encodeRfc3986).join('/')}`
  const { amzDate, dateStamp } = amzDates()
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const credential = `${config.accessKey}/${credentialScope}`

  const signedHeaders =
    method === 'PUT' && contentType
      ? 'content-type;host'
      : 'host'
  const headerList =
    method === 'PUT' && contentType
      ? `content-type:${contentType}\nhost:${host}\n`
      : `host:${host}\n`

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  }

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k])}`)
    .join('&')

  const payloadHash = method === 'PUT' ? 'UNSIGNED-PAYLOAD' : await sha256Hex('')
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    headerList,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = await getSignatureKey(config.secretKey, dateStamp, config.region, 's3')
  const signature = toHex(await hmacSha256(signingKey, stringToSign))

  const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
  const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString()

  const headers: Record<string, string> = {}
  if (method === 'PUT' && contentType) headers['Content-Type'] = contentType

  return { url, method, headers, expiresAt }
}

export async function createSignedUploadUrl(args: {
  key: string
  contentType: string
  expiresSeconds?: number
}): Promise<SignedR2Url> {
  const config = assertStorageConfigured()
  return presignUrl({
    config,
    method: 'PUT',
    objectKey: args.key,
    contentType: args.contentType,
    expiresSeconds: args.expiresSeconds ?? DEFAULT_UPLOAD_TTL_SEC,
  })
}

export async function createSignedReadUrl(args: {
  key: string
  expiresSeconds?: number
}): Promise<string> {
  const config = assertStorageConfigured()
  const signed = await presignUrl({
    config,
    method: 'GET',
    objectKey: args.key,
    expiresSeconds: args.expiresSeconds ?? DEFAULT_READ_TTL_SEC,
  })
  return signed.url
}
