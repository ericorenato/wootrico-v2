import { motion } from 'framer-motion';
import { MessageSquare, Zap, Send, Headphones } from 'lucide-react';

const INTEGRATIONS = [
  {
    name: 'Evolution Go',
    icon: Send,
    description: 'API de WhatsApp open-source, rápida e flexível.',
    accent: 'from-blue-500 to-blue-600',
  },
  {
    name: 'UAZAPI',
    icon: MessageSquare,
    description: 'API de WhatsApp confiável e estável para produção.',
    accent: 'from-sky-500 to-blue-600',
  },
  {
    name: 'Z-API',
    icon: Zap,
    description: 'Solução rápida e eficiente para WhatsApp.',
    accent: 'from-indigo-500 to-blue-600',
  },
  {
    name: 'Chatwoot',
    icon: Headphones,
    description: 'Plataforma completa de atendimento ao cliente.',
    accent: 'from-blue-500 to-indigo-600',
  },
];

export default function IntegrationsSection() {
  return (
    <section
      id="integracoes"
      className="relative py-16 sm:py-24 bg-gradient-to-b from-black to-[#050509] overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-64 bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-12"
        >
          <span className="inline-block px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 text-xs sm:text-sm font-semibold tracking-wider uppercase mb-5">
            Integrações suportadas
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
            Conecte{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
              tudo
            </span>
          </h2>
          <p className="text-base sm:text-lg text-neutral-300">
            O Wootrico integra os principais provedores de WhatsApp ao Chatwoot e centraliza todas as
            conversas num lugar só. Extensível para novos provedores.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
          {INTEGRATIONS.map((it, idx) => (
            <motion.div
              key={it.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.12 }}
              className="group rounded-card bg-[#111117] border border-white/10 p-6 sm:p-8 hover:border-blue-500/40 transition-all duration-300 shadow-lg hover:shadow-2xl hover:shadow-blue-500/15 text-center"
            >
              <div
                className={`w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br ${it.accent} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}
              >
                <it.icon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{it.name}</h3>
              <p className="text-sm text-neutral-400">{it.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
