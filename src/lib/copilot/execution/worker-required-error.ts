export class CopilotWorkerRequiredError extends Error {
  constructor() {
    super('Copilot worker is required for chat execution. Start the app with npm run aspire:run or configure COPILOT_WORKER_URL.');
    this.name = 'CopilotWorkerRequiredError';
  }
}
