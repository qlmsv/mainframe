import path from 'node:path';

// Files anyone may open: the dashboard shell (its data comes only through /api with a token),
// the setup wizard and two showcase pages with made-up numbers (/me/ is linked from the course bot).
// Everything else in public/ (drafts, design shots, the funnel map) needs the owner's token.
export const PUBLIC_FILES = new Set(['/', '/index.html', '/app.js', '/style.css', '/spark.js', '/icon.svg', '/icon-32.png', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']);
// /next/ is the new pult's shell (public/next/): like /app.js, its data still needs the token.
export const PUBLIC_DIRS = ['/setup/', '/me/', '/tour/', '/next/'];
export function staticPublic(pathname) {
  const p = path.posix.normalize(decodeURIComponent(String(pathname || '/')));
  if (p.includes('..')) return false;
  if (PUBLIC_FILES.has(p)) return true;
  return PUBLIC_DIRS.some((d) => p === d.slice(0, -1) || p.startsWith(d));
}
