/**
 * Errors raised by the maps service.
 *
 * These are deliberately distinct from the API's own error classes: this package
 * is transport-agnostic and must not import anything from `apps/api`. The proxy
 * routes translate `MapsError` into the API's standard error envelope.
 */

export class MapsError extends Error {
  readonly status: number;
  readonly upstreamStatus?: number;

  constructor(message: string, status = 502, upstreamStatus?: number) {
    super(message);
    this.name = "MapsError";
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

/** No result — a valid query that Google simply could not match. Not a failure. */
export class NoResultError extends MapsError {
  constructor(message = "No result found") {
    super(message, 404);
    this.name = "NoResultError";
  }
}

/**
 * The upstream quota is exhausted or the key is unauthorised.
 *
 * Surfaced separately because it is the failure mode that costs money to fix,
 * and the one worth alerting on rather than silently retrying.
 */
export class QuotaError extends MapsError {
  constructor(message = "Maps quota exceeded or key rejected", upstreamStatus?: number) {
    super(message, 503, upstreamStatus);
    this.name = "QuotaError";
  }
}
