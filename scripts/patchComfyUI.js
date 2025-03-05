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

    // If patch was successfully applied (not false or null)
    if (patchedContent) {
      // Write the result to the output file
      await fs.writeFile(filePath, patchedContent, 'utf8');
      console.log('Patch applied successfully!');
    } else {
      console.error('Failed to apply patch - patch may be invalid or incompatible');
    }
  } catch (error) {
    console.error('Error applying patch:', error.message);
  }
}

await patchFile('./assets/ComfyUI/app/frontend_management.py', './scripts/core-remove-frontend.patch');
await patchFile('./assets/ComfyUI/requirements.txt', './scripts/core-requirements.patch');
