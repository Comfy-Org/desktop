import type { Page, TestInfo } from '@playwright/test';

function getButton(window: Page, name: string) {
  return window.getByRole('button', { name });
}

export class TestInstallWizard implements AsyncDisposable {
  constructor(
    readonly window: Page,
    readonly testInfo: TestInfo
  ) {}

  get getStartedButton() {
    return getButton(this.window, 'Get Started');
  }

  get nextButton() {
    return getButton(this.window, 'Next');
  }

  async [Symbol.asyncDispose](): Promise<void> {}
}
