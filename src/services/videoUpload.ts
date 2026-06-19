/**
 * Video Upload Service - Gemini Files API Integration
 * Enables native video analysis with full temporal understanding
 */

import { logger } from '@/lib/logger'
import { safeParseResponse } from '@/lib/safeJson'

interface GeminiFile {
  name: string // Format: files/{fileId}
  displayName: string
  mimeType: string
  sizeBytes: string
  createTime: string
  updateTime: string
  expirationTime: string
  sha256Hash: string
  uri: string
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED'
  error?: {
    code: number
    message: string
  }
}

interface VideoUploadOptions {
  displayName?: string
  maxRetries?: number
  pollIntervalMs?: number
}

/**
 * Upload video to Gemini Files API for native video analysis
 * Supports videos up to 2GB
 */
export async function uploadVideoToGemini(
  videoBlob: Blob,
  options: VideoUploadOptions = {}
): Promise<GeminiFile> {
  const {
    displayName = 'fight_video.mp4',
    maxRetries = 3,
    pollIntervalMs = 2000
  } = options

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  // Step 1: Initiate resumable upload
  const uploadUrl = await initiateResumableUpload(geminiKey, videoBlob, displayName)
  
  // Step 2: Upload video chunks
  await uploadVideoChunks(uploadUrl, videoBlob)
  
  // Step 3: Get file info and wait for processing
  const fileInfo = await getFileInfo(uploadUrl, geminiKey)
  
  // Step 4: Poll until video is processed
  const processedFile = await waitForProcessing(fileInfo.name, geminiKey, {
    maxRetries,
    pollIntervalMs
  })

  logger.info('Video uploaded to Gemini', {
    fileId: processedFile.name,
    size: processedFile.sizeBytes,
    state: processedFile.state
  })

  return processedFile
}

/**
 * Initiate resumable upload session
 */
async function initiateResumableUpload(
  apiKey: string,
  blob: Blob,
  displayName: string
): Promise<string> {
  const metadata = {
    file: {
      display_name: displayName
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': blob.size.toString(),
        'X-Goog-Upload-Header-Content-Type': blob.type || 'video/mp4',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to initiate upload: ${error}`)
  }

  const uploadUrl = response.headers.get('X-Goog-Upload-URL')
  if (!uploadUrl) {
    throw new Error('No upload URL returned')
  }

  return uploadUrl
}

/**
 * Upload video in chunks using resumable upload
 */
async function uploadVideoChunks(uploadUrl: string, blob: Blob): Promise<void> {
  const chunkSize = 10 * 1024 * 1024 // 10MB chunks
  let offset = 0

  while (offset < blob.size) {
    const chunk = blob.slice(offset, offset + chunkSize)
    const isLastChunk = offset + chunkSize >= blob.size

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': chunk.size.toString(),
        'X-Goog-Upload-Offset': offset.toString(),
        'X-Goog-Upload-Command': isLastChunk ? 'upload, finalize' : 'upload'
      },
      body: chunk
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Upload chunk failed at offset ${offset}: ${error}`)
    }

    offset += chunk.size

    // Log progress
    const progress = Math.round((offset / blob.size) * 100)
    logger.debug('Upload progress', { progress, offset, total: blob.size })
  }
}

/**
 * Get file information after upload
 */
async function getFileInfo(uploadUrl: string, apiKey: string): Promise<GeminiFile> {
  const response = await fetch(uploadUrl, {
    method: 'GET',
    headers: {
      'X-Goog-Upload-Command': 'query'
    }
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get file info: ${error}`)
  }

  const data = await response.json() as { file: GeminiFile }
  return data.file
}

/**
 * Wait for video to be processed by Gemini
 */
async function waitForProcessing(
  fileName: string,
  apiKey: string,
  options: { maxRetries: number; pollIntervalMs: number }
): Promise<GeminiFile> {
  const { maxRetries, pollIntervalMs } = options
  let retries = 0

  while (retries < maxRetries) {
    const file = await checkFileStatus(fileName, apiKey)

    if (file.state === 'ACTIVE') {
      return file
    }

    if (file.state === 'FAILED') {
      throw new Error(`Video processing failed: ${file.error?.message}`)
    }

    // Still processing, wait and retry
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    retries++
  }

  throw new Error('Video processing timeout')
}

/**
 * Check file processing status
 */
async function checkFileStatus(fileName: string, apiKey: string): Promise<GeminiFile> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
    { method: 'GET' }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to check status: ${error}`)
  }

  return await safeParseResponse(response) as GeminiFile
}

/**
 * Delete uploaded file from Gemini
 * Call this after analysis to clean up
 */
export async function deleteGeminiFile(fileName: string): Promise<void> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${geminiKey}`,
    { method: 'DELETE' }
  )

  if (!response.ok) {
    const error = await response.text()
    logger.warn('Failed to delete Gemini file', { fileName, error })
  } else {
    logger.info('Deleted Gemini file', { fileName })
  }
}

/**
 * List all uploaded files
 */
export async function listGeminiFiles(): Promise<GeminiFile[]> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/files?key=${geminiKey}`,
    { method: 'GET' }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to list files: ${error}`)
  }

  const data = await safeParseResponse(response) as { files?: GeminiFile[] }
  return data.files || []
}

/**
 * Clean up old files (older than 24 hours)
 */
export async function cleanupOldFiles(): Promise<number> {
  const files = await listGeminiFiles()
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  let deletedCount = 0

  for (const file of files) {
    const createTime = new Date(file.createTime)
    if (createTime < oneDayAgo) {
      try {
        await deleteGeminiFile(file.name)
        deletedCount++
      } catch (error) {
        logger.warn('Failed to delete old file', { 
          fileName: file.name, 
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  logger.info('Cleanup completed', { deletedCount, totalFiles: files.length })
  return deletedCount
}
