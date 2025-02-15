import { type Page, expect } from '@playwright/test';

import { TestGraphCanvas } from './testGraphCanvas';

export class TestInstalledApp {
  readonly graphCanvas;
  readonly blockUi;

  constructor(readonly window: Page) {
    this.graphCanvas = new TestGraphCanvas(window);
    this.blockUi = window.locator('.p-blockui');
  }

  /** Waits until the app is completely loaded. */
  async waitUntilLoaded(timeout = 1 * 60 * 1000) {
    await expect(async () => {
      await this.graphCanvas.expectLoaded();
      await expect(this.blockUi).not.toBeVisible();
    }).toPass({ timeout, intervals: [500] });
  }

  /** Creates a new blank workflow */
  async createBlankWorkflow() {
    const newWorkflowButton = this.window.getByLabel('Create a new blank workflow');
    await newWorkflowButton.click();
  }

  /** Saves the current workflow */
  async saveWorkflow() {
    await this.window.keyboard.press('Control+S');
    await this.window.waitForSelector('#global-prompt', { state: 'visible' });
    await this.window.keyboard.press('Enter');
    await this.window.waitForSelector('#global-prompt', { state: 'hidden' });
  }

  /** Opens the node searchbox by double clicking on the canvas. */
  async openNodeSearchbox() {
    await this.window.mouse.dblclick(256, 256, { delay: 128 });
    await this.window.waitForSelector('.p-autocomplete');
  }

  /** Opens the node searchbox and adds the first result to the graph. */
  async addFirstNodeResult() {
    await this.openNodeSearchbox();
    await this.window.keyboard.press('Enter');
  }
}
