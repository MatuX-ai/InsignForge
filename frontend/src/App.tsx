/**
 * 应用根组件 - 路由配置
 * /              首页
 * /report/:id    报告页
 * /history       历史记录
 * /settings      设置
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { Home } from './pages/Home';
import { Report } from './pages/Report';
import { History } from './pages/History';
import { Settings } from './pages/Settings';

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
          <Route
            path="*"
            element={
              <main className="flex-1 flex items-center justify-center text-text-secondary">
                页面不存在
              </main>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}