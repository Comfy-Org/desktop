import { type Page, expect } from '@playwright/test';

import { TestGraphCanvas } from './testGraphCanvas';

export class TestInstalledApp {
  readonly graphCanvas;

  constructor(readonly window: Page) {
    this.graphCanvas = new TestGraphCanvas(window);
  }

  async expectCanvasLoaded(timeout = 60 * 1000, intervals = [500]) {
    await expect(async () => {
      await expect(this.graphCanvas.canvasContainer).toBeVisible();
      await expect(this.graphCanvas.canvasContainer).not.toHaveCount(0);
    }).toPass({ timeout, intervals });
  }
}
