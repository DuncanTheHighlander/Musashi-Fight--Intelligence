import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudPoseRequested, getCloudPoseOptions } from './cloudPose'

function stubWindow(search: string, storage: Record<string, string> = {}) {
  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (key: string) => storage[key] ?? null,
    },
  })
}

describe('cloudPose options', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stays off unless cloud is requested', () => {
    stubWindow('')
    expect(cloudPoseRequested()).toBe(false)
    expect(getCloudPoseOptions()).toBeNull()
  })

  it('parses query-string target and mode', () => {
    stubWindow('?poseBackend=cloud&poseCloudTarget=cpu&poseCloudMode=mediapipe')
    expect(cloudPoseRequested()).toBe(true)
    expect(getCloudPoseOptions()).toEqual({ target: 'cpu', mode: 'mediapipe' })
  })

  it('uses localStorage switches', () => {
    stubWindow('', {
      musashiPoseBackend: 'cloud',
      musashiPoseCloudTarget: 'gpu',
      musashiPoseCloudMode: 'mediapipe',
    })
    expect(getCloudPoseOptions()).toEqual({ target: 'gpu', mode: 'mediapipe' })
  })

  it('clamps invalid query switches to safe defaults', () => {
    stubWindow('?poseBackend=cloud&poseCloudTarget=bad&poseCloudMode=bad', {
      musashiPoseCloudTarget: 'gpu',
      musashiPoseCloudMode: 'rtmpose',
    })
    expect(getCloudPoseOptions()).toEqual({ target: 'auto', mode: 'rtmpose' })
  })
})
