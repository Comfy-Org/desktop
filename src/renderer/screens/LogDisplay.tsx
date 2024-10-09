import React, { useState, useEffect, useRef, useCallback } from 'react';

interface AnimatedLogDisplayProps {
  logs?: string[];
  maxDisplayedLogs?: number;
}


const AnimatedLogDisplay: React.FC<AnimatedLogDisplayProps> = ({
  logs,
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

  return (
    <div
      ref={logContainerRef}
      style={{
        height: '200px',
        overflowY: 'auto',
        border: '1px solid #ccc',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '14px',
      }}
    >
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
  );
};

export default AnimatedLogDisplay;
