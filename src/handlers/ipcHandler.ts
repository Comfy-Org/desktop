import { PathHandlers } from './pathHandlers';

export class IPCHandler {
  constructor() {}

  registerHandlers() {
    new PathHandlers().registerHandlers();
  }
}
