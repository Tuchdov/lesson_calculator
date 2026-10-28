export class ServiceError extends Error {
  constructor(status, message, { retryable = false } = {}) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}
