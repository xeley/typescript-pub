export class BadRequestError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = "BadRequestError";
  }
}

export class TenantHeaderMissingError extends BadRequestError {
  constructor() {
    super("Missing required header: x-tenant-id");
    this.name = "TenantHeaderMissingError";
  }
}
