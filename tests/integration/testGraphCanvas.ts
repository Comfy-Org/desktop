import { type Page, expect } from '@playwright/test';

export class TestGraphCanvas {
  readonly canvasContainer;

  constructor(readonly window: Page) {
    this.canvasContainer = this.window.locator('.graph-canvas-container');
  }

  async isCanvasLoaded(timeout = 60 * 1000, intervals = [500]) {
    await expect(async () => {
      await expect(this.canvasContainer).toBeVisible();
      await expect(this.canvasContainer).not.toHaveCount(0);
    }).toPass({ timeout, intervals });
  }
}
