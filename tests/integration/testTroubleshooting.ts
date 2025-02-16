import type { Page } from '@playwright/test';

import { expect } from './testExtensions';
import { TestTaskCard } from './testTaskCard';

export class TestTroubleshooting {
  readonly refreshButton;

  readonly basePathCard;
  readonly vcRedistCard;
  readonly installPythonPackagesCard;
  readonly resetVenvCard;

  constructor(readonly window: Page) {
    this.refreshButton = window.locator('button.relative.p-button-icon-only');

    this.basePathCard = new TestTaskCard(window, /^Base path$/, 'Select');
    this.vcRedistCard = new TestTaskCard(window, /^Download VC\+\+ Redist$/, 'Download');
    this.installPythonPackagesCard = new TestTaskCard(window, /^Install python packages$/, 'Install');
    this.resetVenvCard = new TestTaskCard(window, /^Reset virtual environment$/, 'Recreate');
  }

  async expectReady() {
    await expect(this.refreshButton).toBeVisible();
    await expect(this.refreshButton).not.toBeDisabled();
  }

  async refresh() {
    await this.refreshButton.click();
  }

  getTaskCard(regex: RegExp) {
    return this.window.locator('div.task-div').filter({ hasText: regex });
  }
}
