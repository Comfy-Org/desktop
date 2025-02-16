import type { Page } from '@playwright/test';

import { expect } from './testExtensions';
import { TestGraphCanvas } from './testGraphCanvas';

export class TestInstalledApp {
  readonly graphCanvas;
  readonly blockUi;

  constructor(readonly window: Page) {
    this.graphCanvas = new TestGraphCanvas(window);
    this.blockUi = window.locator('.p-blockui');
  }

  /** Waits until the app is completely loaded. */
  async waitUntilLoaded(timeout = 1.5 * 60 * 1000) {
    await expect(async () => {
      await this.graphCanvas.expectLoaded();
      await expect(this.blockUi).not.toBeVisible();
    }).toPass({ timeout, intervals: [500] });
  }
}
