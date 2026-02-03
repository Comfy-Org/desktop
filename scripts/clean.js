import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {{ paths?: string[]; before?: string[] }} CleanTask
 */

/** @type {Record<string, CleanTask>} */
const TASKS = {
  clean: {
    paths: ['.vite', 'dist', 'out'],
  },
  'clean:uv': {
    paths: ['assets/uv'],
  },
  'clean:assets:git': {
    paths: ['assets/ComfyUI/.git', 'assets/ComfyUI/custom_nodes/ComfyUI-Manager/.git'],
  },
  'clean:assets': {
    before: ['clean:assets:git', 'clean:uv'],
    paths: ['assets/.env', 'assets/ComfyUI', 'assets/python.tgz'],
  },
  'clean:slate': {
    before: ['clean', 'clean:assets'],
    paths: ['node_modules'],
  },
};

const taskName = process.argv[2] ?? 'clean';

if (!TASKS[taskName]) {
  console.error(`Unknown clean task: ${taskName}`);
  console.error(`Available tasks: ${Object.keys(TASKS).join(', ')}`);
  process.exit(1);
}

const visited = new Set();

/**
 * @param {string} name
 */
async function runTask(name) {
  if (visited.has(name)) return;
  visited.add(name);

  const task = TASKS[name];
  if (!task) throw new Error(`Unknown clean task: ${name}`);

  if (task.before) {
    for (const dependency of task.before) {
      await runTask(dependency);
    }
  }

  if (task.paths?.length) {
    await removePaths(task.paths);
  }
}

/**
 * @param {string[]} relativePaths
 */
async function removePaths(relativePaths) {
  const deletions = relativePaths.map((relativePath) => {
    const fullPath = path.resolve(repoRoot, relativePath);
    const resolvedRelative = path.relative(repoRoot, fullPath);

    if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) {
      throw new Error(`Refusing to remove path outside repo: ${relativePath}`);
    }

    return fs.rm(fullPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  await Promise.all(deletions);
}

try {
  await runTask(taskName);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
