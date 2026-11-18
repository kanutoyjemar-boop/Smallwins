const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

function requestLogging(req, res, next) {
  const startedAt = Date.now();
  req.requestId = randomUUID();
  res.set('X-Request-Id', req.requestId);
  res.on('finish', () => {
    logger.info('http_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
}

module.exports = { requestLogging };
