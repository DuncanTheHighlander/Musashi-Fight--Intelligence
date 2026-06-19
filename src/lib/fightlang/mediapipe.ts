import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { POSE_LANDMARKS } from '@/lib/kinematics'
import type { Joint3D, PoseFrame } from '@/lib/fightlang/primitives'

const toJoint3D = (lm: NormalizedLandmark | undefined | null): Joint3D | null => {
  if (!lm) return null
  return {
    x: lm.x,
    y: lm.y,
    z: lm.z ?? 0,
    visibility: lm.visibility ?? 1,
  }
}

export function poseFrameFromMediaPipe(landmarks: NormalizedLandmark[] | null): PoseFrame {
  if (!landmarks) return {}
  const get = (idx: number) => toJoint3D(landmarks[idx])

  const pose: PoseFrame = {}
  const nose = get(POSE_LANDMARKS.NOSE)
  if (nose) pose.nose = nose

  const ls = get(POSE_LANDMARKS.LEFT_SHOULDER)
  const rs = get(POSE_LANDMARKS.RIGHT_SHOULDER)
  if (ls) pose.leftShoulder = ls
  if (rs) pose.rightShoulder = rs

  const lh = get(POSE_LANDMARKS.LEFT_HIP)
  const rh = get(POSE_LANDMARKS.RIGHT_HIP)
  if (lh) pose.leftHip = lh
  if (rh) pose.rightHip = rh

  const la = get(POSE_LANDMARKS.LEFT_ANKLE)
  const ra = get(POSE_LANDMARKS.RIGHT_ANKLE)
  if (la) pose.leftAnkle = la
  if (ra) pose.rightAnkle = ra

  const lfi = get(POSE_LANDMARKS.LEFT_FOOT_INDEX)
  const rfi = get(POSE_LANDMARKS.RIGHT_FOOT_INDEX)
  if (lfi) pose.leftFootIndex = lfi
  if (rfi) pose.rightFootIndex = rfi

  return pose
}

