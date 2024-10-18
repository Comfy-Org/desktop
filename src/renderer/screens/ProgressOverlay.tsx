import React from 'react';
import { COMFY_ERROR_MESSAGE, COMFY_FINISHING_MESSAGE } from 'src/constants';
import AnimatedLogDisplay from './AnimatedLogDisplay';

const loadingTextStyle: React.CSSProperties = {
  marginBottom: '20px',
  textAlign: 'center',
  fontSize: '20px',
  fontFamily: 'sans-serif, monospace',
  fontWeight: 'bold',
};

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

interface ProgressOverlayProps {
  status: string;
  logs: string[];
}

const ProgressOverlay: React.FC<ProgressOverlayProps> = ({ status, logs }) => {
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
};

export default ProgressOverlay;
