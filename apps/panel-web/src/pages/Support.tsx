import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, LifeBuoy, ShoppingCart } from 'lucide-react';
import { Button, Eyebrow, Field, ErrorText } from '../components/ui';
import {
  getLicenseStatus,
  submitSupportTicket,
  purchaseLicense,
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
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    getLicenseStatus().then(setInfo).catch(() => {});
  }, []);

  // Persist the draft so the user doesn't retype after leaving (e.g. to buy).
  useEffect(() => {
    if (message) localStorage.setItem(DRAFT_KEY, message);
    else localStorage.removeItem(DRAFT_KEY);
  }, [message]);

  // Paid + active → WhatsApp. Everyone else (trial, even with an extended expiry,
  // or expired) → buy/renew via the Hotmart offer.
  const eligible =
    !!info && (info.status === 'active' || info.status === 'warning') && info.plan === 'paid';
  const number = (info?.supportWhatsapp ?? '').replace(/\D/g, '');

  // Pre-fetch the Hotmart checkout for non-paid users, so the "comprar" click can
  // open it synchronously (no popup block).
  useEffect(() => {
    if (info && !eligible) {
      purchaseLicense()
        .then((r) => setCheckoutUrl(r.checkoutUrl))
        .catch(() => {});
    }
  }, [info, eligible]);

  function waUrl(text: string): string {
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  }

  function registerTicket(text: string) {
    setBusy(true);
    submitSupportTicket(text)
      .then(() => setSent(true))
      .catch((err) =>
        setError(err instanceof ApiError ? `Falha: ${err.code}` : 'Falha ao enviar o chamado.'),
      )
      .finally(() => setBusy(false));
  }

  function send() {
    const text = message.trim();
    if (!text) {
      setError('Descreva sua dificuldade antes de enviar.');
      return;
    }
    setError('');
    setSent(false);
    setNeedsPurchase(false);

    if (eligible) {
      // Abre o WhatsApp SINCRONAMENTE (no gesto do clique) — assim não é bloqueado.
      if (number) window.open(waUrl(text), '_blank', 'noopener');
      registerTicket(text);
      setMessage('');
      localStorage.removeItem(DRAFT_KEY);
    } else {
      // Trial/expirada: registra o chamado e direciona à oferta da Hotmart.
      if (checkoutUrl) window.open(checkoutUrl, '_blank', 'noopener');
      registerTicket(text);
      setNeedsPurchase(true); // mantém o rascunho
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <Eyebrow>Ajuda</Eyebrow>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Suporte</h1>
        <p className="mt-3 text-lg text-neutral-300 leading-relaxed">
          Descreva sua dificuldade e envie. Abrimos um chamado no nosso servidor e te colocamos em
          contato com o suporte pelo WhatsApp.
        </p>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#0F0F11] p-6">
        <Field label="Sua mensagem">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder="Descreva o que está acontecendo, com o máximo de detalhes…"
            className="w-full rounded-lg border border-white/10 bg-[#121212] px-4 py-3 text-base text-white outline-none focus:border-blue-500/50 resize-y"
          />
        </Field>

        <ErrorText>{error}</ErrorText>

        {/* Trial/expirada: mensagem de compra + oferta da Hotmart. */}
        {needsPurchase && (
          <div className="mt-1 mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4">
            <p className="text-base font-medium text-amber-200">Garanta sua licença do Wootrico</p>
            <p className="mt-1 mb-3 text-base text-amber-200/80">
              Adquira sua licença para falar com o suporte pelo WhatsApp. Sua mensagem fica salva aqui.
            </p>
            {checkoutUrl ? (
              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-base font-bold text-black transition hover:bg-amber-400"
              >
                <ShoppingCart size={18} /> Comprar licença
              </a>
            ) : (
              <Link to="/license" className="text-base underline text-amber-200 hover:text-white">
                Ver opções de licença
              </Link>
            )}
          </div>
        )}

        {sent && eligible && (
          <p className="mb-5 text-base text-emerald-300">
            Chamado enviado! Abrimos o WhatsApp do suporte numa nova aba.
          </p>
        )}

        <Button onClick={send} loading={busy} className="text-base">
          {eligible ? (
            <>
              <MessageCircle size={18} /> Abrir suporte no WhatsApp
            </>
          ) : (
            <>
              <LifeBuoy size={18} /> Enviar chamado
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
