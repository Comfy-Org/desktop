const { execSync } = require('child_process')
const { readFileSync, writeFileSync } = require('fs')

async function main() {
  try {
    // Create a new branch with version-bump prefix
    console.log('Creating new branch...')
    const date = new Date().toISOString().split('T')[0]
    const timestamp = new Date().getTime()
    const branchName = `version-bump-${date}-${timestamp}`
    execSync(`git checkout -b ${branchName} -t origin/main`, { stdio: 'inherit' })

    // Get latest frontend release: https://github.com/Comfy-Org/ComfyUI_frontend/releases
    const latestRelease = 'https://github.com/Comfy-Org/ComfyUI_frontend/releases/latest'
    const latestReleaseData = await fetch(latestRelease)
    const latestReleaseTag = (await latestReleaseData.json()).tag_name
    const version = latestReleaseTag.replace('v', '')

    // Update frontend version in package.json
    const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))
    packageJson.config.frontendVersion = version
    writeFileSync('./package.json', JSON.stringify(packageJson, null, 2))

    // Commit the version bump
    execSync(`git commit -am "[chore] Update frontend to ${version}"`, { stdio: 'inherit' })

    // Create the PR
    console.log('Creating PR...')
    execSync(
      `gh pr create --title "[chore] Update frontend to ${version}" --label "dependencies" --body "Automated frontend update to ${version}"`,
      { stdio: 'inherit' }
    )

    console.log(`✅ Successfully created PR for frontend ${version}`)
  } catch (error) {
    console.error('❌ Error during release process:', error.message)
  }
}

main()
