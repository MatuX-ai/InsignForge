/**
 * 营销站主应用 - 顺序组合所有 section
 * 锚点导航:#top #features #how #screenshots #channels #faq #changelog #download
 */
import { Nav } from './components/Nav';
import { Footer } from './components/Footer';
import { Hero } from './sections/Hero';
import { Features } from './sections/Features';
import { HowItWorks } from './sections/HowItWorks';
import { Screenshots } from './sections/Screenshots';
import { Channels } from './sections/Channels';
import { FAQ } from './sections/FAQ';
import { Changelog } from './sections/Changelog';
import { Download } from './sections/Download';
import { CtaBanner } from './sections/CtaBanner';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Screenshots />
        <Channels />
        <Changelog />
        <FAQ />
        <Download />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}