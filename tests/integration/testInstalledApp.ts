import type { Page } from '@playwright/test';

import { TestGraphCanvas } from './testGraphCanvas';

export class TestInstalledApp {
  readonly graphCanvas;

  constructor(readonly window: Page) {
    this.graphCanvas = new TestGraphCanvas(window);
  }

  /** Can be used with `expect().toPass()`. Resolves when canvas container is visible and has any child elements. */
  get canvasLoaded() {
    return this.graphCanvas.isLoaded;
  }

  async waitUntilLoaded(timeout = 1 * 60 * 1000) {
    await expect(this.canvasLoaded).toPass({ timeout });
  }
}
