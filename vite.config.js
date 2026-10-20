import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function getGitInfo() {
  try {
    const commitCount = execSync('git rev-list --count HEAD').toString().trim();
    const shortHash = execSync('git rev-parse --short HEAD').toString().trim();
    return {
      commitCount: Number.parseInt(commitCount, 10) || 1,
      shortHash,
    };
  } catch {
    return {
      commitCount: 1,
      shortHash: 'dev',
    };
  }
}

const { commitCount, shortHash } = getGitInfo();
let baseVersion = '0.1';
try {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
  baseVersion = pkg.version ? pkg.version.replace(/\.[0-9]+$/, '') : '0.1';
} catch {
  /* ignore */
}

const appVersion = `v${baseVersion}.${commitCount}`;

// Pure static site: no backend. Relative base lets `dist/` be served from any
// web server, sub-path, or CDN (GitHub Pages, S3, Netlify, ...).
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_NUMBER__: JSON.stringify(commitCount),
    __COMMIT_HASH__: JSON.stringify(shortHash),
  },
});

