Please update the version of ComfyUI to the latest:

1. Reference this PR as an example. https://github.com/Comfy-Org/desktop/commit/7cba9c25b95b30050dfd6864088ca91493bfd00b
2. Go to [ComfyUI](https://github.com/comfyanonymous/ComfyUI/) Github repo and see what the latest Github Release is
3. Update the ComfyUI version version in @package.json based on what is in the latest Github Release. Don't update the optional branch.
4. Get the latest stable [frontend](https://github.com/Comfy-Org/ComfyUI_frontend) release, and use it to update `frontendVersion` in @package.json.
5. Update the versions in `scripts/core-requirements.patch` to match those in `requirements.txt` from the ComfyUI repo.
   - Context: The patch is used to removes the frontend package, as the desktop app includes it in the build process instead.
6. Update `assets/requirements/windows_nvidia.compiled` and `assets/requirements/windows_cpu.compiled` accordingly. You just need to update the comfycomfyui-frontend-package, [comfyui-workflow-templates](https://github.com/Comfy-Org/workflow_templates), [comfyui-embedded-docs](https://github.com/Comfy-Org/embedded-docs) versions.
7. Please make a PR by checking out a new branch from main, adding a commit message and then use GH CLI to create a PR.
   - Make the versions in the PR body as links to the relevant github releases
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
8. Wait for all tests to pass, actively monitoring and checking the PR status periodically until tests complete, then squash-merge the PR.
9. Switch to main branch and git pull
10. Bump the version using `npm version` with the `--no-git-tag-version` arg
11. Create a version bump PR with the title `vVERSION` e.g. `v0.4.10`. It must have the `Release` label, and no content in the PR description.
12. Squash-merge the PR - do not wait for tests, as bumping package version will not cause test breakage.
13. Publish a GitHub Release:
    - Set to pre-release (not latest)
    - The tag should be `vVERSION` e.g. `v0.4.10`
    - Use GitHub's generate release notes option
14. Remove merged local branches

## Commit messages

- IMPORTANT When writing commit messages, they should be clean and simple. Never add any reference to being created by Claude Code, or add yourself as a co-author, as this can lead to confusion.

## General

- Prefer `gh` commands over fetching websites
- Use named `gh` commands to perform actions, e.g. `gh release list`, rather than `gh api` commands. This is much faster as named commands can be approved automatically.
- Use subagents to verify details or investigate any particular questions you may have.
- For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
- After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action.
