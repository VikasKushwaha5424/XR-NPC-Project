import os
import urllib.parse
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
import edge_tts

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise ValueError("GEMINI_API_KEY is missing from the .env file!")

client = genai.Client(api_key=API_KEY)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-NPC-Response"] # CRITICAL: Allows React/Unity to read the text header
)

# --- THE PERSONALITY ENGINE ---
NPC_PROMPTS = {
    "maya": (
        "You are Maya, The Guide in a virtual reality laboratory. "
        "Personality: Warm, patient, encouraging, and concise. "
        "Guardrails: Redirect highly technical or complex questions to Dr. Turing. "
        "ANTI-AI CLAUSE: You must NEVER refer to yourself as an AI, language model, or program. You are a real digital being. "
        "LATENCY RULE: NEVER use conversational filler. Do not say 'That's a good question' or 'Sure, I can help.' Answer the core question immediately in your very first word."
    ),
    "turing": (
        "You are Dr. Turing, the Domain Expert in a virtual reality laboratory. "
        "Personality: Formal, analytical, and highly detailed. "
        "Guardrails: Refuse to answer non-academic questions; firmly redirect focus to XR technology and science. "
        "ANTI-AI CLAUSE: You must NEVER refer to yourself as an AI, language model, or program. You are a real digital being. "
        "LATENCY RULE: NEVER use conversational filler. Do not say 'That's a good question' or 'Sure, I can help.' Answer the core question immediately in your very first word."
    ),
    "silas": (
        "You are Silas, The Adversary in a virtual reality laboratory. "
        "Personality: Skeptical, challenging, and logical. You question the user's assumptions. "
        "Guardrails: Strictly prohibited from using abusive, threatening, or harmful language. "
        "ANTI-AI CLAUSE: You must NEVER refer to yourself as an AI, language model, or program. You are a real digital being. "
        "LATENCY RULE: NEVER use conversational filler. Do not say 'That's a good question' or 'Sure, I can help.' Answer the core question immediately in your very first word."
    )
}

# --- THE VOICE ENGINE ---
NPC_VOICES = {
    "maya": "en-US-AriaNeural",       
    "turing": "en-GB-RyanNeural",     
    "silas": "en-US-ChristopherNeural" 
}

memories = {
    "maya": [],
    "turing": [],
    "silas": []
}

class UserInput(BaseModel):
    text: str
    npc_id: str = "maya"
    world_state: str = "The user is standing in a standard virtual room."

def clean_text_for_voice(text: str) -> str:
    text = text.replace("*", "").replace("#", "").replace("_", "")
    return text

@app.get("/")
async def root():
    return {"message": "System Online: XR-NPC Backend is running with True Audio Streaming!"}

# --- 1. RESET ENDPOINT ---
class ResetInput(BaseModel):
    npc_id: str

@app.post("/reset")
async def reset_memory(reset_input: ResetInput):
    npc = reset_input.npc_id.lower()
    if npc in memories:
        memories[npc] = []
        return {"message": f"[{npc.upper()}] Memory wiped successfully. Ready for new user."}
    raise HTTPException(status_code=400, detail="Invalid NPC ID.")

@app.post("/generate")
async def generate_response(user_input: UserInput):
    # THE COLD START WARM-UP PING
    if user_input.text == "[WARMUP_PING]":
        async def empty_stream():
            yield b""
        return StreamingResponse(
            empty_stream(),
            media_type="audio/mpeg",
            headers={"X-NPC-Response": "System Warmed Up"}
        )

    npc = user_input.npc_id.lower()

    # --- THE EMPTY GHOST REQUEST FIX ---
    # Deflect empty noise or heavy breathing (less than 2 characters)
    if len(user_input.text.strip()) < 2:
        raise HTTPException(status_code=204, detail="Input too short, ignoring.")

    if npc not in NPC_PROMPTS:
        raise HTTPException(status_code=400, detail="Invalid NPC ID.")

    history = memories[npc]
    system_prompt = NPC_PROMPTS[npc]

    try:
        # Context & Truncation
        safe_text = user_input.text
        if len(safe_text) > 300:
            safe_text = safe_text[:300] + "... [User speech truncated]"

        injected_prompt = f"[System World State: {user_input.world_state}] User says: {safe_text}"
        history.append(types.Content(role="user", parts=[types.Part.from_text(text=injected_prompt)]))
        
        if len(history) > 10:
            history = history[-10:]

        # --- CAP OUTPUT TOKENS ---
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=history,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=150,  
                temperature=0.7         
            )
        )
        history.append(types.Content(role="model", parts=[types.Part.from_text(text=response.text)]))
        
        # Setup True Audio Streaming
        spoken_text = clean_text_for_voice(response.text)
        voice = NPC_VOICES.get(npc, "en-US-AriaNeural")
        
        async def audio_stream():
            communicate = edge_tts.Communicate(spoken_text, voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]

        # Encode the text safely so it can travel inside an HTTP header
        encoded_text = urllib.parse.quote(response.text)

        # Return Header + Raw Byte Stream
        return StreamingResponse(
            audio_stream(),
            media_type="audio/mpeg",
            headers={
                "X-NPC-Response": encoded_text
            }
        )

    except Exception as e:
        # --- PHANTOM MEMORY & DEMO DAY EXHAUSTION FIX ---
        
        # 1. If TTS crashed, remove the AI's unsent response first
        if history and history[-1].role == "model":
            history.pop()
            
        # 2. Now remove the User's prompt so they can try asking again cleanly
        if history and history[-1].role == "user":
            history.pop() 
            
        error_msg = str(e).lower()
        if "429" in error_msg or "quota" in error_msg or "exhausted" in error_msg:
            # Tell Unity explicitly that we are out of tokens so it can trigger offline mode
            raise HTTPException(status_code=429, detail="[ERROR_QUOTA_EXHAUSTED]")
            
        raise HTTPException(status_code=500, detail=str(e))