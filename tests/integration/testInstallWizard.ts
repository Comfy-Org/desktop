import type { Page } from '@playwright/test';

/* CI is slow. */
const getStartedTimeout = process.env.CI ? { timeout: 60 * 1000 } : undefined;

export class TestInstallWizard {
  readonly getStartedButton;
  readonly nextButton;
  readonly installButton;

  readonly cpuToggle;
  readonly installLocationInput;

  readonly selectGpuTitle;
  readonly installLocationTitle;
  readonly migrateTitle;
  readonly desktopSettingsTitle;

  constructor(readonly window: Page) {
    this.nextButton = this.getButton('Next');
    this.getStartedButton = this.getButton('Get Started');
    this.installButton = this.getButton('Install');

    this.cpuToggle = this.window.locator('#cpu-mode');
    this.installLocationInput = this.getInput('', true);

    this.selectGpuTitle = this.window.getByText('Select GPU');
    this.installLocationTitle = this.window.getByText('Choose Installation Location');
    this.migrateTitle = this.window.getByText('Migrate from Existing Installation');
    this.desktopSettingsTitle = this.window.getByText('Desktop App Settings');
  }

  async clickNext() {
    await this.nextButton.click();
  }

  async clickGetStarted() {
    await this.getStartedButton.click(getStartedTimeout);
  }

  getButton(name: string) {
    return this.window.getByRole('button', { name });
  }

  getInput(name: string, exact?: boolean) {
    return this.window.getByRole('textbox', { name, exact });
  }
}
