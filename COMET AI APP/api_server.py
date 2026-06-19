#!/usr/bin/env python3
"""Musashi API Server — two-pass fight analysis with chat follow-ups."""
import asyncio
import json
import os
import tempfile
import traceback
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types

# --- Config ---
# Never hardcode the key — read it from the environment only.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY environment variable is not set")
FLASH_MODEL = "gemini-2.5-flash"
PRO_MODEL = "gemini-2.5-pro"

client = genai.Client(api_key=GEMINI_API_KEY)

# Load the fight system prompt
SYSTEM_PROMPT_PATH = Path(__file__).parent / "fight_system_prompt.txt"
SYSTEM_PROMPT = SYSTEM_PROMPT_PATH.read_text() if SYSTEM_PROMPT_PATH.exists() else ""

# In-memory session storage: session_id -> { video_file_uri, video_mime, scan_data, history }
sessions = {}

app = FastAPI(title="Musashi Fight Coach API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"status": "ok", "model_flash": FLASH_MODEL, "model_pro": PRO_MODEL}


@app.post("/api/analyze")
async def analyze_fight(video: UploadFile = File(...)):
    """
    Upload a fight clip. Returns SSE stream with scan + analysis.
    Also creates a session for follow-up chat.
    """
    suffix = Path(video.filename or "clip.mp4").suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await video.read()
        tmp.write(content)
        tmp_path = tmp.name

    async def generate():
        try:
            yield sse_event("status", {"phase": "uploading", "message": "Uploading video to analysis engine..."})

            mime_map = {
                '.mp4': 'video/mp4', '.mov': 'video/quicktime',
                '.webm': 'video/webm', '.avi': 'video/x-msvideo',
            }
            detected_mime = mime_map.get(suffix.lower(), 'video/mp4')
            upload_mime = video.content_type if video.content_type and video.content_type.startswith('video/') else detected_mime

            video_file = client.files.upload(
                file=tmp_path,
                config=types.UploadFileConfig(mime_type=upload_mime)
            )

            while video_file.state.name == "PROCESSING":
                await asyncio.sleep(1)
                video_file = client.files.get(name=video_file.name)

            if video_file.state.name != "ACTIVE":
                yield sse_event("error", {"message": f"Video processing failed: {video_file.state.name}"})
                return

            yield sse_event("status", {"phase": "scanning", "message": "Quick scan — identifying fighters and key moments..."})

            # --- Flash scan ---
            scan_prompt = """You are analyzing a combat sports video clip. Quickly identify:
1. Combat type (boxing, MMA, kickboxing, Muay Thai, sparring, pad work, bag work, etc.)
2. How many fighters are visible?
3. Brief description of each fighter (clothing color, stance, Orthodox/Southpaw)
4. KEY MOMENTS — timestamps where significant exchanges happen
5. Overall tactical situation — who's pressing, who's on the back foot?

Respond in JSON:
{
  "combat_type": "...",
  "num_fighters": 2,
  "fighters": [
    {"id": "A", "description": "...", "stance": "orthodox/southpaw"},
    {"id": "B", "description": "...", "stance": "orthodox/southpaw"}
  ],
  "key_moments": ["0:02 - jab exchange", "0:05 - right hand lands"],
  "tactical_situation": "Fighter A is pressing, B is counter-fighting from the outside",
  "video_quality_notes": "..."
}"""

            scan_response = client.models.generate_content(
                model=FLASH_MODEL,
                contents=[
                    types.Part.from_uri(file_uri=video_file.uri, mime_type=video_file.mime_type),
                    scan_prompt
                ],
                config=types.GenerateContentConfig(temperature=0.3)
            )

            scan_text = scan_response.text
            scan_data = None
            try:
                json_start = scan_text.find("{")
                json_end = scan_text.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    scan_data = json.loads(scan_text[json_start:json_end])
            except json.JSONDecodeError:
                scan_data = {"raw_scan": scan_text}

            yield sse_event("scan_complete", scan_data or {"raw_scan": scan_text})
            yield sse_event("status", {"phase": "analyzing", "message": "Deep analysis — breaking down every detail..."})

            # --- Pro deep analysis ---
            context_note = ""
            if scan_data and "fighters" in scan_data:
                fighters_desc = "\n".join([
                    f"- Fighter {f.get('id','?')}: {f.get('description','unknown')} ({f.get('stance','unknown')})"
                    for f in scan_data.get("fighters", [])
                ])
                context_note = f"""
From the initial scan:
- Combat type: {scan_data.get('combat_type', 'unknown')}
- Fighters:
{fighters_desc}
- Key moments: {', '.join(scan_data.get('key_moments', ['none identified']))}
- Tactical situation: {scan_data.get('tactical_situation', 'unknown')}
"""

            deep_prompt = f"""Analyze this fight clip in full depth. Give your complete coaching breakdown.

{context_note}

Watch the entire clip carefully. Pay attention to:
- Footwork patterns and weight distribution
- Hand positioning and guard discipline
- Timing and rhythm of attacks
- Defensive reactions and counter opportunities
- Ring/cage positioning and spatial control
- Combinations thrown and their effectiveness

Deliver your full analysis following the output format in your system instructions."""

            full_text = ""
            for chunk in client.models.generate_content_stream(
                model=PRO_MODEL,
                contents=[
                    types.Part.from_uri(file_uri=video_file.uri, mime_type=video_file.mime_type),
                    deep_prompt
                ],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.7,
                    max_output_tokens=4096
                )
            ):
                if chunk.text:
                    full_text += chunk.text
                    yield sse_event("chunk", {"text": chunk.text})

            # Create session for follow-up chat
            import uuid
            session_id = str(uuid.uuid4())[:8]
            sessions[session_id] = {
                "video_uri": video_file.uri,
                "video_mime": video_file.mime_type,
                "video_name": video_file.name,
                "scan_data": scan_data,
                "history": [
                    {"role": "user", "text": deep_prompt},
                    {"role": "assistant", "text": full_text}
                ]
            }

            yield sse_event("complete", {"full_text": full_text, "session_id": session_id})

            # NOTE: Don't delete the video file yet — we need it for follow-up chat

        except Exception as e:
            traceback.print_exc()
            yield sse_event("error", {"message": str(e)})
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.post("/api/chat")
async def chat_followup(session_id: str = Form(...), message: str = Form(...)):
    """
    Follow-up chat about an already-analyzed video.
    Streams the response back via SSE.
    """
    session = sessions.get(session_id)
    if not session:
        async def error_gen():
            yield sse_event("error", {"message": "Session expired. Please upload the video again."})
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    async def generate():
        try:
            # Build multi-turn contents with the video
            contents = [
                types.Part.from_uri(file_uri=session["video_uri"], mime_type=session["video_mime"])
            ]

            # Add conversation history
            for turn in session["history"]:
                contents.append(turn["text"])

            # Add the new user message
            contents.append(message)

            yield sse_event("status", {"message": "Thinking..."})

            full_text = ""
            for chunk in client.models.generate_content_stream(
                model=PRO_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT + "\n\nYou are in a follow-up conversation about a fight clip you already analyzed. The user is asking a specific question. Answer concisely and specifically — reference what you see in the video. Stay in your coaching voice. If they ask for drills, give real drills. If they ask about a specific moment, reference the timestamp.",
                    temperature=0.7,
                    max_output_tokens=2048
                )
            ):
                if chunk.text:
                    full_text += chunk.text
                    yield sse_event("chunk", {"text": chunk.text})

            # Update session history
            session["history"].append({"role": "user", "text": message})
            session["history"].append({"role": "assistant", "text": full_text})

            # Keep history manageable (last 10 turns)
            if len(session["history"]) > 20:
                session["history"] = session["history"][-20:]

            yield sse_event("complete", {"full_text": full_text})

        except Exception as e:
            traceback.print_exc()
            yield sse_event("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


def sse_event(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
