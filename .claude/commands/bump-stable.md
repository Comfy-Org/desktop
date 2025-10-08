---
description: Create a new version of ComfyUI Desktop. It will update core, frontend, templates, and embedded docs. Updates compiled requirements with new templates / docs versions.
---

Please update the version of ComfyUI to the latest:

1. Reference this PR as an example. https://github.com/Comfy-Org/desktop/commit/7cba9c25b95b30050dfd6864088ca91493bfd00b
2. Go to [ComfyUI](https://github.com/comfyanonymous/ComfyUI/) Github repo and see what the latest Github Release is
   - If there is {a semver tag (prefixed with `v`) without a release} OR {a `prerelease`} OR {a draft release} that is newer than the release marked as `latest`, AND this new version is a either a single major, minor, or patch version increment on the `latest` release, use that version instead of latest.
3. Read the `requirements.txt` file from that release
4. Update the ComfyUI version version in @package.json based on what is in the latest Github Release. If config.ComfyUI.optionalBranch is set in @package.json, change it to an empty string ("").
5. Update the frontend version in @package.json (`frontendVersion`) to the version specified in `requirements.txt`
   - If we currently have a higher version than what is in requirements.txt, DO NOT downgrade - continue and notify the human using warning emoji: ⚠️
6. Update the versions in `scripts/core-requirements.patch` to match those in `requirements.txt` from the ComfyUI repo.
   - Context: The patch is used to removes the frontend package, as the desktop app includes it in the build process instead.
7. Update `assets/requirements/windows_nvidia.compiled` and `assets/requirements/windows_cpu.compiled`, and `assets/requirements/macos.compiled` accordingly. You just need to update the comfycomfyui-frontend-package, [comfyui-workflow-templates](https://github.com/Comfy-Org/workflow_templates), [comfyui-embedded-docs](https://github.com/Comfy-Org/embedded-docs) versions.
8. Please make a PR by checking out a new branch from main, adding a commit message and then use GH CLI to create a PR.
   - Make the versions in the PR body as links to the relevant github releases - our tags prefix the semver with `v`, e.g. `v0.13.4`
     - Verify the links actually work - report any failure immediately to the human: ❌
   - Include only the PR body lines that were updated
   - PR Title: Update ComfyUI core to v{VERSION}
   - PR Body:
     ## Updated versions
     | Component     | Version               |
     | ------------- | --------------------- |
     | ComfyUI core  | COMFYUI_VERSION       |
     | Frontend      | FRONTEND_VERSION      |
     | Templates     | TEMPLATES_VERSION     |
     | Embedded docs | EMBEDDED_DOCS_VERSION |
9. Wait for all tests to pass, actively monitoring and checking the PR status periodically until tests complete, then squash-merge the PR (only if required, use the `--admin` flag).
   - If ANY test fails for any reason, stop here and report the failure(s) to the human - use emoji in your report e.g.: ❌
10. Switch to main branch and git pull
11. Bump the version using `npm version` with the `--no-git-tag-version` arg
12. Create a version bump PR with the title `vVERSION` e.g. `v0.4.10`. It must have the `Release` label, and no content in the PR description.
13. Squash-merge the PR (only if required, use the `--admin` flag) - do not wait for tests, as bumping package version will not cause test breakage.
14. Publish a GitHub Release:
    - Set to pre-release (not latest)
    - The tag should be `vVERSION` e.g. `v0.4.10`
    - Use GitHub's generate release notes option
15. Remove merged local branches

## Commit messages

- IMPORTANT When writing commit messages, they should be clean and simple. Never add any reference to being created by Claude Code, or add yourself as a co-author, as this can lead to confusion.

## General

- Prefer `gh` commands over fetching websites
- Use named `gh` commands to perform actions, e.g. `gh release list`, rather than `gh api` commands. This is much faster as named commands can be approved automatically.
- Use subagents to verify details or investigate any particular questions you may have.
- For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
- After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action.
