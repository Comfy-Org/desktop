import * as os from 'node:os';
import * as pty from 'node-pty';
import { AppWindow } from './main-process/appWindow';
import { IPC_CHANNELS } from './constants';

export class Terminal {
  #pty: pty.IPty | undefined;
  #window: AppWindow | undefined;
  #cwd: string | undefined;

  readonly sessionBuffer: string[] = [];
  readonly size = { cols: 80, rows: 30 };

  get pty() {
    this.#pty ??= this.#createPty();
    return this.#pty;
  }

  get window() {
    if (!this.#window) throw new Error('AppWindow not initialized.');
    return this.#window;
  }

  constructor(window: AppWindow, cwd: string) {
    this.#window = window;
    this.#cwd = cwd;
  }

  write(data: string) {
    this.pty.write(data);
  }

  resize(cols: number, rows: number) {
    this.pty.resize(cols, rows);
    this.size.cols = cols;
    this.size.rows = rows;
  }

  restore() {
    return {
      buffer: this.sessionBuffer,
      size: this.size,
    };
  }

  #createPty() {
    const window = this.window;
    // TODO: does this want to be a setting?
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const instance = pty.spawn(shell, [], {
      handleFlowControl: false,
      conptyInheritCursor: false,
      name: 'comfyui-terminal',
      cols: this.size.cols,
      rows: this.size.rows,
      cwd: this.#cwd,
    });

    instance.onData((data) => {
      this.sessionBuffer.push(data);
      window.send(IPC_CHANNELS.TERMINAL_ON_OUTPUT, data);
      if (this.sessionBuffer.length > 1000) this.sessionBuffer.shift();
    });

    return instance;
  }
}
