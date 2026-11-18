// Private-network and loopback hosts are not reachable from the internet and do not
// serve certificates, so TLS verification cannot apply to them (e.g. Railway's
// postgres.railway.internal). Public hosts still default to verified TLS in production.
function isPrivateHost(connectionString) {
  if (!connectionString) return false;
  try {
    const host = new URL(connectionString).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
      || host.endsWith('.railway.internal');
  } catch (err) {
    return false;
  }
}

function databaseSslConfig({
  mode = process.env.DATABASE_SSL_MODE,
  nodeEnv = process.env.NODE_ENV,
  ca = process.env.DATABASE_SSL_CA,
  connectionString = process.env.DATABASE_URL,
} = {}) {
  const resolvedMode = mode
    || (nodeEnv === 'production' && !isPrivateHost(connectionString) ? 'verify-full' : 'disable');
  if (resolvedMode === 'disable') return false;
  if (resolvedMode === 'verify-full') {
    return {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
    };
  }
  throw new Error('DATABASE_SSL_MODE must be either "disable" or "verify-full".');
}

module.exports = { databaseSslConfig };
