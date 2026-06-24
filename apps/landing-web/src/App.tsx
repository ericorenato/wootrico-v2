import { Helmet } from 'react-helmet';
import Navbar from './sections/Navbar';
import Hero from './sections/Hero';
import AuthorSection from './sections/AuthorSection';
import InstallSection from './sections/InstallSection';
import FeaturesSection from './sections/FeaturesSection';
import IntegrationsSection from './sections/IntegrationsSection';
import CTASection from './sections/CTASection';
import EcosystemSection from './sections/EcosystemSection';
import Footer from './sections/Footer';

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-blue-500 selection:text-white overflow-x-hidden">
      <Helmet>
        <html lang="pt-BR" />
        <title>Wootrico · Integração WhatsApp + Chatwoot self-hosted</title>
        <meta
          name="description"
          content="Conecte suas APIs de WhatsApp (Evolution Go, UAZAPI, Z-API) ao Chatwoot. Self-hosted na sua VPS, instalação por um comando no terminal. Múltiplas contas, multi-instâncias, biblioteca de mídias, logs, contatos e painel de controle."
        />
        <meta name="theme-color" content="#3b82f6" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Wootrico · Integração WhatsApp + Chatwoot self-hosted" />
        <meta
          property="og:description"
          content="Instale por um comando no terminal e conecte suas APIs de WhatsApp ao Chatwoot. Multi-instâncias, múltiplas contas, mídias, logs e painel de controle."
        />
        <meta property="og:image" content="/logo_wootrico.png" />
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:site_name" content="Wootrico" />
      </Helmet>

      <Navbar />
      <Hero />
      <AuthorSection />
      <InstallSection />
      <FeaturesSection />
      <CTASection />
      <IntegrationsSection />
      <EcosystemSection />
      <Footer />
    </div>
  );
}
