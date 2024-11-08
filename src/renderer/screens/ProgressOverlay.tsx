import React from 'react';
import { ProgressMessages, ProgressStatus } from '/src/constants';
import AnimatedLogDisplay from './AnimatedLogDisplay';
import Linkify from 'linkify-react';

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
  status: ProgressStatus;
  logs: string[];
  openForum: () => void;
}

const linkStyle: React.CSSProperties = {
  color: '#3391ff', // Bright blue that works well on dark background
  textDecoration: 'underline',
  cursor: 'pointer',
};

const ProgressOverlay: React.FC<ProgressOverlayProps> = ({ status, logs, openForum }) => {
  const linkOptions = {
    render: ({ attributes, content }: { attributes: any; content: string }) => {
      const { href, ...props } = attributes;
      return (
        <a
          {...props}
          href={href}
          style={linkStyle}
          onClick={(e) => {
            e.preventDefault();
            openForum();
          }}
        >
          {content}
        </a>
      );
    },
  };

  return (
    <div style={outerContainerStyle}>
      <div style={containerStyle}>
        <div style={loadingTextStyle} id="loading-text">
          <Linkify options={linkOptions}>{ProgressMessages[status]}</Linkify>
        </div>
        <div style={logContainerStyle}>
          {status !== ProgressStatus.READY && status !== ProgressStatus.ERROR && <AnimatedLogDisplay logs={logs} />}
        </div>
      </div>
    </div>
  );
};

export default ProgressOverlay;
