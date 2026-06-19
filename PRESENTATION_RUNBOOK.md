# Presentation runbook

Use this when running the app in front of investors. The dev server is fragile (Next 15 cold-compile race on Windows); always present the **production build**.

## Before the presentation

1. **Confirm the Gemini key has live quota.**
   - Run `curl -s http://127.0.0.1:3000/api/test-ai | grep -o '"status":[0-9]*'`
   - If it returns `200`, you're live. If `429`, the cascade in `gemini-client.ts` will fall back to `gemini-2.5-flash`, then to a "demo fallback" payload — the UI stays interactive but you'll be showing a canned response. Do NOT show that to investors if you can avoid it.
   - Top up billing at <https://aistudio.google.com/app/apikey> if needed.

2. **Sanity-check the env.** `OPENAI_API_KEY`, `STRIPE_*`, `EMAIL_API_KEY`, `STORAGE_*` should all be empty in `.env.local` (placeholders are filtered out by `readSecretEnv`). The only required key is `GEMINI_API_KEY` plus `MUSASHI_SESSION_SECRET`.

3. **Build once, serve from build.** Dev mode (`pnpm run dev`) has a cold-compile race that occasionally returns HTTP 500 for `/api/stats` on first hit. Production build doesn't.

## Start the demo

```bash
# Kill anything on port 3000 first
netstat -ano | grep "LISTENING" | grep ":3000 " | awk '{print $5}' | xargs -I{} taskkill //PID {} //F

# Build (only needed once per code change)
pnpm run build

# Serve
pnpm run start
```

App is live at <http://127.0.0.1:3000>. First request precompiles the JIT chunks; click around once before showing it.

## Demo script (3 min)

1. **Land on home.** Stats counters tick from 0 (D1 not connected → real zeros, not "...").
2. **Upload a clip.** Use any short MP4 (≤16s recommended for the short-clip prompt path). The `Upload a Clip` button on the hero opens the picker.
3. **Watch the Fight Lab populate.** MediaPipe runs locally (no network); skeleton overlay appears on the video. The deterministic ledger compiles immediately — events, faults, patterns.
4. **AI coaching panel.** Quick cues appear as fighter-colored cards. Each cue cites a `keyMistake`, `whyItMatters`, `whatToDoInstead`, and links to evidence IDs.
5. **Ask a follow-up.** The Q&A endpoint at `/api/coach` takes free-text + ledger and answers with the strict evidence contract (every claim cites a ledger field).

## What to say when asked the obvious questions

- **"How do you stop the LLM hallucinating?"** Two layers: a deterministic ledger compiled from pose data is the only source of truth in the prompt; a server-side validator (`validateCoachingPayloadAgainstLedger`) flags any cue that references an unknown evidence ID or contradicts a detected fault.
- **"What model are you using?"** Gemini 3.1 Pro for grounded coaching, with an automatic fallback to Gemini 2.5 Flash on rate limit. Embedding pipeline uses `gemini-embedding-2-preview` for cross-modal RAG over a small library of fight knowledge plus per-segment video embeddings.
- **"What's the moat?"** The FightLang ledger schema and the deterministic compiler. The LLM is a renderer over our structured analysis, not the analysis itself — swapping models is a config change, not a rebuild.

## Known gaps (be ready, don't volunteer)

- No session memory or longitudinal tracking yet (designed-in but not wired).
- `audioScript` field exists in the schema but TTS is not generated.
- No comparative analysis ("you vs pro fighter") — single-clip only.
- D1 not attached locally → community/techniques counters are zero.
- No git history (`git init` before any due-diligence sharing).

## Recovery if something breaks live

- **Stats show "..."** — refresh the page once. If still broken, the production build sidesteps this entirely; you should not be in dev mode.
- **AI panel stuck on spinner** — open devtools network tab, look for `/api/fight/analyze`. A 429 means quota; the cascade will resolve in ~10s. A 500 means something else; pivot to the deterministic ledger view (overlays + faults still render without the LLM).
- **Server crash** — `pnpm run start` again. Build is cached; restart is fast.
