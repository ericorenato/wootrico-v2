import { prisma } from '@wootrico/db';
import { decryptSecretAny, logger } from '@wootrico/config';
import { ensureLicenseSecret, getLicenseSecrets } from '@wootrico/license-client';
import type { ProviderConfig } from '@wootrico/types';
import { createProvider, type WhatsAppProvider } from '@wootrico/providers';
import { ChatwootClient } from '@wootrico/chatwoot-client';
import { buildWebhookUrls, publicBaseUrl } from '../lib/urls.js';

export interface IntegrationRuntime {
  integration: Awaited<ReturnType<typeof prisma.integration.findUnique>>;
  provider: WhatsAppProvider;
  chatwoot: ChatwootClient;
  inboxId: string;
  providerType: ProviderConfig['provider'];
}

/** Load + decrypt an integration and build its provider + Chatwoot clients. */
export async function loadIntegrationRuntime(
  integrationId: string,
): Promise<IntegrationRuntime | null> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    include: { providerConfig: true },
  });
  if (!integration || !integration.providerConfig) return null;

  // Credentials are license-sealed: try every secret the instance has had (the
  // seal secret rotates on reactivation). Fetch on demand if we have none yet.
  let secrets = await getLicenseSecrets();
  if (secrets.length === 0) {
    await ensureLicenseSecret().catch(() => undefined);
    secrets = await getLicenseSecrets();
  }
  let providerConfig: ProviderConfig;
  let chatwootApiToken: string;
  try {
    providerConfig = JSON.parse(decryptSecretAny(integration.providerConfig.config, secrets)) as ProviderConfig;
    chatwootApiToken = decryptSecretAny(integration.chatwootApiToken, secrets);
  } catch {
    logger.warn(
      { integrationId, secrets: secrets.length },
      'integration credentials could not be decrypted (license secret mismatch) — message dropped',
    );
    return null;
  }
  const provider = createProvider(providerConfig);

  const chatwoot = new ChatwootClient({
    baseUrl: integration.chatwootBaseUrl,
    apiToken: chatwootApiToken,
    accountId: integration.chatwootAccountId,
  });

  let inboxId = integration.chatwootInboxId;
  if (!inboxId) {
    const urls = buildWebhookUrls(await publicBaseUrl(), integration.webhookToken);
    inboxId = await chatwoot.ensureInbox({
      name: integration.chatwootInboxName,
      webhookUrl: urls.chatwoot,
      allowMessagesAfterResolved: true,
    });
    await prisma.integration.update({
      where: { id: integration.id },
      data: { chatwootInboxId: inboxId },
    });
  }

  return { integration, provider, chatwoot, inboxId, providerType: providerConfig.provider };
}
