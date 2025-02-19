import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, unicorn/no-await-expression-member, @typescript-eslint/no-unsafe-member-access
  const latestReleaseTag = (await latestReleaseData.json()).tag_name;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const version = latestReleaseTag.replace('v', '');

  // Update frontend version in package.json
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  packageJson.config.frontendVersion = version;
  writeFileSync('./package.json', JSON.stringify(packageJson, null, 2));

  // Commit the version bump
  execSync(`git commit -am "[chore] Update frontend to ${version}" --no-verify`, { stdio: 'inherit' });

  // Create the PR
  console.log('Creating PR...');
  const prBody = `Automated frontend update to ${version}: https://github.com/Comfy-Org/ComfyUI_frontend/releases/tag/v${version}`;
  execSync(`gh pr create --title "[chore] Update frontend to ${version}" --label "dependencies" --body "${prBody}"`, {
    stdio: 'inherit',
  });

  console.log(`✅ Successfully created PR for frontend ${version}`);
} catch (error) {
  console.error('❌ Error during release process:', error.message);
}
