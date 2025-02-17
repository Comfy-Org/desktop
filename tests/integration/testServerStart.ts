import type { Page } from '@playwright/test';

import { expect } from './testExtensions';
import { TestServerStatus } from './testServerStatus';

export class TestServerStart {
  readonly openLogsButton;
  readonly reportIssueButton;
  readonly reinstallButton;
  readonly showTerminalButton;
  readonly terminal;
  readonly status;

  constructor(readonly window: Page) {
    this.reportIssueButton = this.getButton('Report Issue');
    this.openLogsButton = this.getButton('Open Logs');
    this.reinstallButton = this.getButton('Reinstall');
    this.showTerminalButton = this.getButton('Show Terminal');

    this.terminal = this.window.locator('.terminal-host');
    this.status = new TestServerStatus(this.window);
  }

  getButton(name: string) {
    return this.window.getByRole('button', { name });
  }

  getInput(name: string, exact?: boolean) {
    return this.window.getByRole('textbox', { name, exact });
  }

  encounteredError() {
    return this.status.error.isVisible();
  }

  async expectServerStarts(timeout = 30 * 1000) {
    const anyStatusVisible = async () => await expect(this.status.get()).resolves.not.toBe('unknown');

    await expect(anyStatusVisible).toPass({ timeout, intervals: [500] });
  }
}
