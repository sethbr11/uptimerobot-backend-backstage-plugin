import { uptimerobotBackendPlugin } from '../plugin';

describe('uptimerobotBackendPlugin', () => {
  it('exports a Backstage backend feature bundle', () => {
    expect(uptimerobotBackendPlugin).toBeDefined();
    expect(uptimerobotBackendPlugin).toMatchObject({
      $$type: '@backstage/BackendFeature',
      featureType: 'registrations',
    });
    expect(typeof (uptimerobotBackendPlugin as { getRegistrations?: () => unknown }).getRegistrations).toBe(
      'function',
    );
  });
});
