const pkg = require('../package.json');
const fs = require('fs');
const path = require('path');

const now = new Date();
const buildTime = now.toISOString();
const buildDate = now.toLocaleDateString('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
});

const content = `// Auto-generated at build time — do not edit manually
export const APP_VERSION = '${pkg.version}';
export const BUILD_TIME = '${buildTime}';
export const BUILD_LABEL = 'v${pkg.version} · ${buildDate}';
`;

const out = path.resolve(__dirname, '../src/app/version.ts');
fs.writeFileSync(out, content, 'utf8');
console.log(`[gen-version] ${content.trim().split('\n').slice(1).join(' | ')}`);
