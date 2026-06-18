import { prisma } from '@wootrico/db';
import { decrypt } from '@wootrico/config';
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

  const providerConfig = JSON.parse(
    decrypt(integration.providerConfig.config),
  ) as ProviderConfig;
  const provider = createProvider(providerConfig);

  const chatwoot = new ChatwootClient({
    baseUrl: integration.chatwootBaseUrl,
    apiToken: decrypt(integration.chatwootApiToken),
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
