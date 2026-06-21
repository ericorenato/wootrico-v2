function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const cfg = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  adminToken: required('ADMIN_TOKEN'),
  // Free-trial lifetime in days. After it elapses the key is inactive and the
  // customer must self-service a new trial.
  trialDays: Number(process.env.LICENSE_TRIAL_DAYS ?? 14),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Admin web panel credentials (optional). When set, /admin/login issues a JWT;
  // when unset, the panel login is disabled and only ADMIN_TOKEN (Bearer) works.
  adminEmail: process.env.LICENSE_ADMIN_EMAIL,
  adminPassword: process.env.LICENSE_ADMIN_PASSWORD,
  adminJwtSecret: process.env.LICENSE_ADMIN_JWT_SECRET ?? required('ADMIN_TOKEN'),
};
