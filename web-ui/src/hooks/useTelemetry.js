import { useState, useCallback } from 'react';

export function useTelemetry() {
  const [status, setStatus] = useState({ state: 'IDLE', color: '🟢', text: 'Ready' });
  const [logs, setLogs] = useState([]);
  
  // NEW: State to track our advanced metrics
  const [metrics, setMetrics] = useState({ latency: 0, tokens: 0 });

  const logEvent = useCallback((level, phase, message) => {
    // FIX: slice(0, 12) correctly grabs the 'HH:MM:SS.mmm' portion
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12); 
    
    setLogs(prev => {
      const newLog = `[${timestamp}] [${level}] [${phase}] ${message}`;
      const updatedLogs = [...prev, newLog];
      return updatedLogs.slice(-10); // Expanded to keep the last 10 logs for better debugging
    });
  }, []);

  // NEW: Helper functions to update metrics cleanly
  const updateLatency = useCallback((ms) => {
    setMetrics(prev => ({ ...prev, latency: ms }));
  }, []);

  const addTokens = useCallback((count) => {
    setMetrics(prev => ({ ...prev, tokens: prev.tokens + count }));
  }, []);

  const resetMetrics = useCallback(() => {
    setMetrics({ latency: 0, tokens: 0 });
  }, []);

  return { 
    status, 
    setStatus, 
    logs, 
    logEvent, 
    metrics, 
    updateLatency, 
    addTokens, 
    resetMetrics 
  };
}