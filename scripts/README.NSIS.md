# NSIS build process notes

This file contains notes on the toDesktop NSIS build process that are relevnt to the NSIS build process / installer.nsh code.

- toDesktop build process treats NSIS warnings as errors
- `${__FILEDIR__}` points to `C:\Users\VSSADM~1\AppData\Local\Temp\todesktop\241012ess7yxs0e\app-wrapper\other\` during the build process. You need `BUILD_RESOURCES_DIR` to reference the original project files from an nsh.
