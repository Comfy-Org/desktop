/**
 * Service for interacting with ComfyUI Manager API endpoints
 */
import axios, { type AxiosInstance } from 'axios';
import log from 'electron-log/main';

import type { ComfyProtocolAction } from '../protocol/protocolParser';

export interface ComfyManagerApiResponse {
  success: boolean;
  message?: string;
  data?: unknown;
}

/**
 * Service for making API calls to ComfyUI Manager
 */
export class ComfyManagerService {
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly baseUrl: string,
    private readonly timeout: number = 30_000
  ) {
    this.httpClient = axios.create({
      baseURL: baseUrl,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request/response logging
    this.httpClient.interceptors.request.use(
      (config) => {
        log.debug('ComfyManager API Request:', { url: config.url, method: config.method });
        return config;
      },
      (error: Error) => {
        log.error('ComfyManager API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        log.debug('ComfyManager API Response:', { url: response.config.url, status: response.status });
        return response;
      },
      (error: Error & { config?: { url?: string }; response?: { status?: number } }) => {
        log.error('ComfyManager API Response Error:', {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Install a custom node by its ID/URL
   * @param nodeId The node identifier (could be a git URL or node name)
   * @returns Promise with the API response
   */
  async installCustomNode(nodeId: string): Promise<ComfyManagerApiResponse> {
    try {
      log.info('Installing custom node via ComfyUI Manager:', nodeId);

      // ComfyUI Manager API endpoint for installing custom nodes
      // The exact endpoint may vary, but typically it's something like this
      const response = await this.httpClient.post('/manager/install/custom_node', {
        url: nodeId,
      });

      const result: ComfyManagerApiResponse = {
        success: response.status === 200 || response.status === 201,
        message: (response.data as { message?: string })?.message || 'Custom node installation initiated',
        data: response.data,
      };

      log.info('Custom node installation response:', result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to install custom node:', { nodeId, error: errorMessage });

      return {
        success: false,
        message: `Failed to install custom node: ${errorMessage}`,
      };
    }
  }

  /**
   * Import a workflow or resource
   * @param resourceId The resource identifier
   * @returns Promise with the API response
   */
  async importResource(resourceId: string): Promise<ComfyManagerApiResponse> {
    try {
      log.info('Importing resource via ComfyUI Manager:', resourceId);

      // ComfyUI Manager API endpoint for importing workflows/resources
      // The exact endpoint may vary based on the resource type
      const response = await this.httpClient.post('/manager/import', {
        url: resourceId,
        resource_id: resourceId,
      });

      const result: ComfyManagerApiResponse = {
        success: response.status === 200 || response.status === 201,
        message: (response.data as { message?: string })?.message || 'Resource import initiated',
        data: response.data,
      };

      log.info('Resource import response:', result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to import resource:', { resourceId, error: errorMessage });

      return {
        success: false,
        message: `Failed to import resource: ${errorMessage}`,
      };
    }
  }

  /**
   * Process a protocol action by calling the appropriate ComfyUI Manager API
   * @param action The protocol action to process
   * @returns Promise with the API response
   */
  async processProtocolAction(action: ComfyProtocolAction): Promise<ComfyManagerApiResponse> {
    switch (action.action) {
      case 'install-custom-node':
        return this.installCustomNode(action.params.nodeId);

      case 'import':
        return this.importResource(action.params.nodeId);

      default: {
        // TypeScript exhaustiveness check
        const _exhaustiveCheck: never = action;
        return {
          success: false,
          message: `Unsupported protocol action: ${(_exhaustiveCheck as ComfyProtocolAction).action}`,
        };
      }
    }
  }

  /**
   * Check if ComfyUI Manager is available and responding
   * @returns Promise<boolean> indicating if the service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/manager/status', {
        timeout: 5000, // Shorter timeout for availability check
      });
      return response.status === 200;
    } catch (error) {
      log.debug('ComfyUI Manager not available:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }
}
