/**
 * Secure API Client for External Services
 * 
 * This module provides a centralized, secure way to make external API calls.
 * All API keys and secrets are stored in environment variables only.
 * 
 * SECURITY FEATURES:
 * - API keys never exposed to client-side
 * - Request timeout protection
 * - Error handling with sanitized messages
 * - Request/response logging for debugging (optional)
 */

import { safeParseResponse } from '@/lib/safeJson'
import { readSecretEnv } from '@/lib/env'
import { getServerSecret } from '@/lib/cloudflare/secrets'

export interface ApiClientOptions {
  timeout?: number
  retries?: number
  logRequests?: boolean
}

export interface ApiResponse<T = any> {
  data?: T
  error?: string
  status: number
}

/**
 * Generic secure API client wrapper
 */
export class SecureApiClient {
  private baseUrl: string
  private defaultHeaders: Record<string, string>
  private options: ApiClientOptions

  constructor(
    baseUrl: string,
    apiKey?: string,
    options: ApiClientOptions = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.options = {
      timeout: 30000, // 30 seconds default
      retries: 2,
      logRequests: false,
      ...options
    }

    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'Musashi-Fight-App/1.0'
    }

    if (apiKey) {
      this.defaultHeaders['Authorization'] = `Bearer ${apiKey}`
    }
  }

  private async makeRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse> {
    const url = `${this.baseUrl}${endpoint}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout)

    try {
      if (this.options.logRequests) {
        console.log(`[API] ${options.method || 'GET'} ${url}`)
      }

      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.defaultHeaders,
          ...options.headers,
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      let data
      const contentType = response.headers.get('content-type')
      
      if (contentType?.includes('application/json')) {
        data = await safeParseResponse(response)
      } else {
        data = await response.text()
      }

      if (this.options.logRequests) {
        console.log(`[API] Response ${response.status}:`, data)
      }

      return {
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : this.sanitizeErrorMessage(data),
        status: response.status
      }
    } catch (error) {
      clearTimeout(timeoutId)
      
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          error: 'Request timeout',
          status: 408
        }
      }

      return {
        error: this.sanitizeErrorMessage(error),
        status: 500
      }
    }
  }

  private sanitizeErrorMessage(error: any): string {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      if ('error' in error) {
        const errObj = error.error
        if (typeof errObj === 'string') return errObj
        if (errObj && typeof errObj === 'object' && 'message' in errObj && typeof errObj.message === 'string') {
          return errObj.message
        }
      }
      if ('message' in error && typeof error.message === 'string') return error.message
    }
    return 'Unknown error occurred'
  }

  async get(endpoint: string, params?: Record<string, string>): Promise<ApiResponse> {
    const url = new URL(endpoint, this.baseUrl)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value)
      })
    }

    return this.makeRequest(url.pathname + url.search, { method: 'GET' })
  }

  async post(endpoint: string, data?: any): Promise<ApiResponse> {
    return this.makeRequest(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put(endpoint: string, data?: any): Promise<ApiResponse> {
    return this.makeRequest(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete(endpoint: string): Promise<ApiResponse> {
    return this.makeRequest(endpoint, { method: 'DELETE' })
  }
}

/**
 * Pre-configured API clients for common services
 */

/** Resolve an API key from Secrets Store (production) or `.dev.vars` (local). */
export async function resolveApiClientKey(apiKeyEnvVar?: string): Promise<string | undefined> {
  if (!apiKeyEnvVar) return undefined
  const fromStore = await getServerSecret(apiKeyEnvVar)
  if (fromStore) return fromStore
  return readSecretEnv(apiKeyEnvVar)
}

/** Stripe REST client — resolves key from Secrets Store binding SECRET_STRIPE. */
export async function getStripeClient(): Promise<SecureApiClient> {
  const apiKey = await resolveApiClientKey('STRIPE_SECRET_KEY')
  if (!apiKey) throw new Error('STRIPE_NOT_CONFIGURED')
  return new SecureApiClient('https://api.stripe.com/v1', apiKey, { timeout: 60000 })
}

// OpenAI client (if not using the built-in chat endpoint)
export const openaiClient = new SecureApiClient(
  'https://api.openai.com/v1',
  readSecretEnv('OPENAI_API_KEY')
)

// Gemini client (if not using the built-in chat endpoint)
export const geminiClient = new SecureApiClient(
  'https://generativelanguage.googleapis.com/v1beta',
  undefined, // Gemini uses API key as query parameter
  { timeout: 60000 }
)

// Custom Gemini method with API key in query
export const geminiGenerate = async (model: string, content: any): Promise<ApiResponse> => {
  const apiKey = await getServerSecret('GEMINI_API_KEY')
  if (!apiKey) {
    return { error: 'GEMINI_API_KEY not configured', status: 500 }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  })

  const data = await safeParseResponse(response)
  
  return {
    data: response.ok ? data : undefined,
    error: response.ok ? undefined : (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'message' in data.error && typeof data.error.message === 'string') ? data.error.message : 'Gemini request failed',
    status: response.status
  }
}

// Email service client (e.g., Resend, SendGrid)
export const emailClient = new SecureApiClient(
  process.env.EMAIL_SERVICE_URL || 'https://api.resend.com',
  readSecretEnv('EMAIL_API_KEY')
)

// Storage client (e.g., Cloudflare R2, AWS S3)
export const storageClient = new SecureApiClient(
  process.env.STORAGE_SERVICE_URL || '',
  readSecretEnv('STORAGE_ACCESS_KEY')
)

/**
 * Utility function to create custom API clients
 */
export async function createApiClient(
  serviceName: string,
  baseUrl: string,
  apiKeyEnvVar?: string
): Promise<SecureApiClient> {
  const apiKey = await resolveApiClientKey(apiKeyEnvVar)

  if (!apiKey && apiKeyEnvVar) {
    console.warn(`[API] ${serviceName}: Environment variable ${apiKeyEnvVar} not set`)
  }

  return new SecureApiClient(baseUrl, apiKey, {
    logRequests: process.env.NODE_ENV === 'development'
  })
}
