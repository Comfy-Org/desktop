import type { Page } from '@playwright/test';

import { expect } from './testExtensions';
import { TestGraphCanvas } from './testGraphCanvas';

export class TestInstalledApp {
  readonly graphCanvas;
  readonly vueApp;
  readonly uiBlockedSpinner;

  readonly missingModelsDialogText;

  constructor(readonly window: Page) {
    this.graphCanvas = new TestGraphCanvas(window);
    this.vueApp = window.locator('#vue-app');
    this.uiBlockedSpinner = this.vueApp.locator('.p-progressspinner');

    this.missingModelsDialogText = window.getByText('When loading the graph, the following models were not found');
  }

  /** Waits until the app is completely loaded. */
  async waitUntilLoaded(timeout = 1.5 * 60 * 1000) {
    await expect(async () => {
      await this.graphCanvas.expectLoaded();
      await expect(this.uiBlockedSpinner).not.toBeVisible();
    }).toPass({ timeout, intervals: [500] });
  }
}
