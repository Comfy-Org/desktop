import type { Page } from '@playwright/test';

export class TestServerStatus {
  readonly loading;
  readonly settingUpPython;
  readonly startingComfyUI;
  readonly finishing;
  readonly error;

  readonly errorDesktopVersion;

  constructor(readonly window: Page) {
    this.loading = window.getByText('Loading...');
    this.settingUpPython = window.getByText('Setting up Python Environment...');
    this.startingComfyUI = window.getByText('Starting ComfyUI server...');
    this.finishing = window.getByText('Finishing...');
    this.error = window.getByText('Unable to start ComfyUI Desktop');

    this.errorDesktopVersion = this.error.locator('span');
  }

  async get() {
    if (await this.loading.isVisible()) return 'loading';
    if (await this.settingUpPython.isVisible()) return 'setting up python';
    if (await this.startingComfyUI.isVisible()) return 'starting comfyui';
    if (await this.finishing.isVisible()) return 'finishing';
    if (await this.error.isVisible()) return 'error';

    return 'unknown';
  }
}
