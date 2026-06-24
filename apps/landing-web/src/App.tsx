import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { MotionConfig } from 'framer-motion';
import Navbar from './sections/Navbar';
import Hero from './sections/Hero';
import AuthorSection from './sections/AuthorSection';
import InstallSection from './sections/InstallSection';
import FeaturesSection from './sections/FeaturesSection';
import IntegrationsSection from './sections/IntegrationsSection';
import CTASection from './sections/CTASection';
import EcosystemSection from './sections/EcosystemSection';
import Footer from './sections/Footer';

const SEO_DESCRIPTION =
  'Wootrico: integração self-hosted entre as APIs de WhatsApp (Evolution Go, UAZAPI e Z-API) e o Chatwoot. Conecte múltiplas contas, instale por um comando no terminal na sua VPS e gerencie atendimento de WhatsApp no Chatwoot. Criado por Érico Renato Almeida.';

const SEO_KEYWORDS =
  'Wootrico, integração WhatsApp Chatwoot, Evolution Go, Evolution API, UAZAPI, Z-API, API de WhatsApp, WhatsApp self-hosted, Chatwoot WhatsApp, atendimento WhatsApp, Érico Renato Almeida, n8n, automação com IA, vibe coding, curso de automação, OpenClaw, Hermes, agentes de IA autônomos';

// Structured data (SEO): the product, its author and the courses/ecosystem.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Wootrico',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Linux, Docker',
  url: 'https://wootrico.com.br',
  image: 'https://wootrico.com.br/logo_wootrico.png',
  description: SEO_DESCRIPTION,
  keywords: SEO_KEYWORDS,
  offers: { '@type': 'Offer', price: '57.90', priceCurrency: 'BRL' },
  author: {
    '@type': 'Person',
    name: 'Érico Renato Almeida',
    url: 'https://ericorenato.com.br',
    jobTitle: 'Desenvolvedor de Software e Especialista em Automação e IA',
    sameAs: [
      'https://www.instagram.com/erico.arenato',
      'https://www.youtube.com/@ericorenato.automacao',
    ],
  },
  about: ['Evolution Go', 'UAZAPI', 'Z-API', 'Chatwoot', 'n8n', 'OpenClaw', 'Hermes', 'Vibe Coding'],
};

/** True on phone-sized screens — used to drop animations/effects for a lighter page. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

export default function App() {
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-blue-500 selection:text-white overflow-x-hidden">
      <Helmet>
        <html lang="pt-BR" />
        <title>
          Wootrico · Integração WhatsApp (Evolution Go, UAZAPI, Z-API) + Chatwoot self-hosted
        </title>
        <meta name="description" content={SEO_DESCRIPTION} />
        <meta name="keywords" content={SEO_KEYWORDS} />
        <meta name="author" content="Érico Renato Almeida" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://wootrico.com.br/" />
        <meta name="theme-color" content="#3b82f6" />

        <meta property="og:type" content="website" />
        <meta property="og:title" content="Wootrico · WhatsApp (Evolution Go, UAZAPI, Z-API) + Chatwoot" />
        <meta property="og:description" content={SEO_DESCRIPTION} />
        <meta property="og:image" content="https://wootrico.com.br/logo_wootrico.png" />
        <meta property="og:url" content="https://wootrico.com.br/" />
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:site_name" content="Wootrico" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Wootrico · WhatsApp + Chatwoot self-hosted" />
        <meta name="twitter:description" content={SEO_DESCRIPTION} />
        <meta name="twitter:image" content="https://wootrico.com.br/logo_wootrico.png" />

        <script type="application/ld+json">{JSON.stringify(JSON_LD)}</script>
      </Helmet>

      {/* On phones: kill transform/scale animations (reducedMotion) and make any
          remaining transition instant — a lighter, effect-free page. */}
      <MotionConfig
        reducedMotion={isMobile ? 'always' : undefined}
        transition={isMobile ? { duration: 0 } : undefined}
      >
        <Navbar />
        <Hero />
        <IntegrationsSection />
        <AuthorSection />
        <EcosystemSection />
        <FeaturesSection />
        <InstallSection />
        <CTASection />
        <Footer />
      </MotionConfig>
    </div>
  );
}
