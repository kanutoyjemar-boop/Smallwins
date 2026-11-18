const crypto = require('crypto');

// Signup is invite-only whenever SIGNUP_INVITE_CODE is set (read at request
// time so it can be rotated without code changes). Leave it empty for open signup.
function requiredInviteCode(env = process.env) {
  return String(env.SIGNUP_INVITE_CODE || '').trim();
}

function inviteCodeMatches(provided, expected = requiredInviteCode()) {
  if (!expected) return true;
  if (typeof provided !== 'string' || !provided.trim()) return false;
  // Hash both sides so timingSafeEqual always compares equal-length buffers.
  const a = crypto.createHash('sha256').update(provided.trim()).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { requiredInviteCode, inviteCodeMatches };
