Please update the version of ComfyUI to the latest:

- Reference this PR as an example. https://github.com/Comfy-Org/desktop/commit/7cba9c25b95b30050dfd6864088ca91493bfd00b
- Go to ComfyUI Github repo and see what the latest Github Release is.
- Update the ComfyUI version and frontend version in package.json based on what is in the latest Github Release. Don't update the optional branch.
- Update core-requirements.patch, which will patch the requirements.txt file in ComfyUI to remove the comfyui_frontend package, which we include directly in this electron application.
- Update assets/requirements/windows_nvidia.compiled and assets/requirements/windows_cpu.compiled accordingly. You just need to update the comfycomfyui-frontend-package, comfyui-workflow-templates, comfyui-embedded-docs versions.
- Please make a PR by checking out a new branch from main, adding a commit message and then us GH CLI to create a PR. The title of the PR should be: Bumping ComfyUI core to X version. Don't mention claude code.
