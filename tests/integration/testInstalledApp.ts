import type { Page } from '@playwright/test';

import { expect } from './testExtensions';
import { TestGraphCanvas } from './testGraphCanvas';

export class TestInstalledApp {
  readonly graphCanvas;
  readonly vueApp;
  readonly uiBlockedSpinner;

  readonly firstTimeTemplateWorkflowText;

  constructor(readonly window: Page) {
    this.graphCanvas = new TestGraphCanvas(window);
    this.vueApp = window.locator('#vue-app');
    this.uiBlockedSpinner = this.vueApp.locator('.p-progressspinner');

    // Use canvas container as a stable readiness indicator instead of text
    this.firstTimeTemplateWorkflowText = this.graphCanvas.canvasContainer;
  }

  /** Waits until the app is completely loaded. */
  async waitUntilLoaded(timeout = 1.5 * 60 * 1000) {
    await expect(async () => {
      await this.graphCanvas.expectLoaded();
      await expect(this.uiBlockedSpinner).not.toBeVisible();
    }).toPass({ timeout, intervals: [500] });
  }
}
