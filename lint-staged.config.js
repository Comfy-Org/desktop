/** @type {import('lint-staged').Configuration} */
export default {
  './**/*.js': formatAndEslint,
  './**/*.{ts,mts}': (stagedFiles) => [...formatAndEslint(stagedFiles), 'tsc --noEmit'],
};

/**
 * Run prettier and eslint on staged files.
 * @param {string[]} fileNames
 * @returns {string[]}
 */
function formatAndEslint(fileNames) {
  return [`prettier --write ${fileNames.join(' ')}`, `eslint --fix ${fileNames.join(' ')}`];
}
