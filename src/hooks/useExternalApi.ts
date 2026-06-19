/**
 * React Hook for External API Calls
 * 
 * Provides a secure way to call external APIs from the client
 * through the proxy endpoint without exposing API keys.
 */

import { useState, useCallback } from 'react'
import { parseApiResponse } from '@/lib/safeJson'

export interface ExternalApiResponse<T = any> {
  data?: T
  error?: string
  loading: boolean
  status?: number
}

export interface UseExternalApiOptions {
  onSuccess?: (data: any) => void
  onError?: (error: string) => void
}

export function useExternalApi<T = any>(options: UseExternalApiOptions = {}) {
  const { onSuccess, onError } = options
  const [state, setState] = useState<ExternalApiResponse<T>>({
    loading: false,
  })

  const callApi = useCallback(async (
    service: string,
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
    data?: any,
    params?: Record<string, string>
  ): Promise<ExternalApiResponse<T>> => {
    setState({ loading: true })

    try {
      const url = new URL(`/api/external/${service}${endpoint}`, window.location.origin)
      
      // Add query parameters for GET requests
      if (method === 'GET' && params) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.append(key, value)
        })
      }

      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: method !== 'GET' ? JSON.stringify(data) : undefined,
        credentials: 'same-origin', // Include cookies for authentication
      })

      const result = await parseApiResponse(response) as any

      const newState: ExternalApiResponse<T> = {
        data: response.ok ? result as T : undefined,
        error: response.ok ? undefined : result?.error || 'Request failed',
        loading: false,
        status: response.status,
      }

      setState(newState)

      if (response.ok && onSuccess) {
        onSuccess(result)
      }

      if (!response.ok && onError) {
        onError(newState.error!)
      }

      return newState
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Network error'
      const newState: ExternalApiResponse<T> = {
        error: errorMessage,
        loading: false,
        status: 500,
      }

      setState(newState)

      if (onError) {
        onError(errorMessage)
      }

      return newState
    }
  }, [onError, onSuccess])

  const get = useCallback((service: string, endpoint: string, params?: Record<string, string>) => {
    return callApi(service, endpoint, 'GET', undefined, params)
  }, [callApi])

  const post = useCallback((service: string, endpoint: string, data?: any) => {
    return callApi(service, endpoint, 'POST', data)
  }, [callApi])

  const put = useCallback((service: string, endpoint: string, data?: any) => {
    return callApi(service, endpoint, 'PUT', data)
  }, [callApi])

  const del = useCallback((service: string, endpoint: string) => {
    return callApi(service, endpoint, 'DELETE')
  }, [callApi])

  const reset = useCallback(() => {
    setState({ loading: false })
  }, [])

  return {
    ...state,
    callApi,
    get,
    post,
    put,
    delete: del,
    reset,
  }
}

/**
 * Pre-configured hooks for common services
 */

export function useStripeApi() {
  const api = useExternalApi()
  
  return {
    ...api,
    createPaymentIntent: (amount: number, currency: string = 'usd', customerId?: string) =>
      api.post('stripe', '/payment_intents', {
        amount,
        currency,
        customer: customerId,
      }),
    
    createCustomer: (email: string, name?: string) =>
      api.post('stripe', '/customers', {
        email,
        name,
      }),
    
    retrievePaymentIntent: (paymentIntentId: string) =>
      api.get('stripe', `/payment_intents/${paymentIntentId}`),
  }
}

export function useEmailApi() {
  const api = useExternalApi()
  
  return {
    ...api,
    sendEmail: (to: string, subject: string, html: string, from?: string) =>
      api.post('email', '/emails', {
        from: from || 'noreply@musashi.ai',
        to,
        subject,
        html,
      }),
  }
}

export function useStorageApi() {
  const api = useExternalApi()
  
  return {
    ...api,
    getUploadUrl: (filename: string, contentType: string) =>
      api.post('storage', '/upload-url', {
        filename,
        contentType,
      }),
    
    deleteFile: (key: string) =>
      api.delete('storage', `/files/${key}`),
  }
}
