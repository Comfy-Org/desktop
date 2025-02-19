import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import packageJson from './getPackage.js';

try {
  // Create a new branch with version-bump prefix
  console.log('Creating new branch...');
  const date = new Date();
  const isoDate = date.toISOString().split('T')[0];
  const timestamp = date.getTime();
  const branchName = `version-bump-${isoDate}-${timestamp}`;
  execSync(`git checkout -b ${branchName} -t origin/main`, { stdio: 'inherit' });

  // Get latest frontend release: https://github.com/Comfy-Org/ComfyUI_frontend/releases
  const latestRelease = 'https://api.github.com/repos/Comfy-Org/ComfyUI_frontend/releases/latest';
  const latestReleaseData = await fetch(latestRelease);
  /** @type {unknown} */
  const json = await latestReleaseData.json();
  if (!('tag_name' in json) || typeof json.tag_name !== 'string') {
    throw new Error('Invalid response from GitHub');
  }

  const latestReleaseTag = json.tag_name;
  const version = latestReleaseTag.replace('v', '');

  // Update frontend version in package.json
  packageJson.config.frontendVersion = version;
  writeFileSync('./package.json', JSON.stringify(packageJson, null, 2));

  // Messaging
  const message = `[chore] Update frontend to ${version}`;
  const prBody = `Automated frontend update to ${version}: https://github.com/Comfy-Org/ComfyUI_frontend/releases/tag/v${version}`;

  // Commit the version bump
  execSync(`git commit -am "${message}" --no-verify`, { stdio: 'inherit' });

  // Create the PR
  console.log('Creating PR...');
  execSync(`gh pr create --title "${message}" --label "dependencies" --body "${prBody}"`, { stdio: 'inherit' });

  console.log(`✅ Successfully created PR for frontend ${version}`);
} catch (error) {
  console.error('❌ Error during release process:', error.message);
}
