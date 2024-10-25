import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "Comfy.ElectronAdapter",
  settings: [
    {
      id: 'Comfy.Electron.Foo',
      name: 'A dummy setting to verify that the extension is loaded',
      type: 'boolean',
      defaultValue: true,
    },
  ],
});