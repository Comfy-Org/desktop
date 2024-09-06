cp -f scripts/shims/utils.js node_modules/@electron/osx-sign/dist/cjs/util.js

sed -i '' 's/packageOpts.quiet = true/packageOpts.quiet = false/g' "node_modules/@electron-forge/core/dist/api/package.js"