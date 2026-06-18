import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Plug } from 'lucide-react';
import { Badge, Button, Card, Eyebrow } from '../components/ui';
import { deleteIntegration, listIntegrations, type IntegrationDTO } from '../lib/integrations-api';

export default function Integrations() {
  const [items, setItems] = useState<IntegrationDTO[] | null>(null);

  const load = () => listIntegrations().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    if (!confirm('Remover esta integração?')) return;
    await deleteIntegration(id);
    load();
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-10">
        <div>
          <Eyebrow>Integrações</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Integrações</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Cada integração liga uma conta/inbox do Chatwoot a uma instância de API não-oficial.
          </p>
        </div>
        <Link to="/integrations/new">
          <Button>
            <Plus size={16} /> Nova
          </Button>
        </Link>
      </div>

      {items === null ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : items.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center text-center py-10 gap-3">
            <Plug className="text-neutral-600" size={32} />
            <p className="text-sm text-neutral-400">Nenhuma integração ainda.</p>
            <Link to="/integrations/new">
              <Button>
                <Plus size={16} /> Criar a primeira
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {items.map((it) => (
            <Card key={it.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <Link to={`/integrations/${it.id}`} className="text-white font-medium hover:underline">
                      {it.name}
                    </Link>
                    <Badge tone={it.status === 'ok' ? 'ok' : it.status === 'error' ? 'error' : 'neutral'}>
                      {it.status}
                    </Badge>
                    {!it.isEnabled && <Badge>desativada</Badge>}
                  </div>
                  <p className="text-xs text-neutral-500">
                    {it.providerType} · inbox {it.chatwoot.inboxName}
                    {it.chatwoot.inboxId ? ` (#${it.chatwoot.inboxId})` : ''}
                  </p>
                </div>
                <button
                  onClick={() => remove(it.id)}
                  className="text-neutral-500 hover:text-red-400 transition-colors"
                  title="Remover"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
