/**
 * 应用根组件 - 路由配置
 * /              首页
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
import { Report } from './pages/Report';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Readme } from './pages/Readme';
import { Faq } from './pages/Faq';

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-bg">
        <TopBar />
        <Routes>
          <Route path="/" element={<Home />} />
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
      </div>
    </BrowserRouter>
  );
}