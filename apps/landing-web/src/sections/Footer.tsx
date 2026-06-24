import { Instagram, Youtube } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-black border-t border-white/10">
      <div className="container mx-auto px-4 sm:px-6 py-12">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <img
              src="/logo_wootrico.png"
              alt="Wootrico"
              className="w-10 h-10 rounded-xl object-contain"
            />
            <div className="leading-tight">
              <p className="text-base font-bold text-white">Wootrico</p>
              <p className="text-xs text-neutral-500">WhatsApp + Chatwoot · self-hosted</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="#recursos" className="text-sm text-neutral-400 hover:text-white transition-colors">
              Recursos
            </a>
            <a href="#instalacao" className="text-sm text-neutral-400 hover:text-white transition-colors">
              Instalação
            </a>
            <a href="#integracoes" className="text-sm text-neutral-400 hover:text-white transition-colors">
              Integrações
            </a>
            <a href="#ecossistema" className="text-sm text-neutral-400 hover:text-white transition-colors">
              Ecossistema
            </a>
            <a
              href="https://comunidade.ericorenato.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-neutral-400 hover:text-white transition-colors"
            >
              Comunidade
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="https://www.instagram.com/erico.arenato"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="w-10 h-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center text-neutral-300 hover:text-white transition-colors"
            >
              <Instagram className="w-5 h-5" />
            </a>
            <a
              href="https://www.youtube.com/@ericorenato.automacao"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
              className="w-10 h-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center text-neutral-300 hover:text-white transition-colors"
            >
              <Youtube className="w-5 h-5" />
            </a>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-600">
          <p>© {new Date().getFullYear()} Wootrico · Érico Renato Almeida. Todos os direitos reservados.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <a
              href="https://ericorenato.com.br/privacidade"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-300 transition-colors"
            >
              Política de Privacidade
            </a>
            <span className="text-neutral-700">·</span>
            <a
              href="https://ericorenato.com.br/termos"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-300 transition-colors"
            >
              Termos de Uso
            </a>
            <span className="text-neutral-700">·</span>
            <a
              href="https://ericorenato.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-300 transition-colors"
            >
              ericorenato.com.br
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
