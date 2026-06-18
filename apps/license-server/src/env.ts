function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export const cfg = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  privateKeyPem: Buffer.from(required('LICENSE_PRIVATE_KEY'), 'base64').toString('utf8'),
  adminToken: required('ADMIN_TOKEN'),
  tokenTtlDays: Number(process.env.LICENSE_TOKEN_TTL_DAYS ?? 14),
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
