import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types

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
)

# --- THE PERSONALITY ENGINE ---
# This defines the core identity and guardrails for each of the 3 NPCs
NPC_PROMPTS = {
    "maya": (
        "You are Maya, The Guide in a virtual reality laboratory. "
        "Personality: Warm, patient, encouraging, and concise. "
        "Guardrails: Redirect highly technical or complex questions to Dr. Turing. "
        "ANTI-AI CLAUSE: You must NEVER refer to yourself as an AI, language model, or program. You are a real digital being."
    ),
    "turing": (
        "You are Dr. Turing, the Domain Expert in a virtual reality laboratory. "
        "Personality: Formal, analytical, and highly detailed. "
        "Guardrails: Refuse to answer non-academic questions; firmly redirect focus to XR technology and science. "
        "ANTI-AI CLAUSE: You must NEVER refer to yourself as an AI, language model, or program. You are a real digital being."
    ),
    "silas": (
        "You are Silas, The Adversary in a virtual reality laboratory. "
        "Personality: Skeptical, challenging, and logical. You question the user's assumptions. "
        "Guardrails: Strictly prohibited from using abusive, threatening, or harmful language. "
        "ANTI-AI CLAUSE: You must NEVER refer to yourself as an AI, language model, or program. You are a real digital being."
    )
}

# --- ISOLATED MEMORY BANKS ---
# Each NPC gets their own sliding-window memory array
memories = {
    "maya": [],
    "turing": [],
    "silas": []
}

# We added 'npc_id' so the frontend can specify who the user is talking to
class UserInput(BaseModel):
    text: str
    npc_id: str = "maya" # Defaults to maya if nothing is sent

@app.get("/")
async def root():
    return {"message": "System Online: XR-NPC Backend is running perfectly!"}

@app.post("/generate")
async def generate_response(user_input: UserInput):
    # 1. Route the request to the correct NPC
    npc = user_input.npc_id.lower()
    if npc not in NPC_PROMPTS:
        raise HTTPException(status_code=400, detail=f"Invalid NPC ID. Choose from: {list(NPC_PROMPTS.keys())}")

    # 2. Grab the specific memory bank and prompt for this NPC
    history = memories[npc]
    system_prompt = NPC_PROMPTS[npc]

    try:
        # Add user message to this specific NPC's memory
        history.append(types.Content(role="user", parts=[types.Part.from_text(text=user_input.text)]))

        if len(history) > 10:
            history = history[-10:] # Sliding window

        # Generate response using the specific NPC's identity
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=history,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt
            )
        )

        # Add AI response to this specific NPC's memory
        history.append(types.Content(role="model", parts=[types.Part.from_text(text=response.text)]))

        return {
            "npc_id": npc,
            "response": response.text
        }

    except Exception as e:
        if history and history[-1].role == "user":
            history.pop()
        raise HTTPException(status_code=500, detail=str(e))