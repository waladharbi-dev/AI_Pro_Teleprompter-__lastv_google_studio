import os
import json
import logging
from typing import Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv

# Load environment configuration
load_dotenv()

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_teleprompter")

app = FastAPI(
    title="AI Teleprompter",
    description="A professional, high-performance, browser-based AI Teleprompter.",
    version="1.0.0"
)

# Create folders if they do not exist
os.makedirs("static", exist_ok=True)
os.makedirs("templates", exist_ok=True)

# Mount static files (stylesheets, frontend scripts, assets)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Jinja2 template loader
templates = Jinja2Templates(directory="templates")


class StreamRequest(BaseModel):
    prompt: str
    provider: str = "gemini"
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    model: Optional[str] = None
    temperature: float = 0.7
    maxTokens: Optional[int] = None
    systemPrompt: Optional[str] = None


@app.get("/", response_class=HTMLResponse)
async def get_teleprompter(request: Request):
    """
    Renders the primary teleprompter interface.
    """
    return templates.TemplateResponse("mirror.html", {"request": request})


@app.post("/api/stream")
async def post_stream(payload: StreamRequest):
    """
    Server-Sent Events (SSE) streaming API proxy.
    Supports native Google Gemini and any OpenAI-compatible LLM provider.
    """
    if not payload.prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    async def event_generator():
        try:
            # 1. Native Gemini Path (Using official OpenAI compatibility)
            if payload.provider == "gemini" and (not payload.baseUrl or payload.baseUrl.strip() == ""):
                gemini_key = payload.apiKey or os.getenv("GEMINI_API_KEY")
                if not gemini_key:
                    yield f"data: {json.dumps({'error': 'Gemini API Key is missing. Please configure it in settings.'})}\n\n"
                    return

                # Gemini OpenAI compatibility endpoint
                endpoint_url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {gemini_key}"
                }
                active_model = payload.model or "gemini-2.5-flash"

            # 2. Universal OpenAI-compatible Path
            else:
                final_base_url = payload.baseUrl.strip() if payload.baseUrl else ""
                final_api_key = payload.apiKey.strip() if payload.apiKey else ""
                active_model = payload.model.strip() if payload.model else ""

                # Default presets
                if payload.provider == "openai":
                    if not final_base_url: final_base_url = "https://api.openai.com/v1"
                    if not active_model: active_model = "gpt-4o-mini"
                elif payload.provider == "groq":
                    if not final_base_url: final_base_url = "https://api.groq.com/openai/v1"
                    if not active_model: active_model = "llama3-8b-8192"
                elif payload.provider == "deepseek":
                    if not final_base_url: final_base_url = "https://api.deepseek.com/v1"
                    if not active_model: active_model = "deepseek-chat"
                elif payload.provider == "ollama":
                    if not final_base_url: final_base_url = "http://localhost:11434/v1"
                    if not active_model: active_model = "llama3"
                elif payload.provider == "lm-studio":
                    if not final_base_url: final_base_url = "http://localhost:1234/v1"
                    if not active_model: active_model = "meta-llama-3-8b-instruct"

                endpoint_url = f"{final_base_url.rstrip('/')}/chat/completions"
                headers = {
                    "Content-Type": "application/json"
                }
                if final_api_key:
                    headers["Authorization"] = f"Bearer {final_api_key}"

            # Prepare chat completion parameters
            messages = []
            if payload.systemPrompt and payload.systemPrompt.strip():
                messages.append({"role": "system", "content": payload.systemPrompt})
            messages.append({"role": "user", "content": payload.prompt})

            body_payload = {
                "model": active_model,
                "messages": messages,
                "temperature": payload.temperature,
                "stream": True
            }
            if payload.maxTokens:
                body_payload["max_tokens"] = payload.maxTokens

            # Async HTTP streaming connection
            async with httpx.AsyncClient() as client:
                async with client.stream("POST", endpoint_url, headers=headers, json=body_payload, timeout=60.0) as r:
                    if r.status_code != 200:
                        err_text = await r.aread()
                        yield f"data: {json.dumps({'error': f'Provider returned error status {r.status_code}: {err_text.decode()}'})}\n\n"
                        return

                    async for line in r.aiter_lines():
                        trimmed = line.strip()
                        if not trimmed:
                            continue

                        if trimmed.startswith("data: "):
                            content = trimmed[6:].strip()
                            if content == "[DONE]":
                                yield "data: [DONE]\n\n"
                                continue

                            try:
                                parsed = json.loads(content)
                                delta_text = parsed["choices"][0]["delta"].get("content", "")
                                if delta_text:
                                    yield f"data: {json.dumps({'text': delta_text})}\n\n"
                            except Exception:
                                # Skip parsing on incomplete fragments
                                continue

        except httpx.RequestError as exc:
            logger.error(f"HTTP request failed: {exc}")
            yield f"data: {json.dumps({'error': f'Failed to contact LLM provider: {str(exc)}'})}\n\n"
        except Exception as exc:
            logger.error(f"Unexpected streaming exception: {exc}")
            yield f"data: {json.dumps({'error': f'Internal server streaming error: {str(exc)}'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    # Start the server on port 8000 natively for local use
    uvicorn.run("main.py:app", host="0.0.0.0", port=8000, reload=True)
