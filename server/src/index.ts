import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import toml from 'smol-toml';

interface ResourceConfig {
  hotreload?: boolean;
  client_script?: string | string[];
  server_script?: string | string[];
}

/**
 * Normalizes the config values into a flat array of absolute paths.
 */
const resolveBuildPaths = (
  basePath: string,
  entry?: string | string[],
): string[] => {
  if (!entry) return [];
  const entries = Array.isArray(entry) ? entry : [entry];
  return entries.map((file) => path.resolve(basePath, file));
};

async function initResourceWatchers(): Promise<void> {
  const resourcesDir = path.resolve('./resources');

  if (!fs.existsSync(resourcesDir)) {
    console.error('[Hotreload] Resources folder not found.');
    return;
  }

  try {
    const entries = fs.readdirSync(resourcesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const resourcePath = path.join(resourcesDir, entry.name);
      const tomlPath = path.join(resourcePath, 'resource.toml');

      if (!fs.existsSync(tomlPath)) continue;

      const config: ResourceConfig = toml.parse(
        fs.readFileSync(tomlPath, 'utf-8'),
      );

      if (config.hotreload === true) {
        // Collect only the specific build files defined in TOML
        const watchTargets = [
          ...resolveBuildPaths(resourcePath, config.client_script),
          ...resolveBuildPaths(resourcePath, config.server_script),
        ];

        if (watchTargets.length > 0) {
          setupWatcher(entry.name, watchTargets);
        }
      }
    }
  } catch (err) {
    console.error('[Hotreload] Failed to initialize watchers:', err);
  }
}

function setupWatcher(resourceName: string, files: string[]): void {
  const watcher = chokidar.watch(files, {
    persistent: true,
    ignoreInitial: true,
    usePolling: process.env.IS_DOCKER === 'true',
    interval: 100, // How often to check in ms
    binaryInterval: 300,
    awaitWriteFinish: {
      stabilityThreshold: 400,
      pollInterval: 100,
    },
  });

  console.log(
    `[Hotreload] Monitoring ${files.length} build files for: ${resourceName}`,
  );

  watcher.on('change', (filePath: string) => {
    const fileName = path.basename(filePath);
    console.log(
      `[Hotreload] Detected change in ${fileName}. Restarting ${resourceName}...`,
    );

    if (typeof mp !== 'undefined' && mp.restartResource) {
      mp.restartResource(resourceName);
    } else {
      console.error(`[Hotreload] Failed to restart ${resourceName}`);
    }
  });

  watcher.on('error', (error) => {
    console.error(`[Hotreload] Watcher error for ${resourceName}:`, error);
  });
}

if (process.env.NODE_ENV === 'development') {
  console.log('[Hotreload] Enabling in development (NODE_ENV === development)');

  initResourceWatchers();
}
