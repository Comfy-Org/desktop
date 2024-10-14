import React, { useState } from 'react';
import { ElectronAPI } from 'src/preload';
import log from 'electron-log/renderer';

interface FirstTimeSetupProps {
  onComplete: (selectedDirectory: string) => void;
}

const FirstTimeSetup: React.FC<FirstTimeSetupProps> = ({ onComplete }) => {
  const [selectedPath, setSelectedPath] = useState<string>('');
  const electronAPI: ElectronAPI = (window as any).electronAPI;

  const handleDirectorySelect = async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select a directory',
      properties: ['openDirectory', 'createDirectory'],
    };
    const directory = await electronAPI.openDialog(options);
    if (directory && directory.length > 0) {
      log.info('Selected directory', directory[0]);
      setSelectedPath(directory[0]);
    } else {
      log.error('No directory selected');
    }
  };

  const handleInstall = () => {
    if (selectedPath) {
      log.info('Installing to directory', selectedPath);
      electronAPI.selectSetupDirectory(selectedPath);
      onComplete(selectedPath);
    } else {
      log.error('No directory selected for installation');
      alert('Please select a directory before installing.');
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Install ComfyUI</h1>
      <p style={styles.description}>
        Please select a directory for where ComfyUI will store models, outputs, etc.
        If you already have a ComfyUI setup, you can select that to reuse the model files.
      </p>
      <button onClick={handleDirectorySelect} style={styles.button}>Select Directory</button>
      {selectedPath && (
        <div style={styles.pathDisplay}>
          <p>Selected path: {selectedPath}</p>
        </div>
      )}
      <button
        onClick={handleInstall}
        disabled={!selectedPath}
        style={{ ...styles.button, ...(selectedPath ? styles.installButton : styles.disabledButton) }}
      >
        Install
      </button>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '20px',
    maxWidth: '600px',
    margin: '0 auto',
  },
  title: {
    fontSize: '24px',
    marginBottom: '20px',
  },
  description: {
    textAlign: 'center' as const,
    marginBottom: '20px',
  },
  button: {
    padding: '10px 20px',
    fontSize: '16px',
    cursor: 'pointer',
    marginBottom: '10px',
  },
  pathDisplay: {
    marginTop: '10px',
    marginBottom: '20px',
    padding: '10px',
    backgroundColor: '#f0f0f0',
    borderRadius: '5px',
    width: '100%',
  },
  installButton: {
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
  },
  disabledButton: {
    backgroundColor: '#cccccc',
    color: '#666666',
    cursor: 'not-allowed',
  },
};

export default FirstTimeSetup;
