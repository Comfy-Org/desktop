import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

try {
  // Create a new branch with version-bump prefix
  console.log('Creating new branch...');
  const date = new Date();
  const isoDate = date.toISOString().split('T')[0];
  const timestamp = date.getTime();
  const branchName = `version-bump-${isoDate}-${timestamp}`;
  execSync(`git checkout -b ${branchName} -t origin/main`, { stdio: 'inherit' });

  // Run npm version patch and capture the output
  console.log('Bumping version...');
  execSync('yarn version patch', { stdio: 'inherit' });

  // Read the new version from package.json
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const newVersion = packageJson.version;

  // Messaging
  const message = `[API] Publish types for version ${newVersion}`;
  const prBody = `- Automated minor version bump to: ${newVersion}\n- Triggers npm publish workflow of API types`;

  // Commit the version bump
  execSync(`git commit -am "${message}" --no-verify`, { stdio: 'inherit' });

  // Create the PR
  console.log('Creating PR...');
  execSync(`gh pr create --title "${message}" --label "ReleaseTypes" --body "${prBody}"`, { stdio: 'inherit' });

  console.log(`✅ Successfully created PR for version ${newVersion}`);
} catch (error) {
  console.error('❌ Error during release process:', error.message);
}
