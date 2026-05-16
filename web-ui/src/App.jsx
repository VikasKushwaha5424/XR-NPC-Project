import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useTelemetry } from './hooks/useTelemetry';
import TelemetryHUD from './components/TelemetryHUD';
import MicWaveform from './components/MicWaveform'; // <-- NEW IMPORT
import './App.css';

function App() {
  // --- UI STATE ---
  const [activeNpc, setActiveNpc] = useState('maya');
  const [inputText, setInputText] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false); // <-- NEW STATE FOR EQUALIZER
  const [worldState, setWorldState] = useState('The user is standing in a standard virtual room.');

  // --- TELEMETRY STATE ---
  const telemetry = useTelemetry();

  const npcDetails = {
    maya: { name: 'Maya (The Guide)', color: '#4CAF50' },
    turing: { name: 'Dr. Turing (Expert)', color: '#2196F3' },
    silas: { name: 'Silas (Adversary)', color: '#f44336' },
  };

  // --- SPEECH TO TEXT LOGIC ---
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
  }, []);

  const toggleListen = () => {
    if (!recognitionRef.current) {
      alert("Your browser does not support Speech Recognition.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      telemetry.setStatus({ state: 'IDLE', color: '🟢', text: 'Ready' });
    } else {
      telemetry.setStatus({ state: 'LISTENING', color: '🟡', text: 'Requesting Mic...' });
      recognitionRef.current.start();
    }
  };

  // --- RESET MEMORY LOGIC ---
  const handleReset = async () => {
    try {
      telemetry.logEvent('INFO', 'SYSTEM', `Requesting memory wipe for ${activeNpc.toUpperCase()}...`);
      await axios.post('http://127.0.0.1:8000/reset', {
        npc_id: activeNpc,
        session_id: 'default_user'
      });
      
      // Clear the local React chat UI for this specific NPC
      setChatHistory((prev) => prev.filter(msg => msg.npc !== activeNpc));
      telemetry.resetMetrics(); // NEW: Reset latency and token counts
      telemetry.logEvent('INFO', 'SYSTEM', `Memory wiped successfully.`);
    } catch (error) {
      telemetry.logEvent('FATAL', 'SYSTEM', `Failed to wipe memory: ${error.message}`);
    }
  };

  // --- MAIN INTERACTION LOOP ---
  const sendMessage = async (e) => {
    if (e) e.preventDefault();

    if (telemetry.status.state !== 'IDLE' && telemetry.status.state !== 'LISTENING') {
      telemetry.logEvent('WARN', 'STATE', 'Ignored input. System is currently locked.');
      return;
    }

    if (!inputText.trim()) {
      telemetry.setStatus({ state: 'IDLE', color: '🟢', text: 'Ready' });
      return;
    }

    const userMessage = { sender: 'user', text: inputText, npc: activeNpc };
    setChatHistory((prev) => [...prev, userMessage]);
    setIsThinking(true);
    
    const audioPlayer = new Audio(); 

    telemetry.setStatus({ state: 'PROCESSING', color: '🔵', text: 'AI Processing...' });
    telemetry.logEvent('INFO', 'NETWORK', `Sending payload to ${npcDetails[activeNpc].name}...`);

    // START THE TIMER AND TOKEN ESTIMATION BEFORE AXIOS CALL
    const requestStartTime = Date.now();
    const estimatedUserTokens = Math.ceil(inputText.length / 4);

    try {
      // Notice we are now sending the dynamic world_state
      const response = await axios.post('http://127.0.0.1:8000/generate', {
        text: userMessage.text,
        npc_id: activeNpc,
        world_state: worldState,
        session_id: "default_user"
      }, {
        timeout: 8000, 
        responseType: 'blob' 
      });

      telemetry.setStatus({ state: 'RECEIVING', color: '🟣', text: 'Stream Connected' });
      const audioBlob = response.data;
      if (audioBlob.size === 0) throw new Error("STREAM_EMPTY");

      const contentType = response.headers['content-type'];
      if (contentType && contentType.includes('application/json')) throw new Error("STREAM_IS_JSON");

      telemetry.logEvent('INFO', 'STREAM', `Received verified audio blob: ${audioBlob.size} bytes`);

      const encodedText = response.headers['x-npc-response'] || '';
      const decodedText = decodeURIComponent(encodedText);
      const aiMessage = { sender: 'ai', text: decodedText || "[Audio Response]", npc: activeNpc };
      
      setInputText('');
      setChatHistory((prev) => [...prev, aiMessage]);

      const audioUrl = URL.createObjectURL(audioBlob);
      audioPlayer.src = audioUrl; 

      audioPlayer.onplay = () => {
        // --- NEW METRICS CALCULATION ---
        const latencyMs = Date.now() - requestStartTime;
        telemetry.updateLatency(latencyMs);

        const estimatedAiTokens = Math.ceil(decodedText.length / 4);
        telemetry.addTokens(estimatedUserTokens + estimatedAiTokens);
        // ---------------------------------

        telemetry.setStatus({ state: 'SPEAKING', color: '🟢', text: 'Speaker Active' });
        telemetry.logEvent('INFO', 'SPEAKER', `Audio playing. Latency: ${latencyMs}ms`);
        setIsThinking(false);
        setIsPlaying(true); // <-- TURN ON VISUALIZER
      };

      audioPlayer.onended = () => {
        telemetry.setStatus({ state: 'IDLE', color: '🟢', text: 'Ready' });
        telemetry.logEvent('INFO', 'STATE', 'Interaction complete.');
        URL.revokeObjectURL(audioUrl); 
        setIsPlaying(false); // <-- TURN OFF VISUALIZER
      };

      audioPlayer.play().catch(err => {
        telemetry.setStatus({ state: 'ERROR', color: '🟠', text: 'Playback Blocked' });
        telemetry.logEvent('WARN', 'SPEAKER', 'Browser autoplay blocked.');
        setIsThinking(false);
        setIsPlaying(false); // <-- FAILSAFE
      });

    } catch (error) {
      console.error("API Error:", error);
      setIsThinking(false);
      setIsPlaying(false); // <-- FAILSAFE: Make sure equalizer turns off on error
      telemetry.setStatus({ state: 'ERROR', color: '🔴', text: 'API Failure' });
      
      let errorText = "Connection error. Is the backend running?";
      if (error.response?.status === 429) {
        errorText = "AI Quota Exhausted. Switching to Offline Mode.";
      }
      const errorMessage = { sender: 'ai', text: errorText, npc: activeNpc };
      setChatHistory((prev) => [...prev, errorMessage]);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>XR-NPC Developer Dashboard</h1>
      </header>

      <div className="dashboard-grid">
        
        {/* LEFT SIDEBAR: CONFIGURATION */}
        <aside className="sidebar left-sidebar">
          <h3>Target Identity</h3>
          <div className="npc-selector">
            {Object.keys(npcDetails).map((npcKey) => (
              <button
                key={npcKey}
                className={`tab-button ${activeNpc === npcKey ? 'active' : ''}`}
                style={{ borderLeftColor: activeNpc === npcKey ? npcDetails[npcKey].color : 'transparent' }}
                onClick={() => setActiveNpc(npcKey)}
              >
                {npcDetails[npcKey].name}
              </button>
            ))}
          </div>

          <h3 className="section-title">Environment Override</h3>
          <textarea 
            className="world-state-input"
            value={worldState}
            onChange={(e) => setWorldState(e.target.value)}
            placeholder="Describe the VR environment..."
          />

          <h3 className="section-title">Session Controls</h3>
          <button className="danger-button" onClick={handleReset}>
            ⚠️ Wipe {npcDetails[activeNpc].name}'s Memory
          </button>
        </aside>

        {/* CENTER PANE: ACTIVE CONSOLE */}
        <main className="chat-window">
          <div className="messages-container">
            {chatHistory.filter(msg => msg.npc === activeNpc).length === 0 && (
              <div className="empty-state">System ready. Awaiting input for {npcDetails[activeNpc].name}...</div>
            )}
            
            {/* UPDATED: Chat map now checks for the last AI message to attach the equalizer */}
            {chatHistory.filter(msg => msg.npc === activeNpc).map((msg, index, arr) => {
              const isLastAiMessage = msg.sender === 'ai' && index === arr.length - 1;
              
              return (
                <div key={index} className={`message-bubble ${msg.sender}`}>
                  <strong>{msg.sender === 'user' ? 'You' : npcDetails[activeNpc].name}: </strong>
                  <span>{msg.text}</span>
                  
                  {/* PLAYBACK EQUALIZER: Uses a CSS variable to match the NPC's theme color! */}
                  {isLastAiMessage && isPlaying && (
                    <span className="equalizer" style={{ '--eq-color': npcDetails[activeNpc].color }}>
                      <span className="equalizer-bar"></span>
                      <span className="equalizer-bar"></span>
                      <span className="equalizer-bar"></span>
                    </span>
                  )}
                </div>
              );
            })}
            {isThinking && <div className="message-bubble ai thinking">Processing neural response...</div>}
          </div>

          <form className="input-area" onSubmit={sendMessage}>
            <button 
              type="button" 
              className={`mic-button ${isListening ? 'listening' : ''}`} 
              onClick={toggleListen}
              title="Click to Speak"
              disabled={isThinking}
            >
              {/* REPLACED THE TEXT WITH OUR NEW NATIVE WAVEFORM COMPONENT */}
              {isListening ? <MicWaveform isListening={isListening} /> : '🎤'}
            </button>
            
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Send payload to ${npcDetails[activeNpc].name}...`}
              disabled={isThinking}
            />
            <button type="submit" disabled={isThinking || !inputText.trim()}>
              TRANSMIT
            </button>
          </form>
        </main>

        {/* RIGHT SIDEBAR: TELEMETRY */}
        <aside className="sidebar right-sidebar">
          <h3>Live Telemetry</h3>
          <div className="telemetry-wrapper">
            {/* UPDATED: Passing the metrics state into the TelemetryHUD */}
            <TelemetryHUD status={telemetry.status} logs={telemetry.logs} metrics={telemetry.metrics} />
          </div>
        </aside>

      </div>
    </div>
  );
}

export default App;