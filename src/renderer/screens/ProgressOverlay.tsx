import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ELECTRON_BRIDGE_API } from 'src/constants';
import log from 'electron-log/renderer';
import { ElectronAPI } from 'src/preload';
import AnimatedLogDisplay from './LogDisplay';

const loadingTextStyle: React.CSSProperties = {
  marginBottom: '20px',
  textAlign: 'center',
  fontSize: '20px',
  fontWeight: 'bold',
};

export interface ProgressUpdate {
  status: string;
  overwrite?: boolean;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '100%',
  padding: '20px',
};

const logContainerStyle: React.CSSProperties = {
  width: '50%',
  height: '120px',
  overflowY: 'auto',
  marginTop: '20px',
  padding: '10px',
  backgroundColor: '#1e1e1e',
  borderRadius: '5px',
  fontFamily: "'Roboto Mono', monospace",
  fontSize: '14px',
  lineHeight: '1.5',
  color: '#e0e0e0',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
};

function ProgressOverlay(): React.ReactElement {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');
  const [logs, setLogs] = useState<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const currentStatusRef = useRef(status);

  const updateProgress = useCallback(({ status: newStatus, overwrite = false }: ProgressUpdate) => {
    log.info(`Updating progress: ${newStatus}, overwrite: ${overwrite}`);

    if (newStatus !== currentStatusRef.current) {
      setStatus(newStatus);
      currentStatusRef.current = newStatus;
      setLogs([]); // Clear logs when status changes
    }
  }, [progress]);

  const addLogMessage = useCallback((message: string) => {
    setLogs(prevLogs => [...prevLogs, message]);
  }, []);

  useEffect(() => {
    if (ELECTRON_BRIDGE_API in window) {
      const electronApi: ElectronAPI = (window as any)[ELECTRON_BRIDGE_API];
      log.info(`${ELECTRON_BRIDGE_API} found, setting up listeners`);

      electronApi.onProgressUpdate(updateProgress);

      electronApi.onLogMessage((message: string) => {
        log.info(`Received log message: ${message}`);
        addLogMessage(message);
      });
    } else {
      log.error(`${ELECTRON_BRIDGE_API} not found in window object`);
    }
  }, [updateProgress, addLogMessage]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div style={containerStyle}>
      <div style={loadingTextStyle} id="loading-text">
        {status}
      </div>
      <div style={logContainerStyle} ref={logContainerRef}>
        <AnimatedLogDisplay logs={logs} />
      </div>
    </div>
  );
}

export default ProgressOverlay;
