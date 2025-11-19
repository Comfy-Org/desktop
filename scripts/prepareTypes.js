import fs from 'node:fs';
import path from 'node:path';

import mainPackage from './getPackage.js';

// Create the types-only package.json
const typesPackage = {
  name: `${mainPackage.name}-types`,
  version: mainPackage.version,
  type: 'module',
  main: './index.js',
  types: './index.d.ts',
  files: ['index.d.ts', 'index.js'],
  publishConfig: {
    access: 'public',
  },
  repository: mainPackage.repository,
  homepage: mainPackage.homepage,
  description: `TypeScript definitions for ${mainPackage.name}`,
  author: mainPackage.author,
  license: mainPackage.license,
};

// Ensure dist directory exists
const distDir = path.join(import.meta.dirname, '../dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Write the new package.json to the dist directory
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(typesPackage, null, 2));

console.log('Types package.json has been prepared in the dist directory');
