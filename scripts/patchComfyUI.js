import { applyPatch } from 'diff';
import fs from 'node:fs/promises';

/**
 * @param {string} filePath
 * @param {string} patchFilePath
 */
async function patchFile(filePath, patchFilePath) {
  try {
    // Read the original file and patch file
    const [originalContent, patchContent] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.readFile(patchFilePath, 'utf8'),
    ]);

    // Apply the patch
    const patchedContent = applyPatch(originalContent, patchContent);

    // If patch was successfully applied (not falsy)
    if (patchedContent) {
      // Write the result to the output file
      await fs.writeFile(filePath, patchedContent, 'utf8');
      console.log('Patch applied successfully!');
    } else {
      throw new Error(
        `ComfyUI core patching returned falsy value (${typeof patchedContent}) - .patch file probably requires update`
      );
    }
  } catch (error) {
    throw new Error(`Error applying core patch: ${error.message}`, { cause: error });
  }
}

await patchFile('./assets/ComfyUI/app/frontend_management.py', './scripts/core-remove-frontend.patch');
await patchFile('./assets/ComfyUI/requirements.txt', './scripts/core-requirements.patch');
