import type { Page } from '@playwright/test';

export class TestInstallWizard {
  readonly getStartedButton;
  readonly nextButton;
  readonly cpuToggle;

  constructor(readonly window: Page) {
    this.nextButton = this.getButton('Next');
    this.getStartedButton = this.getButton('Get Started');
    this.cpuToggle = this.window.locator('#cpu-mode');
  }

  async clickNext() {
    await this.nextButton.click();
  }

  async clickGetStarted() {
    await this.getStartedButton.click();
  }

  getButton(name: string) {
    return this.window.getByRole('button', { name });
  }
}
