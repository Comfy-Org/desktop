import React from 'react';
import ProgressOverlay from './screens/ProgressOverlay';

const bodyStyle: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100vh',
  margin: '0',
  backgroundColor: '#f0f0f0',
};

// Main entry point for the front end renderer. 
// Currently this serves as the overlay to show progress as the comfy backend is coming online. 
// after coming online the main.ts will replace the renderer with comfy's internal index.html
function Home(): React.ReactElement {
  return (
    <div style={bodyStyle}>
      <ProgressOverlay />
    </div>
  );
}

export default Home;
