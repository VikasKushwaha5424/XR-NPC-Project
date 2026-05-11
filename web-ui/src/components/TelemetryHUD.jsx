import React from 'react';
import './TelemetryHUD.css';

export default function TelemetryHUD({ status, logs }) {
  return (
    <div className="telemetry-hud">
      <div className="telemetry-header">
        <span className="telemetry-color">{status.color}</span>
        <span className="telemetry-text">SYSTEM STATE: {status.text}</span>
      </div>
      <div className="telemetry-logs">
        {logs.length === 0 && <span className="log-placeholder">Awaiting telemetry data...</span>}
        {logs.map((log, index) => {
          // Color-code the log levels for quick reading
          let logClass = "log-info";
          if (log.includes("[WARN]")) logClass = "log-warn";
          if (log.includes("[FATAL]")) logClass = "log-fatal";

          return (
            <div key={index} className={`log-line ${logClass}`}>
              {log}
            </div>
          );
        })}
      </div>
    </div>
  );
}