export default {
  './**/*.js': formatAndEslint,
  './**/*.{ts,mts}': (stagedFiles) => [
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ...formatAndEslint(stagedFiles),
    'tsc --noEmit',
  ],
};

/**
 * Run prettier and eslint on staged files.
 * @param {string[]} fileNames
 * @returns {string[]}
 */
function formatAndEslint(fileNames) {
  return [`prettier --write ${fileNames.join(' ')}`, `eslint --fix ${fileNames.join(' ')}`];
}
