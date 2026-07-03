export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function getErrorPayload(error) {
  return {
    statusCode: error instanceof HttpError ? error.statusCode : 400,
    body: {
      error: error instanceof Error ? error.message : "Unknown error"
    }
  };
}
