// https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/src/types/comfy.d.ts
import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "Comfy.ElectronAdapter",
  settings: [
    {
      id: 'Comfy-Desktop.AutoUpdate',
      category: ['Comfy-Desktop', 'General', 'AutoUpdate'],
      name: 'Automatically check for updates',
      type: 'boolean',
      defaultValue: true,
      onChange(value) {
        // TODO(robinjhuang): Implement 'setAutoUpdate' in preload.ts
        window['electronAPI']?.setAutoUpdate?.(value);
      }
    },
  ],

  commands: [
    {
      id: 'Comfy-Desktop.OpenLogsFolder',
      label: 'Open Logs Folder',
      icon: 'pi pi-folder-open',
      function() {
        window['electronAPI']?.openLogsFolder?.();
      }
    }
  ],

  menuCommands: [
    {
      path: ['Help'],
      commands: [
        'Comfy-Desktop.OpenLogsFolder',
      ]
    }
  ]
});