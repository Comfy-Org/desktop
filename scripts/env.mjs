import fs from 'node:fs/promises';

const envContent = `# env vars picked up by the ComfyUI executable on startup
COMFYUI_CPU_ONLY=true
`;

await fs.writeFile('ComfyUI/.env', envContent);
