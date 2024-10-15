import React, { useEffect, useState, useCallback } from 'react';
import { COMFY_ERROR_MESSAGE, COMFY_FINISHING_MESSAGE, ELECTRON_BRIDGE_API } from 'src/constants';
import log from 'electron-log/renderer';
import { ElectronAPI } from 'src/preload';
import AnimatedLogDisplay from './AnimatedLogDisplay';

const loadingTextStyle: React.CSSProperties = {
  marginBottom: '20px',
  textAlign: 'center',
  fontSize: '20px',
  fontFamily: 'sans-serif, monospace',
  fontWeight: 'bold',
};

export interface ProgressUpdate {
  status: string;
  overwrite?: boolean;
}

const outerContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100vh',
  overflow: 'hidden',
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center', // Center vertically
  width: '100%',
  height: '100%',
  overflow: 'scroll',
  padding: '20px',
};

const logContainerStyle: React.CSSProperties = {
  width: '50%',
  height: '120px',
  overflowY: 'hidden',
  marginTop: '20px',
  padding: '10px',
  backgroundColor: '#1e1e1e',
  borderRadius: '5px',
  fontFamily: "'Roboto Mono', monospace",
  fontSize: '14px',
  lineHeight: '1.5',
  color: '#9198a1',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
};

function ProgressOverlay(): React.ReactElement {
  const [status, setStatus] = useState('Starting...');
  const [logs, setLogs] = useState<string[]>([]);

  const updateProgress = useCallback(({ status: newStatus }: ProgressUpdate) => {
    log.info(`Setting new status: ${newStatus}`);
    setStatus(newStatus);
    setLogs([]); // Clear logs when status changes
  }, []);

  const addLogMessage = useCallback((message: string) => {
    setLogs((prevLogs) => [...prevLogs, message]);
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

  // Send ready event to main process
  useEffect(() => {
    if (ELECTRON_BRIDGE_API in window) {
      log.info(`Sending ready event from renderer`);
      (window as any).electronAPI.sendReady();
    }
  }, []);

  return (
    <div style={outerContainerStyle}>
      <div style={containerStyle}>
        <div style={loadingTextStyle} id="loading-text">
          {status}
        </div>
        <div style={logContainerStyle}>
          {status !== COMFY_FINISHING_MESSAGE && status !== COMFY_ERROR_MESSAGE && <AnimatedLogDisplay logs={logs} />}
        </div>
      </div>
    </div>
  );
}

export default ProgressOverlay;
