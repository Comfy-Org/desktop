import type { Page } from '@playwright/test';

export class TestInstallWizard {
  readonly getStartedButton;
  readonly nextButton;
  readonly cpuToggle;
  readonly installLocationInput;

  constructor(readonly window: Page) {
    this.nextButton = this.getButton('Next');
    this.getStartedButton = this.getButton('Get Started');
    this.cpuToggle = this.window.locator('#cpu-mode');
    this.installLocationInput = this.getInput('', true);
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
}
