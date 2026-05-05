import type { HttpAuthService, PermissionsService } from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { catalogEntityReadPermission } from '@backstage/plugin-catalog-common/alpha';
import { z } from 'zod/v3';
import express from 'express';
import Router from 'express-promise-router';
import { uptimerobotCacheReadPermission, uptimerobotCacheResetPermission } from './permissions';
import { UptimeRobotService } from './services/UptimeRobotService';


/** Creates a router for the UptimeRobot backend plugin.
 *
 * @param options - The options for the router.
 * @param options.httpAuth - The HTTP authentication service.
 * @param options.permissions - The permissions service (catalog read + plugin cache permissions).
 * @param options.uptimeRobot - The UptimeRobot service.
 *
 * @returns A router for the UptimeRobot backend plugin.
 */
export async function createRouter({ httpAuth, permissions, uptimeRobot }: {
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  uptimeRobot: UptimeRobotService;
}): Promise<express.Router> {
  const router = Router();
  router.use(express.json());

  // ////////////////////////////////////////
  //         CONSTANTS/TYPES/SCHEMA        //
  // ////////////////////////////////////////

  /** Schema for the entity parameters.
   * 
   * @property kind - The kind of the entity.
   * @property namespace - The namespace of the entity.
   * @property name - The name of the entity.
  */
  const entityParamsSchema = z.object({
    kind: z.string().min(1),
    namespace: z.string().min(1),
    name: z.string().min(1),
  });

  /** Schema for the refresh query.
   * 
   * @property refresh - Whether to refresh the data.
  */
  const refreshQuerySchema = z.object({
    refresh: z.string().optional(),
  });

  /** Creates a entity reference from the parameters.
   * 
   * @param params - The parameters to create the entity reference from.
   * @returns The entity reference.
  */
  const entityRefFromParams = (params: z.infer<typeof entityParamsSchema>) =>
    `${params.kind}:${params.namespace}/${params.name}`;

  // ////////////////////////////////////////
  //               ROUTES                 //
  // ////////////////////////////////////////

  /** Entity-scoped stats endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The stats summary for the entity in JSON format.
   * 
   * @example GET request:
   * GET /entity/Component/default/my-component?refresh=true&days=30&responseTime=true
   */
  router.get('/entity/:kind/:namespace/:name', async (req, res) => {
    // Parse the request parameters
    const parsed = entityParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new InputError(parsed.error.toString());

    // Parse the request query
    const parsedQuery = refreshQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) throw new InputError(parsedQuery.error.toString());

    // Create the entity reference
    const entityRef = entityRefFromParams(parsed.data);
    const credentials = await ensureCatalogEntityRead(req, entityRef);

    // Get the stats for the entity
    const stats = await uptimeRobot.getStatsForEntity(entityRef, {
      credentials,
      refresh: parsedQuery.data.refresh === 'true',
    });

    // Send the stats summary for the entity in JSON format
    res.json(stats);
  });

  /** Entity-scoped stats summary endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The stats summary for the entity in JSON format.
   * 
   * @example GET request:
   * GET /entity/Component/default/my-component/summary?refresh=true&days=30&responseTime=true
   */
  router.get('/entity/:kind/:namespace/:name/summary', async (req, res) => {
    // Parse the request parameters
    const parsed = entityParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new InputError(parsed.error.toString());

    // Parse the request query
    const parsedQuery = refreshQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) throw new InputError(parsedQuery.error.toString());

    // Create the entity reference
    const entityRef = entityRefFromParams(parsed.data);
    const credentials = await ensureCatalogEntityRead(req, entityRef);

    // Get the stats summary for the entity
    const stats = await uptimeRobot.getStatsSummaryForEntity(entityRef, {
      credentials,
      refresh: parsedQuery.data.refresh === 'true',
    });

    // Send the stats summary for the entity in JSON format
    res.json(stats);
  });

  /** Entity-scoped daily uptime endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The daily uptime for the entity in JSON format.
   * 
   * @example GET request:
   * GET /entity/Component/default/my-component/daily-uptime?refresh=true&days=30
   */
  router.get('/entity/:kind/:namespace/:name/daily-uptime', async (req, res) => {
    // Parse the request parameters
    const parsed = entityParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new InputError(parsed.error.toString());

    // Parse the request query
    const parsedQuery = refreshQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) throw new InputError(parsedQuery.error.toString());

    // Create the entity reference
    const entityRef = entityRefFromParams(parsed.data);
    const credentials = await ensureCatalogEntityRead(req, entityRef);

    // Get the daily uptime for the entity
    const dailyUptime = await uptimeRobot.getDailyUptimeForEntity(entityRef, {
      credentials,
      refresh: parsedQuery.data.refresh === 'true',
    });

    // Send the daily uptime for the entity in JSON format
    res.json(dailyUptime);
  });

  /** Entity-scoped response time endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The response time for the entity in JSON format.
   * 
   * @example GET request:
   * GET /entity/Component/default/my-component/response-time?refresh=true&days=30
   */
  router.get('/entity/:kind/:namespace/:name/response-time', async (req, res) => {
    // Parse the request parameters
    const parsed = entityParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new InputError(parsed.error.toString());

    // Parse the request query
    const parsedQuery = refreshQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) throw new InputError(parsedQuery.error.toString());

    // Create the entity reference
    const entityRef = entityRefFromParams(parsed.data);
    const credentials = await ensureCatalogEntityRead(req, entityRef);

    // Get the response time for the entity
    const responseTime = await uptimeRobot.getResponseTimeForEntity(entityRef, {
      credentials,
      refresh: parsedQuery.data.refresh === 'true',
    });

    // Send the response time for the entity in JSON format
    res.json(responseTime ?? null);
  });

  /** Entity-scoped incidents endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The incidents for the entity in JSON format.
   * 
   * @example GET request:
   * GET /entity/Component/default/my-component/incidents?refresh=true&days=30
   */
  router.get('/entity/:kind/:namespace/:name/incidents', async (req, res) => {
    // Parse the request parameters
    const parsed = entityParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new InputError(parsed.error.toString());

    // Parse the request query
    const parsedQuery = refreshQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) throw new InputError(parsedQuery.error.toString());

    // Create the entity reference
    const entityRef = entityRefFromParams(parsed.data);
    const credentials = await ensureCatalogEntityRead(req, entityRef);

    // Get the incidents for the entity
    const incidents = await uptimeRobot.getIncidentsForEntity(entityRef, {
      credentials,
      refresh: parsedQuery.data.refresh === 'true',
    });

    // Send the incidents for the entity in JSON format
    res.json(incidents);
  });

  /** Daily uptime cache statistics endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The daily uptime cache statistics in JSON format.
   * 
   * @example GET request:
   * GET /stats-cache/daily-uptime
   */
  router.get('/stats-cache/daily-uptime', async (_req, res) => {
    // Ensure the cache read permission is granted
    await ensureCacheRead(_req);
    const stats = await uptimeRobot.getDailyUptimeCacheStats();
    res.json(stats);
  });

  /** Daily uptime cache reset endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The result of the cache reset in JSON format.
   * 
   * @example DELETE request:
   * DELETE /stats-cache/daily-uptime
   */
  router.delete('/stats-cache/daily-uptime', async (req, res) => {
    // Ensure the cache reset permission is granted
    await ensureCacheReset(req);
    const result = await uptimeRobot.resetDailyUptimeCache();
    res.json(result);
  });

  /** Entity-scoped daily uptime cache reset endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The result of the cache reset in JSON format.
   * 
   * @example DELETE request:
   * DELETE /entity/Component/default/my-component/daily-uptime-cache
   */
  router.delete('/entity/:kind/:namespace/:name/daily-uptime-cache', async (req, res) => {
    // Parse the request parameters
    const parsed = entityParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new InputError(parsed.error.toString());

    // Create the entity reference
    const entityRef = entityRefFromParams(parsed.data);
    const credentials = await ensureCatalogEntityRead(req, entityRef);
    await ensureCacheReset(req);
    const result = await uptimeRobot.resetDailyUptimeCacheForEntity(entityRef, {
      credentials,
    });

    // Send the result in JSON format
    res.json(result);
  });

  /** Public health endpoint used by the frontend card.
   * 
   * The backend reads catalog annotations to decide whether the entity is enabled
   * and which UptimeRobot monitor name to resolve.
   * 
   * @param req - The request object.
   * @param res - The response object.
   * @returns The public health in JSON format.
   * 
   * @example GET request:
   * GET /health
   */
  router.get('/health', async (_req, res) => {
    // Get the public health
    const h = await uptimeRobot.getPublicHealth();

    // Send the public health in JSON format
    res.status(h.ok ? 200 : 503).json({
      status: h.status,
      configured: h.configured,
      ...(h.detail ? { detail: h.detail } : {}),
    });
  });

  // ////////////////////////////////////////
  //           HELPER FUNCTIONS            //
  // ////////////////////////////////////////

  /** Gets the user credentials from the request.
   * 
   * @param req - The request object.
   * @returns The credentials.
  */
  async function userCredentials(req: express.Request) {
    return httpAuth.credentials(req, { allow: ['user'] });
  }

  /** Ensures the catalog entity read permission is granted.
   * 
   * @param req - The request object.
   * @param entityRef - The entity reference.
   * @returns The credentials.
  */
  async function ensureCatalogEntityRead(req: express.Request, entityRef: string) {
    const credentials = await userCredentials(req);
    const [{ result }] = await permissions.authorize(
      [{ permission: catalogEntityReadPermission, resourceRef: entityRef }],
      { credentials },
    );
    if (result === AuthorizeResult.DENY) {
      throw new NotAllowedError(`Not allowed to read catalog entity ${entityRef}`);
    }
    return credentials;
  }

  /** Ensures the cache read permission is granted.
   * 
   * @param req - The request object.
   * @returns The credentials.
  */
  async function ensureCacheRead(req: express.Request) {
    const credentials = await userCredentials(req);
    const [{ result }] = await permissions.authorize(
      [{ permission: uptimerobotCacheReadPermission }],
      { credentials },
    );
    if (result === AuthorizeResult.DENY) {
      throw new NotAllowedError('Not allowed to read UptimeRobot cache statistics');
    }
    return credentials;
  }

  /** Ensures the cache reset permission is granted.
   * 
   * @param req - The request object.
   * @returns The credentials.
  */
  async function ensureCacheReset(req: express.Request) {
    const credentials = await userCredentials(req);
    const [{ result }] = await permissions.authorize(
      [{ permission: uptimerobotCacheResetPermission }],
      { credentials },
    );
    if (result === AuthorizeResult.DENY) {
      throw new NotAllowedError('Not allowed to reset UptimeRobot caches');
    }
    return credentials;
  }

  return router;
}

