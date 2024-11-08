const fs = require('fs');
const path = require('path');

// Read the main package.json
const mainPackage = require('../package.json');

// Create the types-only package.json
const typesPackage = {
  name: `${mainPackage.name}-types`,
  version: mainPackage.version,
  types: './index.d.ts',
  exports: {
    '.': {
      types: './index.d.ts'
    }
  },
  files: [
    'index.d.ts'
  ],
  publishConfig: {
    access: 'public'
  },
  repository: mainPackage.repository,
  homepage: mainPackage.homepage,
  description: `TypeScript definitions for ${mainPackage.name}`,
  author: mainPackage.author,
  license: mainPackage.license,
};

// Ensure dist directory exists
const distDir = path.join(__dirname, '../dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Write the new package.json to the dist directory
fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify(typesPackage, null, 2)
);

// Create an empty yarn.lock file
fs.writeFileSync(path.join(distDir, 'yarn.lock'), '');

console.log('Types package.json and yarn.lock have been prepared in the dist directory');