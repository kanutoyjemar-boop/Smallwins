// Express 4 doesn't catch rejected promises from async handlers; a failed DB
// query would hang the request or crash the process. This patches the router
// layer once so any rejection is forwarded to the error middleware.
const Layer = require('express/lib/router/layer');
Layer.prototype.handle_request = function (req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // error-handling middleware: skip on normal requests
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) { next(err); }
};
