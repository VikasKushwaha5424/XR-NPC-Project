import { useState, useCallback } from 'react';

export function useTelemetry() {
  const [status, setStatus] = useState({ state: 'IDLE', color: '🟢', text: 'Ready' });
  const [logs, setLogs] = useState([]);

  const logEvent = useCallback((level, phase, message) => {
    // level: 'INFO', 'WARN', 'FATAL'
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 3); // Get HH:MM:SS.mmm
    
    setLogs(prev => {
      const newLog = `[${timestamp}] [${level}] [${phase}] ${message}`;
      const updatedLogs = [...prev, newLog];
      return updatedLogs.slice(-5); // Keep only the last 5 logs to prevent memory bloat
    });
  }, []);

  return { status, setStatus, logs, logEvent };
}