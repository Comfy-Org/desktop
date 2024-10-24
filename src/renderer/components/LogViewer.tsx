import React, { useState } from 'react';
import { LazyLog } from '@melloware/react-logviewer';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  backgroundColor: '#1e1e1e',
  color: '#9198a1',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '15px',
  borderBottom: '1px solid #333',
};

const logContainerStyle: React.CSSProperties = {
  flexGrow: 1,
  overflow: 'auto',
  padding: '10px',
  scrollbarWidth: 'thin',
  scrollbarColor: '#444 #1e1e1e',
};

const buttonStyle: React.CSSProperties = {
  margin: '0 5px',
  padding: '8px 15px',
  cursor: 'pointer',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: 'bold',
  transition: 'background-color 0.3s, transform 0.1s',
};

const closeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#2a2a2a',
};

const tailButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#28a745', // Green for Start Tail
};

const buttonHoverStyle: React.CSSProperties = {
  transform: 'translateY(-1px)',
};

interface LogViewerProps {
  onClose: () => void;
}

const LogViewer: React.FC<LogViewerProps> = ({ onClose }) => {
  const [follow, setFollow] = useState(true);
  const [closeHover, setCloseHover] = useState(false);
  const [tailHover, setTailHover] = useState(false);

  const toggleTail = () => {
    setFollow((prev) => !prev);
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <button
          onClick={onClose}
          style={{ ...closeButtonStyle, ...(closeHover ? buttonHoverStyle : {}) }}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
        >
          Close
        </button>
        <button
          onClick={toggleTail}
          style={{
            ...tailButtonStyle,
            ...(tailHover ? buttonHoverStyle : {}),
            backgroundColor: follow ? '#dc3545' : '#28a745', // Red for Stop Tail, Green for Start Tail
          }}
          onMouseEnter={() => setTailHover(true)}
          onMouseLeave={() => setTailHover(false)}
        >
          {follow ? 'Stop Tail' : 'Start Tail'}
        </button>
      </div>
      <div style={logContainerStyle}>
        <LazyLog
          url="ws://localhost:7999"
          websocket
          selectableLines
          extraLines={1}
          stream={true}
          follow={follow}
          style={{ backgroundColor: 'transparent' }}
        />
      </div>
    </div>
  );
};

export default LogViewer;
