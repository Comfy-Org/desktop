import type { Page } from '@playwright/test';

export class TestTaskCard {
  readonly rootEl;
  readonly button;

  constructor(
    readonly window: Page,
    title: RegExp,
    buttonText: string
  ) {
    const titleDiv = window.getByText(title);
    this.rootEl = window.locator('div.task-div').filter({ has: titleDiv });
    this.button = this.rootEl.getByRole('button', { name: buttonText });
  }
}
