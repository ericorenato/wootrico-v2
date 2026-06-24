import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Globe, Terminal, Rocket } from 'lucide-react';

const INSTALL_COMMAND = `mkdir -p /opt/wootrico && cd /opt/wootrico
curl -fsSL -O https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh
sudo bash install.sh`;

const STEPS = [
  {
    icon: Globe,
    title: 'Aponte seu domínio',
    description:
      'Crie um registro A apontando o domínio (ex.: wootrico.suaempresa.com) para o IP da sua VPS. O TLS é emitido automaticamente.',
  },
  {
    icon: Terminal,
    title: 'Cole o comando',
    description:
      'Conecte na VPS, cole o comando abaixo e pressione Enter. O instalador detecta o ambiente, faz as perguntas e o Docker sobe tudo sozinho.',
  },
  {
    icon: Rocket,
    title: 'Ative no painel',
    description:
      'No primeiro acesso, o setup wizard cria o seu admin e ativa a licença. Pronto: já dá para criar integrações.',
  },
];

export default function InstallSection() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível (http) — ignora silenciosamente */
    }
  };

  return (
    <section
      id="instalacao"
      className="relative py-10 sm:py-16 bg-gradient-to-b from-[#050509] to-black overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none hidden sm:block">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-full max-w-4xl h-72 bg-blue-500/10 blur-[140px] rounded-full" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto text-center mb-12"
        >
          <span className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-5">
            Instalação
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
            Um comando. <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">Sem complicação.</span>
          </h2>
          <p className="text-base sm:text-lg text-neutral-300 leading-relaxed">
            Você não precisa entender de infraestrutura. Copie, cole no terminal da sua VPS e siga as
            perguntas — é fácil e claro do começo ao fim.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 max-w-5xl mx-auto mb-10">
          {STEPS.map((s, idx) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className="rounded-card bg-[#111117] border border-white/10 p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-blue-400" />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                  Passo {idx + 1}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{s.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{s.description}</p>
            </motion.div>
          ))}
        </div>

        {/* Terminal card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto rounded-panel bg-[#0b0b10] border border-white/10 shadow-2xl shadow-blue-500/10 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500/70" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <span className="w-3 h-3 rounded-full bg-green-500/70" />
              <span className="ml-3 text-xs text-neutral-500 font-mono">root@sua-vps</span>
            </div>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          <pre className="px-4 sm:px-6 py-5 text-left text-sm sm:text-[15px] leading-relaxed font-mono text-neutral-200 overflow-x-auto">
            <code>
              <span className="text-blue-400">$ </span>mkdir -p /opt/wootrico &amp;&amp; cd /opt/wootrico{'\n'}
              <span className="text-blue-400">$ </span>curl -fsSL -O https://raw.githubusercontent.com/ericorenato/wootrico-v2/main/install.sh{'\n'}
              <span className="text-blue-400">$ </span>sudo bash install.sh
            </code>
          </pre>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-xs sm:text-sm text-neutral-500 mt-5 max-w-2xl mx-auto"
        >
          Requer uma VPS Linux com acesso root. O instalador também serve para atualizar
          (<span className="font-mono text-neutral-400">update</span>) e remover
          (<span className="font-mono text-neutral-400">uninstall</span>) a stack depois.
        </motion.p>
      </div>
    </section>
  );
}
