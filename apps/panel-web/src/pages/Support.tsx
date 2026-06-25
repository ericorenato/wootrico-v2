import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, MessageCircle, AlertTriangle } from 'lucide-react';
import { Button, Eyebrow, Field, ErrorText } from '../components/ui';
import {
  getLicenseStatus,
  submitSupportTicket,
  type LicenseStatus,
} from '../lib/license-api';
import { ApiError } from '../lib/api-client';

const DRAFT_KEY = 'wootrico.support.draft';

export default function Support() {
  const [info, setInfo] = useState<LicenseStatus | null>(null);
  const [message, setMessage] = useState(() => localStorage.getItem(DRAFT_KEY) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [needsPurchase, setNeedsPurchase] = useState(false);

  useEffect(() => {
    getLicenseStatus().then(setInfo).catch(() => {});
  }, []);

  // Persist the draft so the user doesn't retype after leaving (e.g. to buy).
  useEffect(() => {
    if (message) localStorage.setItem(DRAFT_KEY, message);
    else localStorage.removeItem(DRAFT_KEY);
  }, [message]);

  // WhatsApp redirect is a perk for PAID, active customers only.
  const paidActive =
    !!info && (info.status === 'active' || info.status === 'warning') && info.plan === 'paid';

  async function send() {
    const text = message.trim();
    if (!text) {
      setError('Descreva sua dificuldade antes de enviar.');
      return;
    }
    setError('');
    setSent(false);
    setNeedsPurchase(false);
    setBusy(true);
    try {
      const res = await submitSupportTicket(text);
      setSent(true);
      if (paidActive) {
        // Redirect to support WhatsApp with the message prefilled.
        const number = res.supportWhatsapp ?? info?.supportWhatsapp ?? null;
        if (number) {
          const url = `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
          window.open(url, '_blank', 'noopener');
        }
        // Sent + redirected → clear the draft.
        setMessage('');
        localStorage.removeItem(DRAFT_KEY);
      } else {
        // Trial/expired: ticket registered, but no WhatsApp — show the buy CTA and
        // KEEP the draft (so it survives a trip to the license screen).
        setNeedsPurchase(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? `Falha: ${err.code}` : 'Falha ao enviar o chamado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <Eyebrow>Ajuda</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Suporte</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Descreva sua dificuldade. Ao enviar, abrimos um chamado no nosso servidor e — para clientes
          com licença <strong className="text-neutral-300">paga ativa</strong> — você é direcionado ao
          WhatsApp do suporte com a mensagem já preenchida.
        </p>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#0F0F11] p-5">
        <Field label="Sua mensagem">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="Descreva o que está acontecendo, com o máximo de detalhes…"
            className="w-full rounded-lg border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50 resize-y"
          />
        </Field>

        <ErrorText>{error}</ErrorText>

        {/* Trial/expirado: chamado registrado, mas sem WhatsApp — CTA de compra. */}
        {needsPurchase && (
          <div className="mt-1 mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="text-sm">
              <p className="font-medium text-amber-200">Chamado registrado</p>
              <p className="text-amber-200/80">
                O atendimento por WhatsApp é exclusivo para clientes com licença ativa. Garanta a sua
                para falar com o suporte — sua mensagem fica salva aqui.{' '}
                <Link to="/license" className="underline hover:text-white">Adquirir licença</Link>.
              </p>
            </div>
          </div>
        )}

        {sent && !needsPurchase && (
          <p className="mb-4 text-sm text-emerald-300">
            Chamado enviado! Abrimos o WhatsApp do suporte numa nova aba.
          </p>
        )}

        <Button onClick={send} loading={busy}>
          {paidActive ? (
            <>
              <MessageCircle size={16} /> Abrir suporte no WhatsApp
            </>
          ) : (
            <>
              <LifeBuoy size={16} /> Enviar chamado
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
