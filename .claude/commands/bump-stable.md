Please update the version of ComfyUI to the latest:

1. Reference this PR as an example. https://github.com/Comfy-Org/desktop/commit/7cba9c25b95b30050dfd6864088ca91493bfd00b
2. Go to [ComfyUI](https://github.com/comfyanonymous/ComfyUI/) Github repo and see what the latest Github Release is
3. Update the ComfyUI version version in @package.json based on what is in the latest Github Release. Don't update the optional branch.
4. Get the latest stable [frontend](https://github.com/Comfy-Org/ComfyUI_frontend) release, and use it to update `frontendVersion` in @package.json.
5. Update the versions in `scripts/core-requirements.patch` to match those in `requirements.txt` from the ComfyUI repo.
   - Context: The patch is used to removes the frontend package, as the desktop app includes it in the build process instead.
6. Update `assets/requirements/windows_nvidia.compiled` and `assets/requirements/windows_cpu.compiled` accordingly. You just need to update the comfycomfyui-frontend-package, comfyui-workflow-templates, comfyui-embedded-docs versions.
7. Please make a PR by checking out a new branch from main, adding a commit message and then use GH CLI to create a PR.
   - Make the version in the PR body a link to the relevant github releases
   - Include only the PR body lines that were updated
   - PR Title: Update ComfyUI core to v{VERSION}
   - PR Body:
     - Updates ComfyUI core to version COMFYUI_VERSION
     - Updates frontend to version FRONTEND_VERSION
     - Updates templates to version TEMPLATES_VERSION

## Commit messages

- IMPORTANT When writing commit messages, they should be clean and simple. Never add any reference to being created by Claude Code, or add yourself as a co-author, as this can lead to confusion.

## General

- Prefer `gh` commands over fetching websites
- Use named `gh` commands to perform actions, e.g. `gh release list`
- Use subagents to verify details or investigate any particular questions you may have.
- For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
- After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action.
