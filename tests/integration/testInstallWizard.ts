import type { Page } from '@playwright/test';

export class TestInstallWizard {
  readonly getStartedButton;
  readonly nextButton;
  readonly cpuToggle;
  readonly installLocationInput;
  readonly installButton;

  constructor(readonly window: Page) {
    this.nextButton = this.getButton('Next');
    this.getStartedButton = this.getButton('Get Started');
    this.cpuToggle = this.window.locator('#cpu-mode');
    this.installLocationInput = this.getInput('', true);
    this.installButton = this.getButton('Install');
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

  getInput(name: string, exact?: boolean) {
    return this.window.getByRole('textbox', { name, exact });
  }

  async stepThroughOnboarding() {
    await this.clickGetStarted();
    await this.cpuToggle.click();
    await this.clickNext();
    await this.clickNext();
    await this.clickNext();
    await this.installButton.click();

    // Wait for app to be ready
    await this.window.waitForFunction(() => {
      // @ts-expect-error window is not typed
      return window['app'] && window['app'].extensionManager;
    });
  }
}
