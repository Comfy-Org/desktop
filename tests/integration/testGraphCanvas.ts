import { type Page, expect } from '@playwright/test';

export class TestGraphCanvas {
  readonly canvasContainer;

  constructor(readonly window: Page) {
    this.canvasContainer = window.locator('.graph-canvas-container');
  }

  /** Can be used with `expect().toPass()`. Resolves when canvas container is visible and has a child canvas element. */
  expectLoaded = async () => {
    await expect(this.canvasContainer).toBeVisible();
    await expect(this.canvasContainer.locator('canvas')).not.toHaveCount(0);
  };
}
