# Musashi AI Fight Coach — Quick Start

## Prerequisites
- Node.js 18+ (`node --version`)
- npm or pnpm

## Setup & Run

```bash
# 1. Install dependencies
npm install
# or: pnpm install

# 2. Set up environment
# .env.local is already configured with:
# - GEMINI_API_KEY (set)
# - GEMINI_EMBED_MODEL=gemini-embedding-2-preview
# - FAL_KEY for SAM 3 (set)
# - GEMINI_DISABLE_AUTH=1 (dev mode, no login needed)

# 3. Start dev server
npm run dev

# 4. Open browser
# http://localhost:3000
```

## What You'll See

### Main Page: `/fight`
- **Video Upload** — drag & drop or click to upload fight clip
- **Real-time Analysis**:
  - Skeleton overlays (MediaPipe pose detection, both fighters)
  - Strike classification (jab, cross, hook, kick, teep — labeled arrows on-screen)
  - Faults detected (guard low, chin exposed, overextension)
  - Patterns (guard drop before entry, linear retreat, one-beat entry)

- **Breakdown Mode** (auto-enabled on upload):
  - Pose overlay shows both fighters' skeletons in real-time
  - FightLang fast compilation (52 frames sampled from the clip)
  - SAM 3 fighter segmentation (colored masks, fighter assignment help)
  - Kinematic HUD (torso angle, stance width in live numbers)

- **Slow-mo** — when AI overlay annotations appear, video auto-slows to 0.52×
  - Watch tactical callouts appear with arrows, circles, labels
  - Video resumes normal speed when callout fades
  - Manual toggle: "Breakdown slo-mo" button top-right

- **Coaching Output** — when Gemini finishes:
  - **quickCues** — 3-6 tactical cues (like a corner coach talking)
  - **mainDiagnosis** — 1-2 sentence summary of who's winning tactically
  - **overlayAnnotations** — arrows pointing at opportunities, mistakes, patterns
  - Evidence citations linking back to ledger detections

### Key Features

**Strike Classification**
- Detects hand bursts from kinematics (speed threshold 1.2 body-widths/sec)
- Classifies by wrist direction + elbow angle:
  - **Straight** (elbows extended): jab (lead) or cross (rear)
  - **Lateral arc** (wrist away from centerline): lead hook or rear hook
  - **Upward** (tight elbow, wrist below shoulder): lead/rear uppercut
- Detects foot bursts (teep, lead kick, rear kick)

**Pattern Detection**
- **guard_drop_before_entry**: guard low → strike within 300ms (counter window)
- **linear_retreat**: fighter only moves straight back without angling (predictable)
- **one_beat_entry**: enters on consistent timing (e.g., always 300ms after range-close)

**Gemini Reasoning**
- Model: `gemini-3.1-pro-preview` (reasoning, tactical analysis)
- Grounded in FightLang ledger (can't invent detections)
- RAG context: 12 hardcoded fight knowledge docs (stance, guard, range tactics, etc.)
- Embedding model: `gemini-embedding-2-preview` (text + video multimodal)
- Output: JSON coaching payload with tactical cues + on-screen annotations

**SAM 3 Segmentation** (via fal.ai)
- Cloud-based segmentation (no GPU needed locally)
- Point prompts from MediaPipe landmarks
- Binary masks (0=background, 255=fighter)
- Overlays as colored regions on video
- Used to confirm fighter assignment (who is A, who is B)

## Env Vars (Already Set)

```
GEMINI_API_KEY=<your-key>              # Gemini API access
GEMINI_MODEL=gemini-3.1-pro-preview    # Main reasoning model
GEMINI_FLASH_MODEL=gemini-2.5-flash    # Fast path (reflex, tracking)
GEMINI_EMBED_MODEL=gemini-embedding-2-preview  # Text + video embedding
FAL_KEY=<your-fal-key>                 # SAM 3 cloud segmentation
MUSASHI_DISABLE_AUTH=1                 # Dev mode (no login)
FIGHTLANG_INMEM_RETRIEVAL=1            # Enable in-memory RAG
```

## How to Use

1. **Upload a fight clip** (3-30 seconds recommended)
2. **Watch the breakdown**:
   - Skeletons appear in real-time
   - Strikes are labeled (jab, cross, hook, etc.)
   - Faults and patterns show as overlays
3. **Enable slow-mo** to read the tactical callouts
4. **Check the coaching output** for detailed tactical advice
5. **Try different clips** to see how it adapts to different fighting styles

## Deployment

### Cloudflare Workers (Production)
```bash
wrangler deploy
```

### Vercel
```bash
vercel deploy
```

### Docker
```bash
docker build -t musashi .
docker run -p 3000:3000 musashi
```

## Troubleshooting

**"Video not ready"** — wait 1-2 seconds after upload, then try again

**"SAM unavailable"** — FAL_KEY not set or network issue

**"Gemini error"** — check GEMINI_API_KEY is valid at https://aistudio.google.com

**"No pose detected"** — make sure video has two fighters visible; try a clearer clip

**Slow analysis** — first request generates embeddings (cache hit on next request)

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Pose Detection**: MediaPipe PoseLandmarker (browser, real-time)
- **Fight Analysis**: FightLang compiler (deterministic, explainable)
- **AI Reasoning**: Gemini 3.1 Pro + Embedding 2 (multimodal)
- **Segmentation**: SAM 3 via fal.ai (cloud)
- **Database**: Cloudflare D1 (SQLite at edge) — optional
- **Real-time Video Overlay**: Canvas API (arrows, circles, labels, time-synced)
- **Slow-mo**: Native HTML5 playbackRate control (0.52× during annotations)

## Architecture

```
Video Upload
    ↓
MediaPipe PoseLandmarker (2 fighters, real-time)
    ↓
FightLang Compiler:
  - Geometric analysis (stance, guard, range)
  - Kinematic analysis (speed, burst, rhythm)
  - Symbolic rules (strikes, faults, patterns)
  - Overlay annotations (arrows, circles, labels)
    ↓
SAM 3 Segmentation (fal.ai cloud)
    ↓
Embedding-2 RAG (12 fight knowledge docs)
    ↓
Gemini 3.1 Pro Coaching:
  - Tactical cues (quick, punchy)
  - Main diagnosis (who's winning)
  - Suggested corrections (specific fixes)
  - Additional overlay annotations
    ↓
Canvas Rendering:
  - Skeletons (both fighters, real-time)
  - Broadcast lines (torso angle, stance width)
  - Fault overlays (circle/label)
  - Strike annotations (arrow + label)
  - Pattern highlights
  - Time-synced fade-in/out
    ↓
Auto Slow-mo (0.52× during callouts)
    ↓
YouTube-style Breakdown on-screen
```

## Next Steps

- **Video learning**: Add persistent vector store for user fight videos
- **Strike refinement**: Add spin, elbow position, distance gates for better classification
- **Multi-camera**: Handle multiple angles (e.g., overhead + side)
- **Audio coaching**: TTS for cornerman cues
- **Live stream**: WebSocket for live broadcast breakdown

---

**Good luck! Your AI fight coach awaits.** 🥋

Now go upload a fight clip and see the magic happen.
