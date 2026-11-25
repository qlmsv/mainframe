import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticPublic } from '../src/webstatic.js';

test('the dashboard shell and showcase pages are public', () => {
  for (const p of ['/', '/index.html', '/app.js', '/style.css', '/spark.js', '/icon.svg', '/manifest.webmanifest', '/me/', '/me', '/me/me.js', '/tour/', '/setup/', '/setup/setup.js', '/next/', '/next', '/next/app.js', '/next/style.css', '/next/boot.js']) {
    assert.equal(staticPublic(p), true, p);
  }
});
test('everything else needs the token', () => {
  for (const p of ['/journey/', '/journey', '/journey/map/x.png', '/shots/design-3/', '/variants2/1/', '/characters/', '/media/a.mp4', '/me/../journey/', '/%2e%2e/.env', '/meme/', '/nextx/', '/next/../journey/']) {
    assert.equal(staticPublic(p), false, p);
  }
});
