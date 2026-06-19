/**
 * Musashi Logger - Production-ready logging utility
 * Replaces console.log with structured logging
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: Record<string, any>
  error?: Error
}

function toSafeConsoleValue(value: unknown): unknown {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  if (Array.isArray(value)) {
    return `[array:${value.length}]`
  }

  if (typeof value === 'object') {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name || 'Object'
    return `[object ${ctor}]`
  }

  return String(value)
}

class MusashiLogger {
  private isDevelopment: boolean

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development'
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      error
    }

    // In development, use console
    if (this.isDevelopment) {
      const prefix = `[${level.toUpperCase()}] ${entry.timestamp}`
      const safeContext = toSafeConsoleValue(context)
      const safeError = toSafeConsoleValue(error)
      
      switch (level) {
        case 'error':
          console.error(prefix, message, safeContext, safeError)
          break
        case 'warn':
          console.warn(prefix, message, safeContext)
          break
        case 'debug':
          console.debug(prefix, message, safeContext)
          break
        default:
          console.log(prefix, message, safeContext)
      }
      return
    }

    // In production, send to Cloudflare Logs or external service
    // For now, only log errors and warnings in production
    if (level === 'error' || level === 'warn') {
      console.error(JSON.stringify({
        ...entry,
        context: toSafeConsoleValue(entry.context),
        error: toSafeConsoleValue(entry.error),
      }))
    }

    // Future: Send to external logging service (Sentry, LogFlare, etc.)
    // this.sendToExternalService(entry)
  }

  debug(message: string, context?: Record<string, any>) {
    this.log('debug', message, context)
  }

  info(message: string, context?: Record<string, any>) {
    this.log('info', message, context)
  }

  warn(message: string, context?: Record<string, any>) {
    this.log('warn', message, context)
  }

  error(message: string, context?: Record<string, any>, error?: Error) {
    this.log('error', message, context, error)
  }

  // Specialized loggers for common scenarios
  apiRequest(endpoint: string, method: string, context?: Record<string, any>) {
    this.info(`API Request: ${method} ${endpoint}`, context)
  }

  apiError(endpoint: string, error: Error, context?: Record<string, any>) {
    this.error(`API Error: ${endpoint}`, context, error)
  }

  aiRequest(model: string, action: string, context?: Record<string, any>) {
    this.info(`AI Request: ${action} using ${model}`, context)
  }

  performance(label: string, durationMs: number, context?: Record<string, any>) {
    this.info(`Performance: ${label}`, { ...context, durationMs })
  }
}

// Singleton instance
export const logger = new MusashiLogger()

// Convenience exports
export const logDebug = logger.debug.bind(logger)
export const logInfo = logger.info.bind(logger)
export const logWarn = logger.warn.bind(logger)
export const logError = logger.error.bind(logger)
