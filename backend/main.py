import os
import time
import asyncio
import urllib.parse
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
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

# --- THE PERSONALITY & VOICE ENGINE (Dynamic Load) ---
NPC_PROMPTS = {}
NPC_VOICES = {}

try:
    with open("npcs.json", "r", encoding="utf-8") as file:
        npc_data = json.load(file)
        for npc_id, data in npc_data.items():
            NPC_PROMPTS[npc_id] = data.get("prompt", "")
            NPC_VOICES[npc_id] = data.get("voice", "en-US-AriaNeural")
    print(f"✅ Successfully loaded {len(npc_data)} NPCs from npcs.json")
except FileNotFoundError:
    print("❌ ERROR: npcs.json not found! Make sure it is in the backend folder.")
except json.JSONDecodeError:
    print("❌ ERROR: npcs.json is improperly formatted. Check for missing commas or unescaped quotes.")

# PATCH 2: Nested dictionary to isolate user sessions with garbage collection data
session_memories = {}

# --- GARBAGE COLLECTOR TASK ---
async def clean_old_sessions():
    """Runs in the background to delete sessions inactive for over 1 hour"""
    while True:
        await asyncio.sleep(3600) # Wait 1 hour
        current_time = time.time()
        expired_sessions = [
            sid for sid, s_data in session_memories.items() 
            if current_time - s_data["last_active"] > 3600
        ]
        for sid in expired_sessions:
            del session_memories[sid]
            print(f"Garbage Collector: Deleted inactive session {sid}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(clean_old_sessions())

# --- PYDANTIC VALIDATION ADDED HERE ---
class UserInput(BaseModel):
    text: str = Field(..., min_length=2, max_length=300)
    npc_id: str = "maya"
    world_state: str = "The user is standing in a standard virtual room."
    session_id: str = "default_user" # Added to isolate different headsets/tabs

def clean_text_for_voice(text: str) -> str:
    text = text.replace("*", "").replace("#", "").replace("_", "")
    return text

@app.get("/")
async def root():
    return {"message": "System Online: XR-NPC Backend is running with True Audio Streaming!"}

# --- 1. RESET ENDPOINT ---
class ResetInput(BaseModel):
    npc_id: str
    session_id: str = "default_user"

@app.post("/reset")
async def reset_memory(reset_input: ResetInput):
    npc = reset_input.npc_id.lower()
    session = reset_input.session_id
    
    if session in session_memories and npc in session_memories[session]["data"]:
        session_memories[session]["data"][npc] = []
        return {"message": f"[{npc.upper()}] Memory wiped successfully for session {session}."}
    return {"message": "No memory found to wipe."}

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
    session = user_input.session_id

    if npc not in NPC_PROMPTS:
        raise HTTPException(status_code=400, detail="Invalid NPC ID.")

    # Initialize memory for new sessions dynamically
    if session not in session_memories:
        session_memories[session] = {
            "last_active": time.time(), 
            "data": {k: [] for k in NPC_PROMPTS.keys()} # Initialize empty lists based on dynamic JSON keys
        }
    
    # Update the activity timestamp
    session_memories[session]["last_active"] = time.time()
    
    # Access the specific NPC history
    # Fallback to empty list just in case a new NPC was added after session started
    if npc not in session_memories[session]["data"]:
         session_memories[session]["data"][npc] = []
         
    history = session_memories[session]["data"][npc]
    system_prompt = NPC_PROMPTS[npc]

    try:
        injected_prompt = f"[System World State: {user_input.world_state}] User says: {user_input.text}"
        history.append(types.Content(role="user", parts=[types.Part.from_text(text=injected_prompt)]))
        
        # --- MEMORY LEAK FIX: In-place deletion ---
        if len(history) > 10:
            del history[:-10] # Deletes items from the front of the list, keeping the memory reference safe

        # --- CAP OUTPUT TOKENS & PATCH 1: ASYNC GENERATION ---
        response = await client.aio.models.generate_content(
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
        
        # PATCH 1 (Audio): Internal Try/Except inside the generator to catch TTS network drops
        async def audio_stream():
            try:
                communicate = edge_tts.Communicate(spoken_text, voice)
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        yield chunk["data"]
            except Exception as stream_error:
                print(f"TTS Stream interrupted: {stream_error}")
                # Roll back memory so the AI doesn't remember a failed message
                if history and history[-1].role == "model":
                    history.pop()
                if history and history[-1].role == "user":
                    history.pop()

        # PATCH 3: Hard limit the header size to prevent 431 Server Crashes
        header_text = response.text
        if len(header_text) > 1000:
            header_text = header_text[:1000] + "..."
            
        # Encode the text safely so it can travel inside an HTTP header
        encoded_text = urllib.parse.quote(header_text)

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
        
        # 1. If TTS/API crashed, remove the AI's unsent response first
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