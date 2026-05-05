import { ServiceUnavailableError } from '@backstage/errors';

// ////////////////////////////////////////////
//         EXPORTED CLASSES/FUNCTIONS        //
// ////////////////////////////////////////////

/** Thrown for UptimeRobot HTTP responses we surface as retryable / distinct from generic failures. */
export class UptimeRobotHttpError extends Error {
  readonly statusCode: number;

  /** The UptimeRobot HTTP error constructor
   * 
   * @param statusCode - The status code of the UptimeRobot HTTP error
   * @param message - The message of the UptimeRobot HTTP error
   * @returns The UptimeRobot HTTP error
   */
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'UptimeRobotHttpError';
    this.statusCode = statusCode;
  }
}

/** Call the UptimeRobot API with a timeout
 * 
 * @param operation - The operation to call the UptimeRobot API with
 * @param timeoutMs - The timeout in milliseconds
 * @returns The result of the operation
 */
export async function callUptimeRobot<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // Create a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `UptimeRobot HTTP call timed out after ${timeoutMs / 1000}s (no response from api.uptimerobot.com).`,
        ),
      );
    }, timeoutMs);
  });

  // Call the operation and return the result
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } catch (e) {
    return mapUptimeRobotClientError(e);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// ////////////////////////////////////////////
//              HELPER UTILITIES             //
// ////////////////////////////////////////////

/** Map a UptimeRobot client error to a UptimeRobot HTTP error
 * 
 * @param error - The UptimeRobot client error
 * @returns The UptimeRobot HTTP error
 */
function mapUptimeRobotClientError(error: unknown): never {
  const msg = error instanceof Error ? error.message : String(error);

  // Test if the error is a UptimeRobot API error
  const apiMatch = /^API Error \((\d+)\):\s*(.*)$/s.exec(msg);
  if (apiMatch) {
    const status = Number(apiMatch[1]);
    const detail = (apiMatch[2] || '').trim();

    // 429: Rate limit reached
    if (status === 429) {
      throw new UptimeRobotHttpError(429,
        `UptimeRobot rate limit reached (free plans allow about 10 API calls per minute, while the pro plan allows up to 5000).${
          detail ? ` ${detail}` : ''
        } Try again in about a minute.`,
      );
    }

    // 500: Internal server error
    throw new ServiceUnavailableError(
      `UptimeRobot request failed: ${status}${detail ? ` — ${detail}` : ''}`,
    );
  }

  // Test if the error is a network error
  if (msg.startsWith('Network Error:') || msg.startsWith('Multipart API Error:')) {
    throw new ServiceUnavailableError(msg);
  }

  // Throw the error as a service unavailable error
  throw error instanceof Error
    ? new ServiceUnavailableError(msg)
    : new ServiceUnavailableError(String(error));
}
