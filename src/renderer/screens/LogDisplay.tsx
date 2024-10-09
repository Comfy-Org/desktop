import React, { useState, useEffect, useRef } from 'react';

interface AnimatedLogDisplayProps {
  logs?: string[];
  maxDisplayedLogs?: number;
}

const AnimatedLogDisplay: React.FC<AnimatedLogDisplayProps> = ({
  logs = [],
  maxDisplayedLogs = 5
}) => {
  const [displayedLogs, setDisplayedLogs] = useState<string[]>([]);
  const [queuedLogs, setQueuedLogs] = useState<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const newLogs = logs.slice(displayedLogs.length);
    setQueuedLogs(prevQueue => [...prevQueue, ...newLogs]);
  }, [logs, displayedLogs]);

  useEffect(() => {
    if (queuedLogs.length > 0) {
      const timer = setTimeout(() => {
        setQueuedLogs(prevQueue => {
          const [nextLog, ...remainingQueue] = prevQueue;
          setDisplayedLogs(prevLogs => {
            const updatedLogs = [...prevLogs, nextLog].slice(-maxDisplayedLogs);
            return updatedLogs;
          });
          return remainingQueue;
        });
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [queuedLogs, maxDisplayedLogs]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [displayedLogs]);

  const containerStyle: React.CSSProperties = {
    height: '200px',
    padding: '10px',
    fontFamily: 'monospace',
    fontSize: '14px',
    overflowY: 'scroll',
    scrollbarWidth: 'none',  // Firefox
    msOverflowStyle: 'none',  // Internet Explorer 10+
  };

  const innerContainerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
  };

  return (
    <div ref={logContainerRef} style={containerStyle}>
      <div style={innerContainerStyle}>
        {displayedLogs.length == 0 && <div>Streaming logs...</div> }
        {displayedLogs.map((log, index) => (
          <div
            key={index}
            style={{
              opacity: 1,
              transform: 'translateY(0)',
              transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
            }}
          >
            {log}
          </div>
        ))}
        {queuedLogs.map((log, index) => (
          <div
            key={`queued-${index}`}
            style={{
              opacity: 0,
              transform: 'translateY(20px)',
              transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
            }}
          >
            {log}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnimatedLogDisplay;
