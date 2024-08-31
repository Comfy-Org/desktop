cp -f scripts/shims/utils.js node_modules/@electron/osx-sign/dist/cjs/util.js
cp -f scripts/shims/mac.js node_modules/@electron/packager/dist/mac.js

cat node_modules/@electron/osx-sign/dist/cjs/util.js