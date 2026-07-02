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
    delete process.env.NEXT_PUBLIC_POSE_PRIMARY_ENGINE
  })

  it('defaults ON with rtmpose primary (no flags needed)', () => {
    stubWindow('')
    expect(cloudPoseRequested()).toBe(true)
    expect(getCloudPoseOptions()).toEqual({ target: 'auto', mode: 'rtmpose' })
  })

  it('turns off when the user picks an on-device backend', () => {
    stubWindow('?poseBackend=local')
    expect(getCloudPoseOptions()).toBeNull()
    stubWindow('?poseBackend=rtmpose')
    expect(getCloudPoseOptions()).toBeNull()
    stubWindow('', { musashiPoseBackend: 'mediapipe' })
    expect(getCloudPoseOptions()).toBeNull()
  })

  it('default follows NEXT_PUBLIC_POSE_PRIMARY_ENGINE, explicit cloud flag still wins', () => {
    process.env.NEXT_PUBLIC_POSE_PRIMARY_ENGINE = 'mediapipe'
    stubWindow('')
    expect(getCloudPoseOptions()).toBeNull()
    stubWindow('?poseBackend=cloud')
    expect(getCloudPoseOptions()).toEqual({ target: 'auto', mode: 'rtmpose' })
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
