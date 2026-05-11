import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [activeNpc, setActiveNpc] = useState('maya');
  const [inputText, setInputText] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false); // Microphone state

  const npcDetails = {
    maya: { name: 'Maya (The Guide)', color: '#4CAF50' },
    turing: { name: 'Dr. Turing (Expert)', color: '#2196F3' },
    silas: { name: 'Silas (Adversary)', color: '#f44336' },
  };

  // --- SPEECH TO TEXT LOGIC ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = SpeechRecognition ? new SpeechRecognition() : null;

  if (recognition) {
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInputText(transcript); // Puts your spoken words into the text box
    };
  }

  const toggleListen = () => {
    if (!recognition) {
      alert("Your browser does not support Speech Recognition. Please use Google Chrome or Microsoft Edge.");
      return;
    }
    isListening ? recognition.stop() : recognition.start();
  };
  // ---------------------------------

  const sendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const userMessage = { sender: 'user', text: inputText, npc: activeNpc };
    setChatHistory((prev) => [...prev, userMessage]);
    setInputText('');
    setIsThinking(true);

    try {
      // Tell Axios we are expecting a raw binary file stream, not JSON
      const response = await axios.post('http://127.0.0.1:8000/generate', {
        text: userMessage.text,
        npc_id: activeNpc,
      }, {
        responseType: 'blob' 
      });

      // 1. Extract the text from the custom HTTP Header
      const encodedText = response.headers['x-npc-response'];
      const decodedText = decodeURIComponent(encodedText);

      const aiMessage = { sender: 'ai', text: decodedText, npc: activeNpc };
      setChatHistory((prev) => [...prev, aiMessage]);

      // 2. Play the raw binary audio stream instantly
      const audioUrl = URL.createObjectURL(response.data);
      const audio = new Audio(audioUrl);
      audio.play();

    } catch (error) {
      console.error("API Error:", error);
      const errorMessage = { sender: 'ai', text: "Connection error. Is the backend running?", npc: activeNpc };
      setChatHistory((prev) => [...prev, errorMessage]);
    } finally {
      setIsThinking(false);
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
    </div>
  );
}

export default App;