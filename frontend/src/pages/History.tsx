/**
 * 历史记录 - 按前端设计文档 §3.3
 * 用 localStorage 存储,每条记录显示项目名称、日期、"查看报告"链接
 */
import { Link } from 'react-router-dom';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { HistoryEntry } from '../types';

export function History() {
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>('history', []);

  const remove = (projectId: string) => {
    if (!confirm('确定从历史记录中移除?(后端项目不会被删除)')) return;
    setHistory((prev) => prev.filter((h) => h.project_id !== projectId));
  };

  return (
    <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full">
      <h1 className="text-title text-text-primary mb-6">历史记录</h1>

      {history.length === 0 ? (
        <div className="bg-card border border-border rounded-card p-10 text-center text-text-secondary">
          还没有任何调研记录
          <div className="mt-4">
            <Link to="/" className="text-primary hover:underline">
              ← 去验证一个新想法
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-card overflow-hidden">
          {history.map((h, i) => (
            <div
              key={h.project_id}
              className={`flex items-center justify-between p-4 transition-colors hover:bg-hover-bg ${
                i < history.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-body text-text-primary truncate">{h.name}</div>
                <div className="text-helper text-text-secondary mt-1">
                  {new Date(h.created_at).toLocaleString('zh-CN')}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Link
                  to={`/report/${h.project_id}`}
                  className="text-primary hover:underline text-[15px]"
                >
                  查看报告 →
                </Link>
                <button
                  type="button"
                  onClick={() => remove(h.project_id)}
                  className="text-helper text-text-secondary hover:text-red-600"
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4 text-helper text-text-secondary text-center">
          共 {history.length} 条记录
        </div>
      )}
    </main>
  );
}