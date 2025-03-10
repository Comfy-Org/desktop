import { applyPatch } from 'diff';
import fs from 'node:fs/promises';

/**
 * Patches files based on the {@link tasks} list.
 *
 * Each CLI argument is treated as a task name.
 *
 * Paths are relative to the project root.
 * @example
 * ```bash
 * node scripts/patchComfyUI.js frontend requirements
 * ```
 */
const tasks = new Map([
  [
    'frontend',
    {
      target: './assets/ComfyUI/app/frontend_management.py',
      patch: './scripts/core-remove-frontend.patch',
    },
  ],
  [
    'requirements',
    {
      target: './assets/ComfyUI/requirements.txt',
      patch: './scripts/core-requirements.patch',
    },
  ],
]);

// Main execution
const args = process.argv.slice(2);

// Error if no args / any invalid args

if (args.length === 0) {
  console.error('No arguments provided');
  process.exit(15);
}

const invalidArgs = args.filter((arg) => !tasks.has(arg));

if (invalidArgs.length > 0) {
  console.error(`Invalid argument(s): ${invalidArgs.map((arg) => `"${arg}"`).join(', ')}`);
  process.exit(255);
}

// Apply patches
const promises = args.map((arg) => patchFile(tasks.get(arg).target, tasks.get(arg).patch));
await Promise.all(promises);

//#region Functions

/**
 * Applies a regular diff patch to a single file
 * @param {string} targetPath Target file path
 * @param {string} patchFilePath Patch file to apply to the target file
 */
async function patchFile(targetPath, patchFilePath) {
  try {
    // Read the original file and patch file
    const [originalContent, patchContent] = await Promise.all([
      fs.readFile(targetPath, 'utf8'),
      fs.readFile(patchFilePath, 'utf8'),
    ]);

    // Apply the patch
    const patchedContent = applyPatch(originalContent, patchContent);

    // If patch was successfully applied (not falsy)
    if (patchedContent) {
      // Write the result to the output file
      await fs.writeFile(targetPath, patchedContent, 'utf8');
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

//#endregion Functions
