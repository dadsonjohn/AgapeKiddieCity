const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const COOKIE_NAME = 'agape_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Sign the session cookie with a dedicated secret when available. Falling back
// to the Supabase secret keeps existing deployments working without new env vars.
const sessionSecret = process.env.SESSION_SECRET
  || process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || '';

if (!sessionSecret) {
  console.warn('[Auth] SESSION_SECRET (or SUPABASE_SECRET_KEY) is not set. Login sessions cannot be signed.');
}

// Password checks go through the publishable/anon client. Admin user
// management uses the service client in supabase.js.
const authKey = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.SUPABASE_SECRET_KEY;

const authClient = createClient(process.env.SUPABASE_URL, authKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function createSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !sessionSecret) return null;

  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (provided.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(provided, expectedBuffer)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    if (!data.uid || !data.role) return null;

    return {
      id: data.uid,
      email: data.email || '',
      full_name: data.full_name || data.email || '',
      role: data.role === 'admin' ? 'admin' : 'teacher'
    };
  } catch (err) {
    return null;
  }
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;

  String(header).split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (err) {
      cookies[key] = value;
    }
  });

  return cookies;
}

function cookieAttributes(req) {
  const secure = req.secure
    || req.headers['x-forwarded-proto'] === 'https'
    || process.env.NODE_ENV === 'production'
    || Boolean(process.env.VERCEL);

  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function setSessionCookie(res, user, req) {
  const token = createSessionToken(user);
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; ${cookieAttributes(req)}`
  );
}

function clearSessionCookie(res, req) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; ${cookieAttributes(req)}`);
}

function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.user = verifySessionToken(cookies[COOKIE_NAME]);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only an administrator can do that.' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  authClient,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin
};
