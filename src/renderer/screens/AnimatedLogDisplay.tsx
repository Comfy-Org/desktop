import React, { useEffect, useRef } from 'react';

interface AnimatedLogDisplayProps {
  logs: string[];
}

const AnimatedLogDisplay: React.FC<AnimatedLogDisplayProps> = ({ logs }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);

  useEffect(() => {
    const scrollContainer = logContainerRef.current;
    if (scrollContainer) {
      if (shouldScrollRef.current) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [logs]);

  const handleScroll = () => {
    const scrollContainer = logContainerRef.current;
    if (scrollContainer) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const isScrolledToBottom = scrollHeight - clientHeight <= scrollTop + 1;
      shouldScrollRef.current = isScrolledToBottom;
    }
  };

  const containerStyle: React.CSSProperties = {
    height: '200px',
    padding: '10px',
    fontFamily: 'monospace',
    fontSize: '14px',
    overflowY: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: '#888 #f1f1f1',
  };

  return (
    <div ref={logContainerRef} style={containerStyle} onScroll={handleScroll}>
      {logs.length === 0 && <div>Streaming logs...</div>}
      {logs.map((logMessage, index) => (
        <div key={index}>{logMessage}</div>
      ))}
    </div>
  );
};

export default AnimatedLogDisplay;
