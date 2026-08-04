import { ServiceUnavailableError } from '@backstage/errors';
import { callUptimeRobot } from '../services/httpClient';

describe('callUptimeRobot', () => {
  it('returns operation result when it resolves first', async () => {
    await expect(callUptimeRobot(async () => 42, 5000)).resolves.toBe(42);
  });

  it('maps API Error 429 to UptimeRobotHttpError without upstream detail', async () => {
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('API Error (429): internal quota xyz')), 5000),
    ).rejects.toMatchObject({
      name: 'UptimeRobotHttpError',
      statusCode: 429,
      message: 'UptimeRobot rate limit reached. Try again in about a minute.',
    });
  });

  it('maps other API Error codes to ServiceUnavailableError without upstream detail', async () => {
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('API Error (503): secret-maintenance-token')), 5000),
    ).rejects.toThrow(ServiceUnavailableError);
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('API Error (503): secret-maintenance-token')), 5000),
    ).rejects.toThrow('UptimeRobot request failed (503).');
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('API Error (503): secret-maintenance-token')), 5000),
    ).rejects.not.toThrow(/secret-maintenance-token/);
  });

  it('maps network-style messages to a generic ServiceUnavailableError', async () => {
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('Network Error: ECONNRESET')), 5000),
    ).rejects.toThrow('UptimeRobot request failed (network error).');
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('Multipart API Error: boundary')), 5000),
    ).rejects.toThrow('UptimeRobot request failed (network error).');
  });

  it('wraps generic errors without forwarding the original message', async () => {
    await expect(callUptimeRobot(() => Promise.reject(new Error('boom-internal')), 5000)).rejects.toThrow(
      ServiceUnavailableError,
    );
    await expect(callUptimeRobot(() => Promise.reject(new Error('boom-internal')), 5000)).rejects.toThrow(
      'UptimeRobot request failed.',
    );
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('boom-internal')), 5000),
    ).rejects.not.toThrow(/boom-internal/);
  });
});
