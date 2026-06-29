/**
 * Generic External API Proxy Route
 * 
 * This is a secure proxy for external API calls that need to be made from the client.
 * It prevents exposing API keys to the browser and adds rate limiting.
 * 
 * Usage: POST /api/external/stripe/create-payment-intent
 *        POST /api/external/email/send
 *        GET /api/external/storage/upload-url
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/musashiAuth'
import { createApiClient, resolveApiClientKey } from '@/lib/apiClient'

// Rate limiting storage (in production, use Redis or database)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

const RATE_LIMITS = {
  default: { requests: 100, windowMs: 60 * 1000 }, // 100 requests per minute
  stripe: { requests: 50, windowMs: 60 * 1000 }, // 50 requests per minute
  email: { requests: 10, windowMs: 60 * 1000 }, // 10 emails per minute
}

function getRateLimit(service: string) {
  return RATE_LIMITS[service as keyof typeof RATE_LIMITS] || RATE_LIMITS.default
}

function checkRateLimit(userId: string, service: string): boolean {
  const limit = getRateLimit(service)
  const key = `${userId}:${service}`
  const now = Date.now()
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + limit.windowMs })
    return true
  }

  if (record.count >= limit.requests) {
    return false
  }

  record.count++
  return true
}

// Service configurations with explicit endpoint allowlists to prevent SSRF
const SERVICE_CONFIGS = {
  stripe: {
    baseUrl: 'https://api.stripe.com/v1',
    apiKeyEnv: 'STRIPE_SECRET_KEY',
    timeout: 60000,
    allowedEndpoints: ['/payment_intents', '/checkout/sessions', '/customers'],
  },
  email: {
    baseUrl: process.env.EMAIL_SERVICE_URL || 'https://api.resend.com',
    apiKeyEnv: 'EMAIL_API_KEY',
    timeout: 30000,
    allowedEndpoints: ['/emails'],
  },
  storage: {
    baseUrl: process.env.STORAGE_SERVICE_URL || '',
    apiKeyEnv: 'STORAGE_ACCESS_KEY',
    timeout: 30000,
    allowedEndpoints: ['/upload-url', '/signed-url'],
  },
  twilio: {
    baseUrl: 'https://api.twilio.com/2010-04-01/Accounts',
    apiKeyEnv: 'TWILIO_AUTH_TOKEN',
    timeout: 30000,
    allowedEndpoints: ['/Messages.json'],
  },
}

function isEndpointAllowed(service: keyof typeof SERVICE_CONFIGS, endpoint: string): boolean {
  const config = SERVICE_CONFIGS[service]
  if (!config?.allowedEndpoints) return false
  return config.allowedEndpoints.some(
    (allowed) => endpoint === allowed || endpoint.startsWith(allowed + '/')
  )
}

type RouteContext = {
  params: Promise<{ slug: string[] }>
}

export async function POST(
  req: NextRequest,
  context: RouteContext
) {
  try {
    // Authenticate user
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug } = await context.params
    const [service, ...endpointParts] = slug
    const endpoint = '/' + endpointParts.join('/')

    // Validate service
    const serviceKey = service as keyof typeof SERVICE_CONFIGS
    const config = SERVICE_CONFIGS[serviceKey]
    if (!config) {
      return NextResponse.json({ error: 'Unknown service' }, { status: 400 })
    }

    // Validate endpoint against allowlist
    if (!isEndpointAllowed(serviceKey, endpoint)) {
      return NextResponse.json({ error: 'Endpoint not allowed' }, { status: 403 })
    }

    // Check rate limiting
    if (!checkRateLimit(user.id, service)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    // Get API key (Secrets Store in production, .dev.vars locally)
    const apiKey = config.apiKeyEnv ? await resolveApiClientKey(config.apiKeyEnv) : undefined
    if (!apiKey && config.apiKeyEnv) {
      return NextResponse.json({ error: 'Service not configured' }, { status: 500 })
    }

    // Create client and make request
    const client = await createApiClient(service, config.baseUrl, config.apiKeyEnv)
    
    const body = req.body ? await req.json() : undefined
    const response = await client.post(endpoint, body)

    // Log activity
    console.log(`[External API] ${user.id} -> ${service}${endpoint} (${response.status})`)

    return NextResponse.json(response.data, { status: response.status })
  } catch (error) {
    console.error('[External API Error]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(
  req: NextRequest,
  context: RouteContext
) {
  try {
    // Authenticate user
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug } = await context.params
    const [service, ...endpointParts] = slug
    const endpoint = '/' + endpointParts.join('/')

    // Validate service
    const serviceKey = service as keyof typeof SERVICE_CONFIGS
    const config = SERVICE_CONFIGS[serviceKey]
    if (!config) {
      return NextResponse.json({ error: 'Unknown service' }, { status: 400 })
    }

    // Validate endpoint against allowlist
    if (!isEndpointAllowed(serviceKey, endpoint)) {
      return NextResponse.json({ error: 'Endpoint not allowed' }, { status: 403 })
    }

    // Check rate limiting
    if (!checkRateLimit(user.id, service)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    // Get API key (Secrets Store in production, .dev.vars locally)
    const apiKey = config.apiKeyEnv ? await resolveApiClientKey(config.apiKeyEnv) : undefined
    if (!apiKey && config.apiKeyEnv) {
      return NextResponse.json({ error: 'Service not configured' }, { status: 500 })
    }

    // Create client and make request
    const client = await createApiClient(service, config.baseUrl, config.apiKeyEnv)
    
    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams)
    const response = await client.get(endpoint, queryParams)

    // Log activity
    console.log(`[External API] ${user.id} -> ${service}${endpoint} (${response.status})`)

    return NextResponse.json(response.data, { status: response.status })
  } catch (error) {
    console.error('[External API Error]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
