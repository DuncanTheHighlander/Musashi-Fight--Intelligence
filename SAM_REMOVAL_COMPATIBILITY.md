# SAM Removal Compatibility

## Goal

Make SAM completely non-required for the Tier 1 app path while keeping the existing fight analysis surface compiling and running.

Tier 1 is now:

- MediaPipe pose detection
- MediaPipe-only identity persistence
- Pose-derived fighter boxes
- Red corner / blue corner skeleton overlays
- Key moment callouts and tactical breakdown UI
- No SAM boot dependency
- No fal/SAM paid API dependency

## Files Changed

- `src/lib/sam-types.ts`
  - Standalone dependency-free SAM compatibility types.
  - Exports `SegmentationMask` and `FighterMasks` so old consumers can typecheck without importing the SAM service.

- `src/services/sam3CloudSegmenter.ts`
  - Kept as a disabled compatibility stub.
  - Exports the old public names, but reports unavailable and returns empty masks.
  - Prevents runtime crashes while the rest of the app moves off SAM.

- `src/services/sam2VideoTracker.ts`
  - Kept as a no-op placeholder.
  - No callers remain.

- `src/lib/kinematics.ts`
  - Repointed mask types to `@/lib/sam-types`.
  - Mask helpers tolerate `null` / `undefined`.
  - `computeKinematicsSnapshot` only emits `sam3` metrics when real masks exist.

- `src/components/fight/FightCoachExperience.tsx`
  - Removed direct runtime imports from the SAM service.
  - Added local optional SAM compatibility helpers that default to disabled.
  - Replaced SAM control copy with Tier 1 tracking status.
  - Keeps masks optional and passes `null` / empty fallback data where needed.

- `src/components/video/FightAnalyzer.tsx`
  - SAM identity correction is not required.
  - Current path uses MediaPipe pose tracking, color/scale/shape matching, and occlusion hold.

- `src/components/overlay/FightOverlay.tsx`
  - Added pose-derived dashed fighter boxes around red corner and blue corner.
  - This gives the demo the boxes + skeletons visual without SAM.

- `src/app/api/fal/proxy/route.ts`
  - Disabled for Tier 1 with HTTP `410`.
  - No SAM/fal paid calls are made from this route.

- `src/app/api/fal/realtime-token/route.ts`
  - Disabled for Tier 1 with HTTP `410`.
  - No realtime fal/SAM token is issued.

- `test-assets/cdp-fixture-test.mjs`
  - Made fixture playback verification more reliable by using a fresh Chrome profile per run.

## SAM Imports Removed

- Main app runtime code no longer imports `@/services/sam3CloudSegmenter`.
- Kinematics imports only shared mask types from `@/lib/sam-types`.
- The SAM service file imports its own shared types and acts as a compatibility stub.

## Required Masks Changed To Optional

- `calculateFighterArea(mask?: SegmentationMask | null)`
  - Returns `0` when no mask exists.

- `pickBetterMaskForPose(pose, masks?: FighterMasks | null)`
  - Returns `null` when masks or pose data are missing.

- `computeKinematicsSnapshot(..., fighterMasks?: FighterMasks | null)`
  - Skips SAM metrics unless at least one real mask exists.

- Fight coach runtime segmentation data
  - Defaults to empty masks and disabled segmenter behavior.
  - The UI and analysis continue through MediaPipe-only fallback data.

## Tests Run

- `pnpm exec tsc --noEmit`
  - Passed.

- `pnpm test`
  - Passed: 36 tests.

- `pnpm build`
  - Passed: Next.js production build completed successfully.

- `node test-assets\cdp-fixture-test.mjs`
  - Passed fixture video boot/playback verification.
  - Verified video loaded, overlay canvas drew pixels, red/blue corner labels appeared, boot pre-scan completed `24/24`, and callouts rendered.

## Remaining Known Issues

- MediaPipe-only tracking still cannot guarantee perfect identity through full body occlusion. When one fighter walks directly in front of the other, the model can still confuse or overlap identities because there is no true object memory behind the occluded fighter.

- Current fighter boxes are pose-derived, not a separate person detector. They provide the Tier 1 visual and demo stability, but the next tracking upgrade should add MediaPipe ObjectDetector boxes plus IoU/Hungarian assignment.

- SAM files are stubbed, not deleted. This is intentional compatibility safety. They can be physically removed after a follow-up pass confirms no optional Tier 2 imports need them.

- Full AI clip analysis may still use the configured fight analysis API/Gemini path when explicitly triggered. SAM/fal is no longer required for upload, playback, skeletons, boxes, labels, or key callouts.

## Re-Adding SAM Later As Optional Tier 2

1. Keep `src/lib/sam-types.ts` as the shared type contract.
2. Add a new isolated SAM module, for example `src/services/tier2/samVideoTracker.ts`.
3. Load it only with dynamic import behind an explicit feature flag, such as `NEXT_PUBLIC_SAM_TIER2=1`.
4. Never block video upload, boot, playback, or MediaPipe pose on SAM availability.
5. Treat masks as optional evidence:
   - MediaPipe pose is the skeleton source.
   - Object/person boxes are the Tier 1 identity source.
   - SAM masks can improve identity only when present and fresh.
6. Keep fal/Replicate/cloud calls behind separate routes with disabled-by-default behavior.
7. Add fixture tests for both paths:
   - Tier 1 with no SAM keys and no paid APIs.
   - Tier 2 with masks enabled.

