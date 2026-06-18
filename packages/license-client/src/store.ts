import { prisma, type LicenseState } from '@wootrico/db';
import { encrypt, decrypt } from '@wootrico/config';

export async function getLicenseState(): Promise<LicenseState> {
  return prisma.licenseState.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
}

export async function updateLicenseState(
  data: Parameters<typeof prisma.licenseState.update>[0]['data'],
): Promise<LicenseState> {
  return prisma.licenseState.update({ where: { id: 'singleton' }, data });
}

export function decryptLicenseKey(state: LicenseState): string | null {
  return state.licenseKey ? decrypt(state.licenseKey) : null;
}

export function encryptLicenseKey(key: string): string {
  return encrypt(key);
}
