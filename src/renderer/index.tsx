import React, { useEffect, useState, useCallback } from 'react';
import ProgressOverlay from './screens/ProgressOverlay';
import log from 'electron-log/renderer';
import FirstTimeSetup from './screens/FirstTimeSetup';
import { ElectronAPI } from 'src/preload';
import { ELECTRON_BRIDGE_API } from 'src/constants';
import LogViewer from './screens/LogViewer';

export interface ProgressUpdate {
  status: string;
  overwrite?: boolean;
}

const bodyStyle: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100vh',
  margin: '0',
  color: '#d4d4d4',
  backgroundColor: '#1e1e1e',
};

const iframeStyle: React.CSSProperties = {
  flexGrow: 1,
  border: 'none',
};

const logContainerStyle: React.CSSProperties = {
  height: '300px',
};

const iframeContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  margin: '0',
  padding: '0',
};

// Main entry point for the front end renderer.
// Currently this serves as the overlay to show progress as the comfy backend is coming online.
// after coming online the main.ts will replace the renderer with comfy's internal index.html
const Home: React.FC = () => {
  const [showSetup, setShowSetup] = useState<boolean | null>(null);
  const [status, setStatus] = useState('Starting...');
  const [logs, setLogs] = useState<string[]>([]);
  const [defaultInstallLocation, setDefaultInstallLocation] = useState<string>('');
  const [showStreamingLogs, setShowStreamingLogs] = useState(false);
  const [comfyReady, setComfyReady] = useState(false);
  const [comfyPort, setComfyPort] = useState<number | null>(null);
  const updateProgress = useCallback(({ status: newStatus }: ProgressUpdate) => {
    log.info(`Setting new status: ${newStatus}`);
    setStatus(newStatus);
    setLogs([]); // Clear logs when status changes
  }, []);

  const addLogMessage = useCallback((message: string) => {
    setLogs((prevLogs) => [...prevLogs, message]);
  }, []);

  useEffect(() => {
    const electronAPI: ElectronAPI = (window as any)[ELECTRON_BRIDGE_API];

    log.info(`Sending ready event from renderer`);
    electronAPI.sendReady();

    electronAPI.onShowSelectDirectory(() => {
      log.info('Showing select directory');
      setShowSetup(true);
    });

    electronAPI.onFirstTimeSetupComplete(() => {
      log.info('First time setup complete');
      setShowSetup(false);
    });

    electronAPI.onToggleLogsView(() => {
      log.info('Toggling logs view');
      setShowStreamingLogs((prevState) => !prevState);
    });

    electronAPI.onComfyUIReady((port: number) => {
      log.info('ComfyUI ready');
      setComfyPort(port);
      setComfyReady(true);
    });
  }, []);

  useEffect(() => {
    const electronAPI: ElectronAPI = (window as any)[ELECTRON_BRIDGE_API];

    electronAPI.onProgressUpdate(updateProgress);

    electronAPI.onLogMessage((message: string) => {
      log.info(`Received log message: ${message}`);
      addLogMessage(message);
    });
  }, [updateProgress, addLogMessage, setComfyPort]);

  useEffect(() => {
    const electronAPI: ElectronAPI = (window as any)[ELECTRON_BRIDGE_API];

    electronAPI.onDefaultInstallLocation((location: string) => {
      setDefaultInstallLocation(location);
    });
  }, []);

  if (showSetup === null) {
    return <> Loading ....</>;
  }

  if (showSetup) {
    return (
      <div style={bodyStyle}>
        <FirstTimeSetup onComplete={() => setShowSetup(false)} initialPath={defaultInstallLocation} />
      </div>
    );
  }

  if (comfyReady && comfyPort) {
    return (
      <div style={iframeContainerStyle}>
        <iframe id="comfy-container" style={iframeStyle} src={`http://localhost:${comfyPort}`}></iframe>
        {showStreamingLogs && (
          <div style={logContainerStyle}>
            <LogViewer onClose={() => setShowStreamingLogs(false)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={bodyStyle}>
      <ProgressOverlay status={status} logs={logs} />
    </div>
  );
};

export default Home;
