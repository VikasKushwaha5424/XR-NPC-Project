import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useTelemetry } from './hooks/useTelemetry';
import TelemetryHUD from './components/TelemetryHUD';
import './App.css';

function App() {
  // --- UI STATE ---
  const [activeNpc, setActiveNpc] = useState('maya');
  const [inputText, setInputText] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // --- TELEMETRY STATE ---
  const telemetry = useTelemetry();

  const npcDetails = {
    maya: { name: 'Maya (The Guide)', color: '#4CAF50' },
    turing: { name: 'Dr. Turing (Expert)', color: '#2196F3' },
    silas: { name: 'Silas (Adversary)', color: '#f44336' },
  };

  // --- SPEECH TO TEXT LOGIC (Optimized) ---
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition && !recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        telemetry.setStatus({ state: 'LISTENING', color: '🟡', text: 'Mic Active' });
        telemetry.logEvent('INFO', 'STT', 'Microphone active. Listening for input...');
      };
      
      recognition.onend = () => {
        setIsListening(false);
      };
      
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        telemetry.logEvent('INFO', 'STT', `Transcribed: "${transcript}"`);
      };

      recognition.onerror = (event) => {
        telemetry.setStatus({ state: 'ERROR', color: '🔴', text: 'Mic Error' });
        telemetry.logEvent('FATAL', 'HARDWARE', `Microphone error: ${event.error}`);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const toggleListen = () => {
    if (!recognitionRef.current) {
      alert("Your browser does not support Speech Recognition. Please use Google Chrome or Microsoft Edge.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      telemetry.setStatus({ state: 'IDLE', color: '🟢', text: 'Ready' });
    } else {
      // CHECKPOINT 1: Ingestion Gate
      telemetry.setStatus({ state: 'LISTENING', color: '🟡', text: 'Requesting Mic...' });
      recognitionRef.current.start();
    }
  };

  // --- MAIN INTERACTION LOOP ---
  const sendMessage = async (e) => {
    if (e) e.preventDefault();

    // MICRO-TRAP 2: State Collision Guard
    if (telemetry.status.state !== 'IDLE' && telemetry.status.state !== 'LISTENING') {
      telemetry.logEvent('WARN', 'STATE', 'Ignored input. System is currently locked.');
      return;
    }

    // MICRO-TRAP 1: Transcription / Empty Check
    if (!inputText.trim()) {
      // PATCH 3: Fix "Stuck State"
      telemetry.setStatus({ state: 'IDLE', color: '🟢', text: 'Ready' });
      telemetry.logEvent('WARN', 'STT', 'Input was empty. Aborting.');
      return;
    }

    // 1. Update UI with User Message (Keep input text intact until success)
    const userMessage = { sender: 'user', text: inputText, npc: activeNpc };
    setChatHistory((prev) => [...prev, userMessage]);
    setIsThinking(true);
    
    // PATCH 2: Initialize Audio context synchronously attached to the user's click
    const audioPlayer = new Audio(); 

    // CHECKPOINT 2: Network Handshake
    telemetry.setStatus({ state: 'PROCESSING', color: '🔵', text: 'AI Processing...' });
    telemetry.logEvent('INFO', 'NETWORK', `Sending payload to ${npcDetails[activeNpc].name}...`);

    try {
      const response = await axios.post('http://127.0.0.1:8000/generate', {
        text: userMessage.text,
        npc_id: activeNpc,
      }, {
        timeout: 8000, 
        responseType: 'blob' 
      });

      // CHECKPOINT 4: Data Integrity (Stream Trap)
      telemetry.setStatus({ state: 'RECEIVING', color: '🟣', text: 'Stream Connected' });
      const audioBlob = response.data;
      if (audioBlob.size === 0) throw new Error("STREAM_EMPTY");

      // MICRO-TRAP 3: Mime-Type Check
      const contentType = response.headers['content-type'];
      if (contentType && contentType.includes('application/json')) throw new Error("STREAM_IS_JSON");

      telemetry.logEvent('INFO', 'STREAM', `Received verified audio blob: ${audioBlob.size} bytes`);

      // 2. Decode header text and update Chat UI
      const encodedText = response.headers['x-npc-response'] || '';
      const decodedText = decodeURIComponent(encodedText);
      const aiMessage = { sender: 'ai', text: decodedText || "[Audio Response]", npc: activeNpc };
      
      // PATCH 1: Only clear text box AFTER successful response
      setInputText('');
      setChatHistory((prev) => [...prev, aiMessage]);

      // CHECKPOINT 5: Speaker Execution
      const audioUrl = URL.createObjectURL(audioBlob);
      audioPlayer.src = audioUrl; // Feed the blob into the pre-approved audio player

      audioPlayer.onplay = () => {
        telemetry.setStatus({ state: 'SPEAKING', color: '🟢', text: 'Speaker Active' });
        telemetry.logEvent('INFO', 'SPEAKER', 'Audio playback started natively.');
        setIsThinking(false);
      };

      audioPlayer.onended = () => {
        telemetry.setStatus({ state: 'IDLE', color: '🟢', text: 'Ready' });
        telemetry.logEvent('INFO', 'STATE', 'Interaction complete. Returning to Idle.');
        URL.revokeObjectURL(audioUrl); 
      };

      audioPlayer.play().catch(err => {
        telemetry.setStatus({ state: 'ERROR', color: '🟠', text: 'Playback Blocked' });
        telemetry.logEvent('WARN', 'SPEAKER', 'Browser autoplay blocked. User click required.');
        setIsThinking(false);
      });

    } catch (error) {
      // CHECKPOINT 3 & ERROR HANDLING
      console.error("API Error:", error);
      setIsThinking(false);
      telemetry.setStatus({ state: 'ERROR', color: '🔴', text: 'API Failure' });
      
      let errorText = "Connection error. Is the backend running?";
      
      if (error.code === 'ECONNABORTED') {
        telemetry.logEvent('FATAL', 'NETWORK', 'Backend unreachable (Timeout).');
      } else if (error.response?.status === 429) {
        telemetry.logEvent('WARN', 'API', 'Gemini Token Quota Exhausted.');
        errorText = "AI Quota Exhausted. Switching to Offline Mode.";
      } else if (error.message === "STREAM_EMPTY") {
        telemetry.logEvent('FATAL', 'STREAM', 'Received 0-byte audio file.');
      } else if (error.message === "STREAM_IS_JSON") {
        telemetry.logEvent('FATAL', 'STREAM', 'Expected audio but received JSON error stack.');
      } else {
        telemetry.logEvent('FATAL', 'API', `Backend error: ${error.message}`);
      }

      const errorMessage = { sender: 'ai', text: errorText, npc: activeNpc };
      setChatHistory((prev) => [...prev, errorMessage]);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>XR-NPC Neural Link Prototype</h1>
        <div className="npc-selector">
          {Object.keys(npcDetails).map((npcKey) => (
            <button
              key={npcKey}
              className={`tab-button ${activeNpc === npcKey ? 'active' : ''}`}
              style={{ borderBottomColor: activeNpc === npcKey ? npcDetails[npcKey].color : 'transparent' }}
              onClick={() => setActiveNpc(npcKey)}
            >
              {npcDetails[npcKey].name}
            </button>
          ))}
        </div>
      </header>

      <main className="chat-window">
        <div className="messages-container">
          {chatHistory.filter(msg => msg.npc === activeNpc).length === 0 && (
            <div className="empty-state">Start a conversation with {npcDetails[activeNpc].name}...</div>
          )}
          
          {chatHistory.filter(msg => msg.npc === activeNpc).map((msg, index) => (
            <div key={index} className={`message-bubble ${msg.sender}`}>
              <strong>{msg.sender === 'user' ? 'You' : npcDetails[activeNpc].name}: </strong>
              <span>{msg.text}</span>
            </div>
          ))}
          {isThinking && <div className="message-bubble ai thinking">Thinking...</div>}
        </div>

        <form className="input-area" onSubmit={sendMessage}>
          {/* Microphone Button */}
          <button 
            type="button" 
            className={`mic-button ${isListening ? 'listening' : ''}`} 
            onClick={toggleListen}
            title="Click to Speak"
            disabled={isThinking}
          >
            {isListening ? '🎙️ Listening...' : '🎤'}
          </button>
          
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Message ${npcDetails[activeNpc].name}...`}
            disabled={isThinking}
          />
          <button type="submit" disabled={isThinking || !inputText.trim()}>
            Send
          </button>
        </form>
      </main>

      {/* --- TELEMETRY TERMINAL OVERLAY --- */}
      <TelemetryHUD status={telemetry.status} logs={telemetry.logs} />
    </div>
  );
}

export default App;