import { describe, expect, it } from 'vitest'
import {
  classifyFailure,
  derivePipelineStage,
  failureKindFromIngestionCode,
  failureMessage,
  PIPELINE_STAGE_ORDER,
  pipelineStatusLabel,
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

describe('derivePipelineStage', () => {
  const ALL_INGESTION_STAGES = [
    'selected',
    'uploading_original',
    'original_uploaded',
    'normalizing',
    'normalized',
    'uploading_to_gemini',
    'gemini_processing',
    'gemini_ready',
    'analyzing',
    'complete',
    'failed',
  ] as const

  it('maps every VideoIngestionStage value to a known stage', () => {
    const valid = new Set([...PIPELINE_STAGE_ORDER, 'failed'])
    for (const ingestionStage of ALL_INGESTION_STAGES) {
      expect(valid.has(derivePipelineStage({ ingestionStage }) as never)).toBe(true)
    }
  })

  it('maps the ingestion stages onto the five user-visible stages', () => {
    expect(derivePipelineStage({ ingestionStage: 'selected' })).toBe('uploading')
    expect(derivePipelineStage({ ingestionStage: 'uploading_original' })).toBe('uploading')
    expect(derivePipelineStage({ ingestionStage: 'normalizing' })).toBe('preparing_video')
    expect(derivePipelineStage({ ingestionStage: 'gemini_processing' })).toBe('preparing_video')
    expect(derivePipelineStage({ ingestionStage: 'gemini_ready' })).toBe('building_coaching')
    expect(derivePipelineStage({ ingestionStage: 'complete' })).toBe('ready')
    expect(derivePipelineStage({ ingestionStage: 'failed' })).toBe('failed')
  })

  it('separates watching (evidence pass) from building_coaching', () => {
    expect(derivePipelineStage({ ingestionStage: 'analyzing' })).toBe('watching')
    expect(derivePipelineStage({ ingestionStage: 'analyzing', hasCoaching: true })).toBe('building_coaching')
  })

  it('failed beats ready, and ready beats everything else', () => {
    expect(derivePipelineStage({ failed: true, ready: true, ingestionStage: 'analyzing' })).toBe('failed')
    expect(derivePipelineStage({ ready: true, uploading: true, ingestionStage: 'uploading_original' })).toBe('ready')
  })

  it('an active upload cannot be reported as any later stage', () => {
    // The exact contradiction from production: "Uploading…" beside "PREPARING".
    expect(derivePipelineStage({ uploading: true, ingestionStage: 'analyzing' })).toBe('uploading')
  })

  it('falls back to preparing_video for unknown/absent ingestion stages', () => {
    expect(derivePipelineStage({})).toBe('preparing_video')
    expect(derivePipelineStage({ ingestionStage: 'something_new' })).toBe('preparing_video')
  })

  it('labels every derived stage, including failure', () => {
    expect(pipelineStatusLabel('failed')).toBe('Analysis failed')
    expect(pipelineStatusLabel('watching')).toBe(stageLabel('watching'))
  })
})
