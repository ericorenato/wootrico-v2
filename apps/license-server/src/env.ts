function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const cfg = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  adminToken: required('ADMIN_TOKEN'),
  // Free-trial lifetime in days. Granted ONCE per instance — after it elapses
  // the key is inactive and the customer must buy a definitive license (no free
  // renewal).
  trialDays: Number(process.env.LICENSE_TRIAL_DAYS ?? 14),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Admin web panel credentials (optional). When set, /admin/login issues a JWT;
  // when unset, the panel login is disabled and only ADMIN_TOKEN (Bearer) works.
  adminEmail: process.env.LICENSE_ADMIN_EMAIL,
  adminPassword: process.env.LICENSE_ADMIN_PASSWORD,
  adminJwtSecret: process.env.LICENSE_ADMIN_JWT_SECRET ?? required('ADMIN_TOKEN'),
  // Google OAuth (optional) — when both are set, the license server brokers
  // "Sign in with Google" for customer instances (single redirect URI on this
  // server's domain). Customers never configure Google themselves.
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
};
