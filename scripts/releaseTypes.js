import { execSync } from 'child_process'
import { readFileSync } from 'fs'

try {
  // Create a new branch with version-bump prefix
  console.log('Creating new branch...')
  const date = new Date().toISOString().split('T')[0]
  const timestamp = new Date().getTime()
  const branchName = `version-bump-${date}-${timestamp}`
  execSync(`git checkout -b ${branchName} -t origin/main`, { stdio: 'inherit' })

  // Run npm version patch and capture the output
  console.log('Bumping version...')
  execSync('yarn version patch', { stdio: 'inherit' })

  // Read the new version from package.json
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))
  const newVersion = packageJson.version

  // Create the PR
  console.log('Creating PR...')
  execSync(
    `gh pr create --title "${newVersion}(types)" --label "ReleaseTypes" --body "Automated version bump to ${newVersion}"`,
    { stdio: 'inherit' }
  )

  console.log(`✅ Successfully created PR for version ${newVersion}`)
} catch (error) {
  console.error('❌ Error during release process:', error.message)
}
