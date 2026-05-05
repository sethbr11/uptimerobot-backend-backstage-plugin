import { createBackend } from '@backstage/backend-defaults';
import { mockServices } from '@backstage/backend-test-utils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION } from '../src/annotationDefaults';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';

// Minimal backend for plugin dev. Smoke-test the plugin (no catalog permissions):
//   curl http://localhost:7007/api/uptimerobot/health

const backend = createBackend();

backend.add(mockServices.auth.factory());
backend.add(mockServices.httpAuth.factory());
backend.add(mockServices.permissions.factory({ result: AuthorizeResult.ALLOW }));
backend.add(mockServices.permissionsRegistry.factory());

backend.add(
  catalogServiceMock.factory({
    entities: [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          name: 'sample',
          title: 'Sample Component',
          annotations: {
            [UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION]: 'true',
          },
        },
        spec: {
          type: 'service',
        },
      },
    ],
  }),
);

backend.add(import('../src'));

backend.start();
