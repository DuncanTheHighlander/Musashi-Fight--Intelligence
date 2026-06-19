# 🧠 Musashi AI Architecture: The "True Coach" Logic

## 1. The "Dual-Brain" Reflex System
Most AI apps use one model for everything. We created a biological metaphor:

- The **Reflexes (Gemini 2.5 Flash)**: Used in the LiveAnalysis loop. It sacrifices depth for raw speed. We don't ask it for essays; we ask it for micro-corrections.
- The **Prefrontal Cortex (Gemini 3.0 Pro)**: Used in VideoUpload and Chat. We enable `thinkingBudget: 32768`. This allows the model to "ponder" hidden biomechanical advantages before answering, simulating a master strategist analyzing tape.

## 2. Novelty: "LLM as an Object Detector" (Neural Tracking)
Typically, you need a specific model (YOLO/TensorFlow) to track objects like "Red Gloves."

Our Innovation: We prompt Gemini 2.5 Flash to act as a coordinate mapper.

The Prompt Trick: We force a spatial grid understanding by asking:

"Locate [Object]... Return [ymin, xmin, ymax, xmax] on a scale of 0 to 1000."

The Result: We turned a Chatbot into a Computer Vision engine without loading heavy external libraries. This allows users to track anything (e.g., "Lowered Hands", "Left Knee") simply by typing it, which standard object detectors cannot do.

## 3. The "Voice of Sensei" (Persona Injection)
Generic AI sounds like a helpful customer service agent ("Here is some feedback..."). A fight coach needs to be immediate and visceral.

Constraint Engineering: We restrict the output token count and force a specific tone.

The System Prompt: "You are a fight coach... Your personality is stoic, brief, wise, and intense."

The "Micro-Feedback" Loop: In `analyzeFrame`, we force a JSON return of max 8 words.

Bad AI:

"I notice your hands are dropping slightly, you should raise them."

Musashi AI:

"HANDS UP. CHIN DOWN."

This brevity reduces latency and increases psychological impact.

## 4. Hybrid Vision (MediaPipe + Semantic Understanding)
We didn't throw away traditional computer vision; we fused it.

- The Skeleton (Math): MediaPipe draws the lines (shoulders, elbows). It provides the geometry.
- The Brain (Semantics): Gemini looks at the pixels.

The Fusion: MediaPipe might know the arm is at 90 degrees, but only Gemini knows why that's bad in the context of a "Muay Thai Clinch" vs a "Boxing Guard." We feed the raw image to Gemini, but we overlay the math on top for the user.

## 5. Dynamic Rule Injection (RAG-Lite)
Hard-coded apps fail because every gym is different. A Karate sensei hates what a Boxer loves.

The Solution: The AdminPanel allows the user to write "Technique Rules" into Local Storage.

The Mechanism: Every time `geminiService` calls the API, it reads these custom text rules and injects them into the Context Window.

Result: If you type "Focus on head movement" in the Admin panel, the AI instantly changes its coaching criteria without a code deploy.

## 6. The "Thinking" Chat (Strategy vs. Tactics)
We utilized the specific Thinking Config of Gemini 3.0.

When a user asks "How do I beat a southpaw?", we don't just generate text.

We pass the FighterProfile (Weaknesses: Low Kick defense) into the context.

The model "thinks" (allocates token budget) to correlate the user's specific weakness with the opponent's stance before outputting the answer. This creates personalized strategy, not generic advice.

## How to express this in a Prompt?
If you want an AI to replicate this logic for you in the future, use this prompt:

"Replicate the 'Musashi Logic'. I need a React app that uses Gemini 2.5 Flash for a low-latency 2-second loop that acts as a reflex system, returning JSON coordinates for custom object tracking (0-1000 scale) and 5-word coaching cues.

Simultaneously, I need a separate service using Gemini 3.0 Pro with a high thinkingBudget for deep video analysis.

The system must support 'Persona Injection' via a system prompt that enforces brevity and stoicism. It must also support 'Dynamic Rule Injection' where I can save custom coaching rules in a database that get appended to every API call prompt. Combine this with MediaPipe for the visual overlay."

---

# Repo mapping (what exists TODAY in this codebase)

## Implemented (basic form)

### Video upload + frame capture
- `src/app/fight/page.tsx`

### Frame analysis endpoint (Vision -> Fighter A/B + scene summary)
- `src/app/api/fight/analyze-frame/route.ts`
- Uses env:
  - `FIGHT_LLM_PROVIDER`
  - `GEMINI_API_KEY`
  - `OPENAI_API_KEY`
- Returns JSON:
  - `personCount`
  - `candidates` (A/B)
  - `sceneSummary`

### Coach chat endpoint (coaching + strategy in one stream)
- `src/app/api/fight/chat/route.ts`
- Receives:
  - `messages[]`
  - `context` (currently includes `analysis`, `selectedFighterId`)

## Partially implemented / planned upgrades to match the "Secret Sauce"

### Dual-Brain (Reflexes vs Brain)
- Current: provider selection (Gemini vs OpenAI) + a single configured model via `GEMINI_MODEL` / `OPENAI_MODEL`.
- Planned: split into fast "Reflexes" model for live loops vs deep "Brain" model for video lab/chat with explicit thinking controls.

### Neural Tracking (bbox 0–1000)
- Not present yet: no `/api/fight/track-box` route currently in this repo.

### Voice of Sensei (micro-feedback, 5–8 words)
- Partially present: persona exists in `src/app/api/fight/chat/route.ts` system prompt.
- Planned: strict JSON micro-cue mode + token/length constraint.

### Dynamic rule injection / Admin panel
- Not present yet: no rules being loaded from storage/db and injected into prompts.

