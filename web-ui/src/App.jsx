import { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [activeNpc, setActiveNpc] = useState('maya');
  const [inputText, setInputText] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isThinking, setIsThinking] = useState(false);

  // NPC styling and naming logic
  const npcDetails = {
    maya: { name: 'Maya (The Guide)', color: '#4CAF50' },
    turing: { name: 'Dr. Turing (Expert)', color: '#2196F3' },
    silas: { name: 'Silas (Adversary)', color: '#f44336' },
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMessage = { sender: 'user', text: inputText, npc: activeNpc };
    setChatHistory((prev) => [...prev, userMessage]);
    setInputText('');
    setIsThinking(true);

    try {
      const response = await axios.post('http://127.0.0.1:8000/generate', {
        text: userMessage.text,
        npc_id: activeNpc,
      });

      const aiMessage = { sender: 'ai', text: response.data.response, npc: activeNpc };
      setChatHistory((prev) => [...prev, aiMessage]);
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