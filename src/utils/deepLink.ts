/** The protocol name registered with the OS for deep links. */
export const PROTOCOL_NAME = 'comfy';

/** A parsed deep link action with the action name and file path. */
export interface DeepLinkAction {
  action: string;
  filePath: string;
}

/**
 * Parses a `comfy://` deep link URL and extracts the action and file path.
 * @param url The deep link URL to parse (e.g. `comfy://open?file=/path/to/workflow.json`)
 * @return The parsed action and file path, or `null` if the URL is invalid
 */
export function parseDeepLinkUrl(url: string): DeepLinkAction | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${PROTOCOL_NAME}:`) {
    return null;
  }

  // The action comes from the hostname (e.g. `comfy://open` -> hostname is "open").
  // Custom protocol URLs don't normalize hostname casing, so we lowercase it.
  const action = parsed.hostname.toLowerCase();
  if (!action) {
    return null;
  }

  const filePath = parsed.searchParams.get('file');
  if (!filePath) {
    return null;
  }

  return { action, filePath };
}

/**
 * Scans an array of strings (e.g. `process.argv` or second-instance `commandLine`)
 * for the first string starting with `comfy://`.
 * @param args The array of strings to search
 * @return The first `comfy://` URL found, or `undefined` if none
 */
export function findDeepLinkUrl(args: string[]): string | undefined {
  const prefix = `${PROTOCOL_NAME}://`;
  return args.find((arg) => arg.toLowerCase().startsWith(prefix));
}
