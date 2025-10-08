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

    // Updated selectors for frontend v1.27.x
    this.cpuToggle = this.window.getByRole('button', { name: 'CPU' });
    // The install path input is the visible textbox on Step 2
    // Prefer placeholder to avoid ambiguity with hidden inputs
    this.installLocationInput = this.window.getByPlaceholder(/ComfyUI/);

    this.selectGpuTitle = this.window.getByText('Choose your hardware setup');
    this.installLocationTitle = this.window.getByText('Choose where to install ComfyUI');
    // Migration is now an accordion section on the install location step
    this.migrateTitle = this.window.getByText('Migrate from existing installation');
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
