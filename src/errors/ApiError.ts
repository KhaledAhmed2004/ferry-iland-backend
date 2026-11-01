class ApiError extends Error {
  statusCode: number;
  data?: Record<string, unknown>;
  constructor(statusCode: number, message: string | undefined, stack = '', data?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default ApiError;
