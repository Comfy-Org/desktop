# Typed IPC for Electron

This directory contains compile-time type safety for Electron IPC communication between the main and renderer processes.

## Overview

The typed IPC system provides:
- **Autocomplete** for channel names
- **Type checking** for parameters
- **Correct return type inference**
- **Compile-time error detection**
- **Zero runtime overhead** (pure TypeScript types)

## Files

- **`contract.ts`** - Central IPC contract defining all channels with their parameter and return types
- **`electron.d.ts`** - TypeScript namespace augmentation that enhances Electron's `ipcMain` and `ipcRenderer` interfaces
- **`renderer.d.ts`** - Global type declaration for `window.electronAPI` in the renderer process

## Usage

### Main Process

The type augmentation is automatically available once imported in `main.ts`. No wrapper functions needed.

```typescript
import { ipcMain } from 'electron';

// ✅ Fully typed - autocomplete and type checking work
ipcMain.handle('get-base-path', () => {
  return '/some/path'; // TypeScript knows this should return string | undefined
});

// ❌ TypeScript error - wrong return type
ipcMain.handle('get-base-path', () => {
  return 123; // Error: Type 'number' is not assignable to type 'string | undefined'
});

// ✅ Fully typed with parameters
ipcMain.handle('validate-install-path', (event, path: string, bypassCheck?: boolean) => {
  // TypeScript knows the parameter types
  return validatePath(path, bypassCheck);
});
```

### Renderer Process (via Preload)

The preload script exposes `window.electronAPI`, which is fully typed via `renderer.d.ts`:

```typescript
// ✅ Fully typed - autocomplete works
const path = await window.electronAPI.getBasePath();

// ✅ Type checking for parameters
const result = await window.electronAPI.validateInstallPath('/path', true);

// ❌ TypeScript error - missing required parameter
await window.electronAPI.validateInstallPath(); // Error!
```

## Adding New IPC Channels

To add a new IPC channel with type safety:

### 1. Add to the IPC Contract

Edit `src/ipc/contract.ts` and add your channel to the `IpcChannels` interface:

```typescript
export interface IpcChannels {
  // ... existing channels ...

  'my-new-channel': {
    params: [arg1: string, arg2: number];
    return: { success: boolean; data: string };
  };
}
```

### 2. Register the Handler

In your handler file (e.g., `src/handlers/myHandlers.ts`):

```typescript
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../constants';

export function registerMyHandlers() {
  ipcMain.handle(IPC_CHANNELS.MY_NEW_CHANNEL, (event, arg1: string, arg2: number) => {
    // TypeScript will enforce that you return { success: boolean; data: string }
    return { success: true, data: `Got ${arg1} and ${arg2}` };
  });
}
```

### 3. Expose in Preload (if needed)

In `src/preload.ts`, add the method to `electronAPI`:

```typescript
const electronAPI = {
  // ... existing methods ...

  myNewMethod: (arg1: string, arg2: number) => {
    return ipcRenderer.invoke(IPC_CHANNELS.MY_NEW_CHANNEL, arg1, arg2);
  },
} as const;
```

### 4. Add to Constants

In `src/constants.ts`, add the channel name:

```typescript
export const IPC_CHANNELS = {
  // ... existing channels ...
  MY_NEW_CHANNEL: 'my-new-channel',
} as const;
```

That's it! TypeScript will now enforce type safety across the entire IPC chain.

## How It Works

### Module Augmentation

The `electron.d.ts` file uses TypeScript's **namespace augmentation** to enhance the existing Electron type definitions without modifying them:

```typescript
declare namespace Electron {
  interface IpcMain {
    handle<T extends IpcChannelName>(
      channel: T,
      listener: (event: IpcMainInvokeEvent, ...args: IpcChannelParams<T>) => IpcChannelReturn<T>
    ): void;
  }
}
```

This works by:
1. TypeScript loads the original `electron.d.ts` from `node_modules`
2. Our augmentation file merges additional type information into the `Electron` namespace
3. The generic type `T` is constrained to valid channel names
4. Helper types (`IpcChannelParams`, `IpcChannelReturn`) extract the correct parameter and return types for each channel

### Zero Runtime Cost

This is purely a compile-time feature. The generated JavaScript is identical to what you would write without types:

```javascript
// The TypeScript above compiles to exactly this:
ipcMain.handle('get-base-path', () => {
  return '/some/path';
});
```

No wrapper functions, no runtime overhead, just better DX and fewer bugs.

## Benefits

1. **Catch errors early** - Type mismatches are caught at compile time, not at runtime
2. **Better IDE support** - Autocomplete shows all available channels and their signatures
3. **Refactoring safety** - Changing a channel's signature shows all places that need updating
4. **Documentation** - Types serve as inline documentation for IPC contracts
5. **No performance impact** - Pure TypeScript, zero runtime cost

## Known Limitations

1. **Unimplemented channels** - Two channels are defined but not implemented:
   - `disable-custom-nodes` - Planned feature
   - `dialog-click-button` - Exists on another branch

2. **One-time handlers** - The `ipcMain.handleOnce` pattern used for dialogs may need special handling in the contract

3. **LSP restart** - You may need to restart the TypeScript language server after adding new channels for autocomplete to update
