import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { uptimerobotPermissions } from './permissions';
import { createRouter } from './router';
import { UptimeRobotService } from './services/UptimeRobotService';

/** UptimeRobot backend plugin definition */
export const uptimerobotBackendPlugin = createBackendPlugin({
  pluginId: 'uptimerobot',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogServiceRef,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
      },
      async init({
        catalog,
        config,
        database,
        httpAuth,
        httpRouter,
        logger,
        permissions,
        permissionsRegistry,
      }) {
        permissionsRegistry.addPermissions(uptimerobotPermissions);

        const uptimeRobot = UptimeRobotService.create({
          catalog,
          config,
          database,
          logger,
        });

        // Check for log level configuration
        const lifecyclePauseOk = config.has('backend.lifecycle.startupRequestPauseTimeout');
        const logLifecycle = () => {
          const msg = lifecyclePauseOk
            ? 'backend.lifecycle.startupRequestPauseTimeout is set (plugin routes will wait longer during startup)'
            : 'backend.lifecycle.startupRequestPauseTimeout missing — using default 5s for plugin HTTP middleware; set it in app-config to avoid 503 on entity pages during cold start';
          
          if (config.getOptionalBoolean('uptimerobot.debug')) logger.info(msg);
          else logger.debug(msg);
        };
        logLifecycle();

        // Public health check endpoint
        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });

        // Entity routes
        httpRouter.use(
          await createRouter({
            httpAuth,
            permissions,
            uptimeRobot,
          }),
        );
      },
    });
  },
});
