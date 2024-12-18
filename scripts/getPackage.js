// Read the main package.json
import { createRequire } from 'node:module';

/** @type {import('../package.json')} */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const packageJson = createRequire(import.meta.url)('../package.json');

export default packageJson;
