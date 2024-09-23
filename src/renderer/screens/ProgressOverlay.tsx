import React, { useEffect } from 'react';
import { ELECTRON_BRIDGE_API } from 'src/constants';
import log from 'electron-log/renderer';

const loadingTextStyle: React.CSSProperties = {
  marginBottom: '20px',
  textAlign: 'center',
};

const progressBarStyle: React.CSSProperties = {
  width: '300px',
  height: '20px',
  backgroundColor: '#e0e0e0',
  borderRadius: '10px',
  overflow: 'hidden',
};

const progressStyle: React.CSSProperties = {
  width: '0%',
  height: '100%',
  backgroundColor: '#09f',
  transition: 'width 0.5s ease',
};

interface ProgressUpdate {
  percentage: number;
  status: string;
}

//Overlay that shows the progress bar
function ProgressOverlay(): React.ReactElement {
  function updateProgress({ percentage, status }: ProgressUpdate) {
    const progressBar = document.getElementById('progress') as HTMLElement;
    const loadingText = document.getElementById('loading-text') as HTMLElement;
    log.info(`Updating progress: ${percentage}%, ${status}`);
    progressBar.style.width = `${percentage}%`;
    loadingText.textContent = status;

    if (percentage === 100) {
      loadingText.textContent = 'ComfyUI is ready!';
    }
  }

  // Updates when internal items change
  useEffect(() => {
    if (ELECTRON_BRIDGE_API in window) {
      log.info(`${ELECTRON_BRIDGE_API} found, setting up listeners`);
      (window as any).electronAPI.onProgressUpdate((update: ProgressUpdate) => {
        log.info('Received loading progress', update);
        updateProgress(update);
      });
    } else {
      log.error(`${ELECTRON_BRIDGE_API} not found in window object`);
    }
  });

  useEffect(() => {
    if (ELECTRON_BRIDGE_API in window) {
      log.info(`Sending ready event from renderer`);
      (window as any).electronAPI.sendReady();
    }
  }, []);

  return (
    <>
      <div style={loadingTextStyle} id="loading-text">
        Initializing...
      </div>
      <div style={progressBarStyle} id="progress-bar">
        <div style={progressStyle} id="progress"></div>
      </div>
    </>
  );
}

export default ProgressOverlay;
