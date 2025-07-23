# ComfyUI Desktop Protocol Implementation

This document outlines the implementation of the `comfy://` protocol for ComfyUI Desktop, enabling one-click custom node installation and workflow import from web browsers.

## Features

The protocol supports the following actions:

### Install Custom Node
```
comfy://install-custom-node/<nodeId>
```
- **Purpose**: Install a custom node via ComfyUI Manager
- **Example**: `comfy://install-custom-node/ComfyUI-AnimateDiff-Evolved`
- **Behavior**: Launches ComfyUI Desktop and automatically installs the specified custom node

### Import Workflow/Resource
```
comfy://import/<resourceId>
```
- **Purpose**: Import a workflow or other resource
- **Example**: `comfy://import/workflow-123`
- **Behavior**: Launches ComfyUI Desktop and imports the specified resource

## Technical Implementation

### Protocol Registration
- Registers `comfy://` protocol using Electron's `app.setAsDefaultProtocolClient()`
- Handles both development and production environments
- Supports single-instance behavior via `second-instance` event

### URL Parsing
- Robust URL parsing with comprehensive validation
- Supports URL encoding for special characters
- Returns structured action objects with type safety

### Action Processing
- Actions are queued if ComfyUI server isn't ready yet
- HTTP API calls to ComfyUI Manager endpoints
- User feedback via window focus and log messages
- Error handling with user-friendly dialogs

### Integration Points
- Integrates with existing ComfyUI Manager installation
- Uses ComfyUI Manager's REST API endpoints
- Maintains compatibility with existing app architecture
- Includes telemetry tracking for usage analytics

## User Experience

1. User clicks a `comfy://` link on a website (e.g., ComfyUI Registry)
2. Browser asks to launch ComfyUI Desktop
3. ComfyUI Desktop launches and focuses window
4. Protocol action is processed automatically
5. User sees progress feedback in the app logs
6. Success/error feedback is provided

## Error Handling

- Invalid protocol URLs are safely ignored
- Network errors show user-friendly error dialogs
- Actions are retried if ComfyUI server isn't ready
- Comprehensive logging for debugging

## Testing

- Unit tests for protocol URL parsing (10 test cases)
- Unit tests for ComfyUI Manager service integration
- Comprehensive edge case coverage
- TypeScript type safety throughout

## Security Considerations

- Only supports predefined action types
- URL validation prevents malicious inputs
- No arbitrary code execution from protocol URLs
- Rate limiting via action queueing

## Browser Integration

Web developers can integrate one-click installation by creating links like:

```html
<a href="comfy://install-custom-node/my-awesome-node">
  Install in ComfyUI Desktop
</a>
```

This enables seamless integration between web-based ComfyUI resources and the desktop application.