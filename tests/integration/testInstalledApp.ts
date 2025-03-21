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

    this.firstTimeTemplateWorkflowText = window.getByText('Get started with a template');
  }

  /** Waits until the app is completely loaded. */
  async waitUntilLoaded(timeout = 1.5 * 60 * 1000) {
    await expect(async () => {
      await this.graphCanvas.expectLoaded();
      await expect(this.uiBlockedSpinner).not.toBeVisible();
    }).toPass({ timeout, intervals: [500] });
  }
}
