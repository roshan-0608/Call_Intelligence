/**
 * One success shape for the whole API.
 *
 * Every 2xx body looks like this:
 * ```json
 * { "success": true, "statusCode": 200, "message": "Calls fetched", "data": { … } }
 * ```
 *
 * The payload always sits under `data`, so a client can unwrap any response
 * without knowing which endpoint it came from, and adding a top-level field
 * later (pagination cursors, deprecation notices) does not collide with the
 * payload's own keys.
 *
 * The frontend never destructures this by hand: `shared/src/api.ts` exposes
 * `apiResponseSchema(payloadSchema)`, so the envelope is validated and unwrapped
 * in one place.
 */
export class ApiResponse<T> {
  readonly success: boolean;

  constructor(
    readonly statusCode: number,
    readonly data: T,
    readonly message: string = 'Success',
  ) {
    // Anything below 400 that reached here is a success by definition.
    this.success = statusCode < 400;
  }
}
