/**
 * 应用根组件 - 路由配置
 * /              首页
 * /discuss       讨论梳理画布
 * /report/:id    报告页
 * /history       历史记录
 * /settings      设置
 * /readme        项目说明(底部导航)
 * /faq           常见问题(底部导航)
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { BottomBar } from './components/BottomBar';
import { Home } from './pages/Home';
import { Discuss } from './pages/Discuss';
import { Report } from './pages/Report';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Readme } from './pages/Readme';
import { Faq } from './pages/Faq';
import { OnboardingModal } from './components/OnboardingModal';
import { DialogProvider } from './components/Dialog';

export function App() {
  return (
    <BrowserRouter>
      <DialogProvider>
      <div className="min-h-screen flex flex-col bg-bg">
        <TopBar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/discuss" element={<Discuss />} />
          <Route path="/discuss/:id" element={<Discuss />} />
          <Route path="/report/:id" element={<Report />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/readme" element={<Readme />} />
          <Route path="/faq" element={<Faq />} />
          <Route
            path="*"
            element={
              <main className="flex-1 flex items-center justify-center text-text-secondary">
                页面不存在
              </main>
            }
          />
        </Routes>
        <BottomBar />
        {/* 首次启动引导弹窗: 未配置 LLM API Key 时弹出 */}
        <OnboardingModal onConfigured={() => {}} />
      </div>
      </DialogProvider>
    </BrowserRouter>
  );
}