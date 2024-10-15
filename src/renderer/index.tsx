import React, { useEffect, useState, useCallback } from 'react';
import ProgressOverlay from './screens/ProgressOverlay';
import log from 'electron-log/renderer';
import FirstTimeSetup from './screens/FirstTimeSetup';
import { ElectronAPI } from 'src/preload';
import { ELECTRON_BRIDGE_API } from 'src/constants';

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

// Main entry point for the front end renderer.
// Currently this serves as the overlay to show progress as the comfy backend is coming online.
// after coming online the main.ts will replace the renderer with comfy's internal index.html
const Home: React.FC = () => {
  const [showSetup, setShowSetup] = useState<boolean | null>(null);

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
  }, []);

  if (showSetup === null) {
    return <> Loading ....</>;
  }

  if (showSetup) {
    return (
      <div style={bodyStyle}>
        <FirstTimeSetup onComplete={() => setShowSetup(false)} />
      </div>
    );
  }

  return (
    <div style={bodyStyle}>
      <ProgressOverlay />
    </div>
  );
};

export default Home;
