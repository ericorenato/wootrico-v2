import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorText, Eyebrow, Field, Input } from '../components/ui';
import { getSettings, updateSettings } from '../lib/admin-api';

export default function Settings() {
  const [retention, setRetention] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setRetention(s.logRetentionDays != null ? String(s.logRetentionDays) : '');
        setLoaded(true);
      })
      .catch(() => setError('Falha ao carregar as configurações.'));
  }, []);

  async function onSave() {
    setError('');
    setSaved(false);
    const trimmed = retention.trim();
    let days: number | null = null;
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0) {
        setError('Informe um número inteiro de dias maior que zero, ou deixe em branco.');
        return;
      }
      days = n;
    }
    setBusy(true);
    try {
      await updateSettings({ logRetentionDays: days });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError('Falha ao salvar as configurações.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <Eyebrow>Operação</Eyebrow>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Configurações</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Ajustes do servidor de licenças. A retenção define por quantos dias os eventos de licença e
          os heartbeats são mantidos antes da exclusão automática.
        </p>
      </div>

      <Card className="max-w-xl">
        <h3 className="text-sm font-medium text-white mb-4">Retenção de logs</h3>
        <div className="space-y-5">
          <Field
            label="Retenção (dias) — em branco = manter para sempre"
            hint="Eventos e heartbeats mais antigos que esse período são removidos na limpeza periódica (de hora em hora)."
          >
            <Input
              type="number"
              min={1}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              placeholder="ex.: 60"
              disabled={!loaded}
            />
          </Field>

          <ErrorText>{error}</ErrorText>

          <div className="flex items-center gap-4">
            <Button type="button" onClick={onSave} loading={busy} disabled={!loaded}>
              Salvar
            </Button>
            {saved && <Badge tone="ok">salvo</Badge>}
          </div>
        </div>
      </Card>
    </div>
  );
}
