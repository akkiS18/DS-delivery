import assert from 'node:assert/strict';
import test from 'node:test';
import { windowsClientConfig } from './client-config.js';

test('unset variables mean no rule', () => {
  assert.deepEqual(windowsClientConfig({}), { minVersion: null, latestVersion: null, downloadUrl: null });
});

test('valid values pass through', () => {
  const c = windowsClientConfig({ TAXI_WINDOWS_MIN_VERSION: ' 1.2.0 ', TAXI_WINDOWS_LATEST_VERSION: '1.3.10', TAXI_WINDOWS_DOWNLOAD_URL: 'https://example.uz/DsTaxi-Setup-1.3.10.exe' });
  assert.equal(c.minVersion, '1.2.0');
  assert.equal(c.latestVersion, '1.3.10');
  assert.equal(c.downloadUrl, 'https://example.uz/DsTaxi-Setup-1.3.10.exe');
});

test('a typo never blocks anybody: malformed versions and non-https links are ignored', () => {
  const c = windowsClientConfig({ TAXI_WINDOWS_MIN_VERSION: 'v1.2', TAXI_WINDOWS_LATEST_VERSION: '1.2.3-beta', TAXI_WINDOWS_DOWNLOAD_URL: 'http://example.uz/x.exe' });
  assert.deepEqual(c, { minVersion: null, latestVersion: null, downloadUrl: null });
  assert.equal(windowsClientConfig({ TAXI_WINDOWS_DOWNLOAD_URL: 'javascript:alert(1)' }).downloadUrl, null);
  assert.equal(windowsClientConfig({ TAXI_WINDOWS_DOWNLOAD_URL: 'not a url' }).downloadUrl, null);
});
