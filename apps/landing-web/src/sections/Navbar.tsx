import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Terminal } from 'lucide-react';

const LINKS = [
  { href: '#recursos', label: 'Recursos' },
  { href: '#integracoes', label: 'Integrações' },
  { href: '#sobre', label: 'Sobre' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6 }}
      className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
        scrolled ? 'bg-black/70 backdrop-blur-xl border-b border-white/10' : 'bg-transparent'
      }`}
    >
      <nav className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href="#topo" className="flex items-center gap-2.5">
          <img
            src="/logo_wootrico.png"
            alt="Wootrico"
            className="w-9 h-9 rounded-xl object-contain"
          />
          <span className="text-lg font-bold tracking-tight">Wootrico</span>
        </a>

        <div className="hidden md:flex items-center gap-8">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-neutral-400 hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </div>

        <a
          href="#instalacao"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-blue-500/20"
        >
          <Terminal className="w-4 h-4" />
          Instalar
        </a>
      </nav>
    </motion.header>
  );
}
