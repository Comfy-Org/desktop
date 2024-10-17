import React, { useState } from 'react';
import { ElectronAPI } from 'src/preload';
import log from 'electron-log/renderer';

interface FirstTimeSetupProps {
  onComplete: (selectedDirectory: string) => void;
  initialPath: string;
}

const FirstTimeSetup: React.FC<FirstTimeSetupProps> = ({ onComplete, initialPath }) => {
  const [selectedPath, setSelectedPath] = useState<string>(initialPath);
  const electronAPI: ElectronAPI = (window as any).electronAPI;

  const handleDirectoryChange = async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select a directory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: selectedPath,
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
      <>
        <p style={styles.description}>
          Select a directory for where ComfyUI will store models, outputs, and custom nodes. If you already have a
          ComfyUI setup, you can select that to reuse your existing model files eg. 'C:/Users/comfyanonymous/ComfyUI'.
          Custom nodes will need to be re-installed.
        </p>
        <p style={styles.description}>Otherwise, we will create a ComfyUI directory for you.</p>
      </>
      <div style={styles.directoryContainer}>
        <div style={styles.pathDisplay}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="size-6"
            style={styles.folderIcon}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            />
          </svg>
          <p style={styles.pathText}>{selectedPath}</p>
        </div>
        <button onClick={handleDirectoryChange} style={styles.changePathButton}>
          Change
        </button>
      </div>

      <div style={styles.buttonContainer}>
        <button onClick={handleInstall} style={styles.installButton}>
          Install
        </button>
      </div>
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
    justifyContent: 'center',
  },
  title: {
    fontSize: '24px',
    marginBottom: '20px',
    color: '#ffffff',
  },
  description: {
    textAlign: 'center' as const,
    marginBottom: '20px',
    lineHeight: '1.5',
  },
  button: {
    padding: '10px 20px',
    fontSize: '14px',
    cursor: 'pointer',
    marginBottom: '10px',
    borderRadius: '3px',
    border: 'none',
    fontWeight: 'bold',
  },
  selectButton: {
    padding: '10px 20px',
    fontSize: '14px',
    cursor: 'pointer',
    marginBottom: '10px',
    borderRadius: '3px',
    border: 'none',
    fontWeight: 'bold',
    backgroundColor: '#60a5fa',
    color: '#ffffff',
  },
  directoryContainer: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginBottom: '20px',
    marginTop: '10px',
  },
  pathDisplay: {
    padding: '10px',
    backgroundColor: '#2d2d2d',
    borderRadius: '3px',
    width: '100%',
    color: '#d4d4d4',
    textAlign: 'center' as const,
    display: 'flex',
    alignItems: 'center' as const,
  },
  folderIcon: {
    width: '24px',
    height: '24px',
    marginRight: '10px',
    flexShrink: 0,
  },
  pathText: {
    margin: 0,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  installButton: {
    padding: '10px 20px',
    fontSize: '14px',
    cursor: 'pointer',
    borderRadius: '3px',
    border: 'none',
    fontWeight: 'bold',
    backgroundColor: '#4CAF50',
    color: '#ffffff',
  },
  disabledButton: {
    backgroundColor: '#4d4d4d',
    color: '#a0a0a0',
    cursor: 'not-allowed',
  },
  buttonContainer: {
    display: 'flex',
    justifyContent: 'center',
    gap: '10px',
  },
  changePathButton: {
    backgroundColor: '#4d4d4d',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '10px 20px',
    fontSize: '14px',
    borderRadius: '3px',
    border: 'none',
    fontWeight: 'bold',
  },
};

export default FirstTimeSetup;
