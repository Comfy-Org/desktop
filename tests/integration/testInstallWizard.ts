import type { Page, TestInfo } from '@playwright/test';

export class TestInstallWizard implements AsyncDisposable {
  readonly getStartedButton;
  readonly nextButton;
  readonly cpuToggle;

  constructor(
    readonly window: Page,
    readonly testInfo: TestInfo
  ) {
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

  async [Symbol.asyncDispose](): Promise<void> {}
}
