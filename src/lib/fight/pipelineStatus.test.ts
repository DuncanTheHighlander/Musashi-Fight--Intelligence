import { describe, expect, it } from 'vitest'
import {
  classifyFailure,
  failureKindFromIngestionCode,
  failureMessage,
  PIPELINE_STAGE_ORDER,
  stageLabel,
} from '@/lib/fight/pipelineStatus'

describe('pipelineStatus', () => {
  it('exposes the five canonical stages in order', () => {
    expect(PIPELINE_STAGE_ORDER).toEqual([
      'uploading',
      'preparing_video',
      'watching',
      'building_coaching',
      'ready',
    ])
    expect(stageLabel('watching')).toBe('Watching the fight…')
    expect(stageLabel('ready')).toBe('Ready')
  })

  it('NEVER classifies a network drop as a content failure', () => {
    expect(classifyFailure(new TypeError('Failed to fetch'), 'building_coaching')).toBe('network')
    expect(classifyFailure(new Error('NetworkError when attempting to fetch resource'), 'watching')).toBe('network')
    expect(classifyFailure(new Error('fetch failed'), 'uploading')).toBe('network')
    // The exact regression from the audit: "Failed to fetch" must not read as pose.
    expect(failureMessage(classifyFailure(new TypeError('Failed to fetch'), 'building_coaching'))).not.toMatch(/pose/i)
  })

  it('classifies stage-appropriate failures', () => {
    expect(classifyFailure(new Error('FFmpeg produced an invalid duration'), 'preparing_video')).toBe('normalization')
    expect(classifyFailure(new Error('Gemini Files API upload rejected'), 'preparing_video')).toBe('gemini_video_processing')
    expect(classifyFailure(new Error('evidence pass returned invalid JSON'), 'watching')).toBe('gemini_evidence')
    expect(classifyFailure(new Error('coaching payload incomplete'), 'building_coaching')).toBe('coaching')
  })

  it('maps legacy ingestion codes onto the new taxonomy', () => {
    expect(failureKindFromIngestionCode('ORIGINAL_UPLOAD_FAILED')).toBe('upload')
    expect(failureKindFromIngestionCode('SERVER_PROCESSING_FAILED')).toBe('normalization')
    expect(failureKindFromIngestionCode('NORMALIZED_STORAGE_INCOMPLETE')).toBe('normalization')
    expect(failureKindFromIngestionCode('GEMINI_PROCESSING_TIMEOUT')).toBe('gemini_video_processing')
  })

  it('pose failures are explicitly optional and never block wording', () => {
    expect(failureMessage('pose_optional')).toMatch(/coaching still works/i)
  })
})
