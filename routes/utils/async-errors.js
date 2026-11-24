// Express 4 doesn't catch rejected promises from async route handlers: the
// request hangs and, on newer Node versions, the process can crash. This
// wraps every handler registered through express.Router so a thrown error is
// passed to next() and lands in the error middleware in server.js.
const express = require('express');

function wrap(fn) {
  if (typeof fn !== 'function' || fn.length === 4) return fn; // leave error handlers alone
  return function wrapped(req, res, next) {
    let result;
    try { result = fn(req, res, next); } catch (err) { return next(err); }
    if (result && typeof result.catch === 'function') result.catch(next);
    return result;
  };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];
for (const method of METHODS) {
  const original = express.Router[method];
  if (typeof original !== 'function' || original.__asyncWrapped) continue;
  express.Router[method] = function patched(path, ...handlers) {
    return original.call(this, path, ...handlers.flat().map(wrap));
  };
  express.Router[method].__asyncWrapped = true;
}

module.exports = { wrap };
