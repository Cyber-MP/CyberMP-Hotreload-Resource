import chokidar, { FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import toml from 'smol-toml';

interface ResourceConfig {
  hotreload?: boolean;
  client_script?: string | string[];
  server_script?: string | string[];
}

// Store active watchers so we can stop them later
const activeWatchers = new Map<string, FSWatcher>();

const reloadingPool = new Set<string>();

/**
 * Normalizes the config values into absolute paths.
 */
const resolveBuildPaths = (
  basePath: string,
  entry?: string | string[],
): string[] => {
  if (!entry) return [];
  const entries = Array.isArray(entry) ? entry : [entry];
  return entries.map((file) => path.resolve(basePath, file));
};

/**
 * Logic to start watching a specific resource
 */
function startResourceWatcher(resourceName: string): void {
  // Prevent duplicate watchers
  if (activeWatchers.has(resourceName)) {
    return;
  }

  const resourcePath = path.resolve('./resources', resourceName);
  const tomlPath = path.join(resourcePath, 'resource.toml');

  if (!fs.existsSync(tomlPath)) {
    return;
  }

  try {
    const config: ResourceConfig = toml.parse(
      fs.readFileSync(tomlPath, 'utf-8'),
    );

    if (config.hotreload === true) {
      const watchTargets = [
        ...resolveBuildPaths(resourcePath, config.client_script),
        ...resolveBuildPaths(resourcePath, config.server_script),
      ];

      if (watchTargets.length === 0) return;

      const watcher = chokidar.watch(watchTargets, {
        persistent: true,
        ignoreInitial: true,
        ...(process.env.IS_DOCKER === 'true'
          ? {
              usePolling: true,
              interval: 200,
              binaryInterval: 500,
            }
          : {}),

        awaitWriteFinish: {
          stabilityThreshold: 400,
          pollInterval: 100,
        },
      });

      watcher.on('change', (filePath: string) => {
        if (reloadingPool.has(resourceName)) {
          return;
        }

        console.log(
          `[Hotreload] Change in ${path.basename(filePath)}. Restarting ${resourceName}...`,
        );

        if (typeof mp !== 'undefined' && mp.restartResource) {
          reloadingPool.add(resourceName);

          mp.restartResource(resourceName);

          // reloadingPool.delete(resourceName);
          // console.log(reloadingPool);
        }
      });

      activeWatchers.set(resourceName, watcher);
      console.log(
        `[Hotreload] Started watching: ${resourceName} (${watchTargets.length} files)`,
      );
    }
  } catch (err) {
    console.error(
      `[Hotreload] Failed to parse config for ${resourceName}:`,
      err,
    );
  }
}

/**
 * Logic to stop watching a resource
 */
async function stopResourceWatcher(resourceName: string): Promise<void> {
  const watcher = activeWatchers.get(resourceName);

  if (watcher) {
    await watcher.close();
    activeWatchers.delete(resourceName);
    console.log(`[Hotreload] Stopped watching: ${resourceName}`);
  }
}

// Initialize Lifecycle Listeners
if (process.env.NODE_ENV === 'development') {
  console.log(
    '[Hotreload] System Active (Listening for resource lifecycle events)',
  );

  mp.events.on('onServerResourceStarted', (resName: string) => {
    if (reloadingPool.has(resName)) {
      reloadingPool.delete(resName);
      return;
    }

    startResourceWatcher(resName);
  });

  mp.events.on('onServerResourceStopped', (resName: string) => {
    if (reloadingPool.has(resName)) {
      return;
    }

    stopResourceWatcher(resName);
  });

  mp.events.on('onResourceStopped', (res) => {
    if (res !== 'hotreload') {
      return;
    }

    for (const resName of activeWatchers.keys()) {
      stopResourceWatcher(resName);
    }
  });
}
