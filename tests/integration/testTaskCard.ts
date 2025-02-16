import type { Page } from '@playwright/test';

export class TestTaskCard {
  readonly rootEl;
  readonly button;
  readonly buttonLoading;

  constructor(
    readonly window: Page,
    title: RegExp,
    buttonText: string
  ) {
    const titleDiv = window.getByText(title);
    this.rootEl = window.locator('div.task-div').filter({ has: titleDiv });
    this.button = this.rootEl.locator('_vue=Button').filter({ hasText: buttonText });
    this.buttonLoading = this.button.and(this.rootEl.locator('.p-button-loading'));
  }
}
