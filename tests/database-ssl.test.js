const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseSslConfig } = require('../utils/database-ssl');

test('database TLS is certificate-verified by default in production', () => {
  assert.deepEqual(databaseSslConfig({ nodeEnv: 'production', connectionString: 'postgresql://u:p@db.example.com:5432/db' }), {
    rejectUnauthorized: true,
  });
});

test('database TLS is disabled by default outside production', () => {
  assert.equal(databaseSslConfig({ nodeEnv: 'development' }), false);
});

test('database TLS accepts a provider CA certificate', () => {
  const ca = '-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----';
  assert.deepEqual(databaseSslConfig({ mode: 'verify-full', ca }), {
    rejectUnauthorized: true,
    ca,
  });
});

test('database TLS rejects unsupported modes', () => {
  assert.throws(
    () => databaseSslConfig({ mode: 'require' }),
    /DATABASE_SSL_MODE must be either "disable" or "verify-full"/
  );
});
