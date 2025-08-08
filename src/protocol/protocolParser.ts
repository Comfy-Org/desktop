/**
 * Protocol URL parser for comfy:// protocol handling
 */

export interface ProtocolAction {
  /** The action type (install-custom-node, import, etc.) */
  action: string;
  /** Parameters for the action */
  params: Record<string, string>;
  /** The full URL that was parsed */
  originalUrl: string;
}

export interface InstallCustomNodeAction extends ProtocolAction {
  action: 'install-custom-node';
  params: {
    nodeId: string;
  };
}

export interface ImportAction extends ProtocolAction {
  action: 'import';
  params: {
    nodeId: string;
  };
}

export type ComfyProtocolAction = InstallCustomNodeAction | ImportAction;

/**
 * Parses a comfy:// protocol URL and extracts the action and parameters
 * @param url The comfy:// URL to parse
 * @returns The parsed action or null if invalid
 */
export function parseComfyProtocolUrl(url: string): ComfyProtocolAction | null {
  try {
    // Handle custom protocol parsing manually since Node.js URL constructor 
    // doesn't handle custom protocols properly in all Node.js versions
    if (!url.startsWith('comfy://')) {
      return null;
    }

    // Remove the protocol prefix and parse the path
    const path = url.slice('comfy://'.length);
    const pathParts = path.split('/').filter(part => part.length > 0);
    
    if (pathParts.length < 2) {
      return null;
    }

    const [action, ...params] = pathParts;

    switch (action) {
      case 'install-custom-node': {
        if (params.length !== 1) {
          return null;
        }
        const nodeId = decodeURIComponent(params[0]);
        if (!nodeId) {
          return null;
        }
        return {
          action: 'install-custom-node',
          params: { nodeId },
          originalUrl: url,
        };
      }

      case 'import': {
        if (params.length !== 1) {
          return null;
        }
        const nodeId = decodeURIComponent(params[0]);
        if (!nodeId) {
          return null;
        }
        return {
          action: 'import',
          params: { nodeId },
          originalUrl: url,
        };
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Validates if a string is a valid comfy:// protocol URL
 * @param url The URL to validate
 * @returns True if valid comfy protocol URL
 */
export function isValidComfyProtocolUrl(url: string): boolean {
  return parseComfyProtocolUrl(url) !== null;
}