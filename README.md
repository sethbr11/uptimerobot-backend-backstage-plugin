# `@backstage-community/plugin-uptimerobot-backend`

**UNOFFICIAL Backstage backend plugin that keeps your UptimeRobot API key on the server and serves catalog-scoped monitor stats over HTTP.**

[![npm](https://img.shields.io/npm/v/@backstage-community/plugin-uptimerobot-backend?style=flat-square&logo=npm&label=npm)](https://www.npmjs.com/package/@backstage-community/plugin-uptimerobot-backend)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](https://opensource.org/licenses/Apache-2.0)
[![Backstage](https://img.shields.io/badge/Backstage-backend%20plugin-36B37E?style=flat-square&logo=backstage)](https://backstage.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## Overview

This plugin is intended for teams who use **[UptimeRobot](https://uptimerobot.com/)** and want monitor status, uptime windows, response-time charts, and recent incidents **inside Backstage entity pages**—without exposing the read-only API key to the browser.

It:

- Resolves each entity’s monitor from **catalog annotations**
- Calls **UptimeRobot API v3** (`api.uptimerobot.com`) via [`uptime-robot-v3`](https://www.npmjs.com/package/uptime-robot-v3)
- Exposes a small **JSON HTTP API** under your app’s UptimeRobot backend route (typically `/api/uptimerobot`)
- Optionally **persists daily uptime buckets** in the Backstage database for fewer repeat API calls
- Integrates with the **Backstage permission framework** for cache admin routes

Pair the backend with the frontend package **[`@backstage-community/plugin-uptimerobot`](../uptimerobot/README.md)** (or consume the HTTP API from your own UI).

---

## Table of contents

- [Installation](#installation)
- [Configuration reference](#configuration-reference)
- [Graphs (`graphs`)](#graphs-graphs)
- [Catalog annotations](#catalog-annotations)
- [HTTP API](#http-api)
- [Permissions](#permissions)
- [Caching and database](#caching-and-database)
- [Health check](#health-check)
- [NPM package exports](#npm-package-exports)
- [Development](#development)

---

## Installation

### 1. Add the dependency

From your Backstage **backend** package (often `packages/backend`):

```bash
yarn add @backstage-community/plugin-uptimerobot-backend
```

### 2. Register the plugin

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage-community/plugin-uptimerobot-backend'));
```

### 3. Configure `app-config.yaml`

At minimum, set your UptimeRobot **read-only** API key (see [Configuration reference](#configuration-reference)).

Run config validation as you normally would (for example `yarn backstage-cli config:check` from the repo root). This package ships a **`configSchema`** (`config.d.ts`) so unknown keys are caught early.

---

## Configuration reference

All keys live under the root key **`uptimerobot`**. Types and JSDoc comments are defined in [`config.d.ts`](./config.d.ts).

| YAML key | Type | Default | Description |
|----------|------|---------|-------------|
| **`uptimerobot.apiKey`** | `string` | _none_ | UptimeRobot **v3 read-only** API key. If omitted, entity stats routes return an error when invoked; [`GET /health`](#health-check) still returns `200` with `configured: false`. |
| **`uptimerobot.debug`** | `boolean` | `false` | When `true`, emits extra diagnostics (e.g. lifecycle / startup hints) at **`info`** log level where applicable. |
| **`uptimerobot.cacheTtlSeconds`** | `number` (positive integer) | `600` | **In-memory** TTL (seconds) for full **entity stats** and **summary** responses. Clients can bypass with **`?refresh=true`**. |
| **`uptimerobot.httpTimeoutSeconds`** | `number` (positive integer) | `45` | Timeout (seconds) for each outbound HTTP call to `api.uptimerobot.com`. |
| **`uptimerobot.catalog.entityAnnotation`** | `string` | `backstage.io/uptimerobot` | Catalog metadata annotation used to choose the monitor (or disable the integration). See [Catalog annotations](#catalog-annotations). |
| **`uptimerobot.monitors.listPageLimit`** | `number` (positive integer) | `50` | Page size when listing monitors while **resolving by friendly name**. |
| **`uptimerobot.monitors.listMaxPages`** | `number` (positive integer) | `80` | Maximum pages to walk when searching for a monitor by name. |
| **`uptimerobot.graphs`** | `object` | _see below_ | Optional **daily uptime** and **response time** graph settings. See [Graphs (`graphs`)](#graphs-graphs). |

### Graphs (`graphs`)

Each graph can be configured as a **boolean shorthand** or a **full object**.

#### `uptimerobot.graphs.dailyUptime`

| Form | Effect |
|------|--------|
| **Omitted** | Daily uptime graph **off**; no per-day `stats/uptime` calls for the chart; no daily rows written to the DB cache. |
| **Boolean** (`true` / `false`) | Toggles the feature. When `true`, **`days`** defaults to **`30`**. |
| **`{ enabled, days }`** | `enabled` turns the feature on or off. `days` is the number of **UTC calendar days** shown (and fetched when not cached). **Default `days`:** `30`. **Min:** `1`. **Max:** `90` (values above are clamped and a warning is logged). |

When enabled, the backend may issue **one UptimeRobot request per day** in the window (plus summary windows elsewhere). Cached historical days are reused; **today** is refreshed on each request unless served from the in-memory entity cache.

**Database retention:** Rows in `uptimerobot_daily_uptime` older than the **90-day** UTC window are pruned on refresh, even if `days` is smaller, so operators can widen the graph later without having lost long history.

#### `uptimerobot.graphs.responseTime`

| Form | Effect |
|------|--------|
| **Omitted** | Response-time chart **off**. |
| **Boolean** | Toggles the feature. When `true`, **`days`** defaults to **`90`**. |
| **`{ enabled, days }`** | Single `stats/response-time` style request over **`days`**. **Default `days`:** `90`. **Min:** `1`. **Max:** `90` (clamped with a warning). |

#### Example: production-style config

```yaml
uptimerobot:
  apiKey: ${UPTIME_ROBOT_API_KEY}
  cacheTtlSeconds: 600
  httpTimeoutSeconds: 45
  debug: false
  catalog:
    entityAnnotation: backstage.io/uptimerobot
  monitors:
    listPageLimit: 50
    listMaxPages: 80
  graphs:
    dailyUptime:
      enabled: true
      days: 30
    responseTime:
      enabled: true
      days: 90
```

#### Example: boolean shorthand

```yaml
uptimerobot:
  apiKey: ${UPTIME_ROBOT_API_KEY}
  graphs:
    dailyUptime: true # days default 30
    responseTime: false
```

---

## Catalog annotations

### Monitor selector (configurable key)

**Default annotation:** `backstage.io/uptimerobot`  
**Override:** `uptimerobot.catalog.entityAnnotation`

| Annotation value | Behavior |
|------------------|----------|
| **Missing** | Entity cannot use the integration; API returns an error when stats are requested. |
| **Empty / whitespace** | Treated as invalid; API returns an error. |
| **`true`**, **`1`**, **`yes`** (case-insensitive) | Monitor **friendly name** = entity **`metadata.name`**. |
| **`false`**, **`0`**, **`no`**, **`off`** (case-insensitive) | Integration **explicitly disabled** for this entity; stats endpoints return **`400`** with a clear message if called. |
| **Any other non-empty string** | That string is used as the UptimeRobot monitor **friendly name** (case-insensitive match against the API). |

Constants for use in custom tooling or docs:

```ts
import {
  UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION,
  UPTIMEROBOT_MONITOR_URL_ANNOTATION,
} from '@backstage-community/plugin-uptimerobot-backend';
```

### Optional card link URL

**Annotation:** `backstage.io/uptimerobot-monitor-url` (see `UPTIMEROBOT_MONITOR_URL_ANNOTATION`)

- **Purpose:** Override the **clickable URL** shown with the monitor on the entity card (e.g. link to your service dashboard).
- **Must** be an absolute URL whose scheme is **`http://`** or **`https://`** after trim.
- Invalid or non-HTTP(S) values are ignored and a **warning** is logged; the card falls back to default presentation.

---

## HTTP API

Unless noted, routes expect a **logged-in user** (Backstage **`httpAuth`**) and successful **catalog entity read** for the target ref `kind:namespace/name`.

**Base path:** your deployment’s backend mount point for this plugin (commonly **`/api/uptimerobot`**).

### Query parameters

| Parameter | Values | Applies to |
|-----------|--------|------------|
| **`refresh`** | `true` or omitted | All **`GET`** entity routes below. When `refresh=true`, bypasses the plugin’s **in-memory** stats/summary cache for that request. |

### Routes

| Method | Path | Auth / permissions | Description |
|--------|------|----------------------|-------------|
| **GET** | `/health` | **Unauthenticated** (see [`plugin.ts`](./src/plugin.ts) auth policy) | Liveness / configuration probe. See [Health check](#health-check). |
| **GET** | `/entity/:kind/:namespace/:name` | User + **catalog** read for entity | Full **monitor stats** payload (summary fields, optional daily uptime array, optional response time, incidents). |
| **GET** | `/entity/:kind/:namespace/:name/summary` | User + **catalog** read | Lighter **summary** payload (faster path for cards that only need tiles). |
| **GET** | `/entity/:kind/:namespace/:name/daily-uptime` | User + **catalog** read | **Daily uptime** series only (when `graphs.dailyUptime` is enabled in config). |
| **GET** | `/entity/:kind/:namespace/:name/response-time` | User + **catalog** read | **Response time** chart JSON, or JSON **`null`** when the response-time graph is disabled. |
| **GET** | `/entity/:kind/:namespace/:name/incidents` | User + **catalog** read | **Incidents** for the monitor (default lookback **90 days**; see [`UptimeRobotService`](./src/services/UptimeRobotService.ts)). |
| **GET** | `/stats-cache/daily-uptime` | User + **`uptimerobot.cache.read`** | Aggregate stats for the persisted **daily uptime** cache (record counts, date range). |
| **DELETE** | `/stats-cache/daily-uptime` | User + **`uptimerobot.cache.reset`** | Clears **all** daily uptime DB rows and in-memory entity caches. |
| **DELETE** | `/entity/:kind/:namespace/:name/daily-uptime-cache` | User + **catalog** read **and** **`uptimerobot.cache.reset`** | Clears persisted daily uptime rows **for that entity** and in-memory entity caches. |

> **Note:** There is **no** `POST /entity` route in current versions; clients should use **`GET`** with path parameters as above.

---

## Permissions

The plugin registers the following permission resources (for `@backstage/plugin-permission-backend` policies):

| Permission | Name | Used on |
|------------|------|---------|
| **Read cache stats** | `uptimerobot.cache.read` | `GET /stats-cache/daily-uptime` |
| **Reset caches** | `uptimerobot.cache.reset` | `DELETE /stats-cache/daily-uptime`, `DELETE /entity/.../daily-uptime-cache` |

**Entity stats routes** additionally require the standard **catalog entity read** permission for the resolved entity ref (same model as other catalog-backed features).

Import helpers when authoring policies:

```ts
import {
  uptimerobotCacheReadPermission,
  uptimerobotCacheResetPermission,
  uptimerobotPermissions,
} from '@backstage-community/plugin-uptimerobot-backend';
```

If you run the **allow-all** permission policy in development, no extra rules are required.

---

## Caching and database

### In-memory cache

- **Keys:** Full entity stats and summary responses (per entity ref).
- **TTL:** `uptimerobot.cacheTtlSeconds` (default **10 minutes**).
- **Bypass:** `?refresh=true` on the corresponding **GET** request.

### Daily uptime table

When **`graphs.dailyUptime`** is enabled, the plugin ensures a table named **`uptimerobot_daily_uptime`** exists and stores one row per monitor per UTC **day** (skipped entirely when `backend.database.migrations.skip` is `true`, consistent with other Backstage DB plugins).

**Cache admin** and **per-entity reset** are available via the [HTTP API](#http-api) and require the [permissions](#permissions) above.

---

## Health check

**`GET /health`** is intentionally **public** (no user token required) so load balancers and platform probes can use it.

| `uptimerobot.apiKey` | Behavior |
|----------------------|----------|
| **Not set** | **`200`** — `{ "status": "ok", "configured": false, "detail": "..." }` (no call to UptimeRobot). |
| **Set** | Performs a **minimal** `monitors.list` call (limit **1**). **Success:** **`200`**, `{ "status": "ok", "configured": true }`. **Failure:** **`503`**, `{ "status": "error", "configured": true, "detail": "..." }`. |

Use this endpoint for **app-level** health aggregation instead of calling UptimeRobot directly from edge systems (keeps keys off untrusted paths).

---

## NPM package exports

Published **`main`** / **`types`** point at the built **`dist/`** output. Source layout uses `src/index.ts` for local Backstage monorepos.

| Export | Description |
|--------|-------------|
| **default** | `uptimerobotBackendPlugin` — `backend.add(...)` entrypoint. |
| **`uptimerobotCacheReadPermission`**, **`uptimerobotCacheResetPermission`**, **`uptimerobotPermissions`** | Permission definitions. |
| **`UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION`**, **`UPTIMEROBOT_MONITOR_URL_ANNOTATION`** | Default annotation keys. |
| **Types** | `DailyUptime`, `GraphDisplay`, `BasicIncident`, `MonitorStats`, `MonitorSummaryStats`, `ResponseTimeChart`, `ResponseTimePoint` — JSON shapes returned by the service / API. |

---

## Development

```bash
yarn install
yarn build
yarn lint
yarn test
yarn test:coverage
```

---

## License

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). SPDX identifier: **`Apache-2.0`** (see [`package.json`](./package.json) `license` field).
