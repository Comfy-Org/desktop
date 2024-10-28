import React, { useEffect, useRef, useState } from 'react';
import LogViewer from './LogViewer';
import { ElectronAPI } from 'src/preload';
import { ELECTRON_BRIDGE_API } from 'src/constants';
import { WebviewTag } from 'electron';

interface ComfyUIContainerProps {
  comfyPort: number;
  preloadScript: string;
}

const iframeContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  margin: '0',
  padding: '0',
};

const iframeStyle: React.CSSProperties = {
  flexGrow: 1,
  border: 'none',
  width: '100%',
  height: '100%',
};

const logContainerStyle: React.CSSProperties = {
  height: '300px',
};

const ComfyUIContainer: React.FC<ComfyUIContainerProps> = ({ comfyPort, preloadScript }) => {
  const [showStreamingLogs, setShowStreamingLogs] = useState(false);
  const webviewRef = useRef<WebviewTag>(null);

  useEffect(() => {
    const electronAPI: ElectronAPI = (window as any)[ELECTRON_BRIDGE_API];

    electronAPI.onToggleLogsView(() => {
      setShowStreamingLogs((prevState) => !prevState);
    });
    electronAPI.onOpenDevTools(() => {
      webviewRef.current?.openDevTools();
    });
  }, []);

  return (
    <div style={iframeContainerStyle}>
      <webview
        id="comfy-container"
        src={`http://localhost:${comfyPort}`}
        style={iframeStyle}
        preload={`file://${preloadScript}`}
        ref={webviewRef}
      />
      {showStreamingLogs && (
        <div style={logContainerStyle}>
          <LogViewer onClose={() => setShowStreamingLogs(false)} />
        </div>
      )}
    </div>
  );
};

export default ComfyUIContainer;
