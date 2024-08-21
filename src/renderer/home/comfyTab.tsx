import * as React from 'react';


function ComfyUI(): React.ReactElement {
    return <webview id='comfyUIWebView' src='http://localhost:8188/' style={{ width: '100%', height: '100%'}}/>
}

export default ComfyUI;