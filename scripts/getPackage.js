// Read the main package.json
import { createRequire } from "module";

/** @type {import('../package.json')} */
const packageJson = createRequire(import.meta.url)("../package.json");

export default packageJson;
