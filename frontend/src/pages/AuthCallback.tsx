/**
 * v2.0: OIDC 回调落地页 — /auth/callback
 *
 * Casdoor 完成授权后,后端会把浏览器 302 到这里。
 * 该页面只负责:
 *   1. 重新拉取 /auth/me 确认 session 已写入
 *   2. 拉取成功后跳回首页
 *   3. 失败时给出错误提示 + 重试入口
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { api } from '../lib/api';

export function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMe();
        if (cancelled) return;
        if (res.user) {
          setStatus('success');
          // 短暂停留让用户看到成功提示,再跳回首页
          window.setTimeout(() => {
            if (!cancelled) navigate('/', { replace: true });
          }, 800);
        } else {
          setStatus('failed');
          setError('未拿到登录态,请重试');
        }
      } catch (err) {
        if (cancelled) return;
        setStatus('failed');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="flex-1 px-6 py-10 max-w-md mx-auto w-full">
      <Card title="登录回调">
        {status === 'loading' && (
          <div className="text-helper text-text-secondary">
            正在完成登录...
          </div>
        )}
        {status === 'success' && (
          <div className="text-success">
            ✅ 登录成功,正在跳转首页...
          </div>
        )}
        {status === 'failed' && (
          <div className="space-y-4">
            <div className="text-warning">⚠ 登录失败:{error ?? '未知错误'}</div>
            <div className="flex gap-2">
              <Button onClick={() => navigate('/', { replace: true })} variant="outline">
                返回首页
              </Button>
              <Button onClick={() => api.startLogin()}>重新登录</Button>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}