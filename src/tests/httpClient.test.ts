import { ServiceUnavailableError } from '@backstage/errors';
import { callUptimeRobot, UptimeRobotHttpError } from '../services/httpClient';

describe('callUptimeRobot', () => {
  it('returns operation result when it resolves first', async () => {
    await expect(callUptimeRobot(async () => 42, 5000)).resolves.toBe(42);
  });

  it('maps API Error 429 to UptimeRobotHttpError', async () => {
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('API Error (429): slow down')), 5000),
    ).rejects.toMatchObject({ name: 'UptimeRobotHttpError', statusCode: 429 });
  });

  it('maps other API Error codes to ServiceUnavailableError', async () => {
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('API Error (503): maintenance')), 5000),
    ).rejects.toThrow(ServiceUnavailableError);
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('API Error (503): maintenance')), 5000),
    ).rejects.toThrow(/503/);
  });

  it('maps network-style messages to ServiceUnavailableError', async () => {
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('Network Error: ECONNRESET')), 5000),
    ).rejects.toThrow(ServiceUnavailableError);
    await expect(
      callUptimeRobot(() => Promise.reject(new Error('Multipart API Error: boundary')), 5000),
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it('wraps generic errors in ServiceUnavailableError', async () => {
    await expect(callUptimeRobot(() => Promise.reject(new Error('boom')), 5000)).rejects.toThrow(
      ServiceUnavailableError,
    );
    await expect(callUptimeRobot(() => Promise.reject(new Error('boom')), 5000)).rejects.toThrow('boom');
  });
});
