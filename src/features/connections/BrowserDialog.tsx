import { useState } from 'react';
import { CheckCircle2, Copy, LoaderCircle } from 'lucide-react';
import { edgeBase, type EdgeSetup } from '../../../shared/edge-protocol';
import { Dialog } from '../../components/Dialog';
import { api } from '../../lib/api';

export function BrowserDialog({
  setup,
  onCheck,
  onClose,
  onChange,
  canRefresh,
}: {
  setup: EdgeSetup | null;
  onCheck: () => Promise<void>;
  onClose: () => void;
  onChange: () => Promise<void>;
  canRefresh: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      title="连接 Edge 浏览器"
      subtitle="加载一次扩展，复用平时的官网登录状态"
      onClose={onClose}
    >
      <div className="dialog-body">
        <ol className="edge-steps">
          <li>
            在 Edge 打开 <code>edge://extensions</code>，开启“开发人员模式”。
          </li>
          <li>
            点击“加载解压缩的扩展”，选择项目中的 <code>extension</code> 文件夹。
            <div className="copy-path">
              <code>{setup?.extensionDirectory ?? 'AwaitOffer 项目 / extension'}</code>
              <button
                className="icon-button"
                aria-label="复制扩展路径"
                disabled={!setup}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(setup!.extensionDirectory)
                    .then(() => setCopied(true))
                    .catch(() => setError('复制失败，请手动复制上面的路径。'));
                }}
              >
                <Copy size={16} />
              </button>
            </div>
            {copied && <small>路径已复制</small>}
          </li>
          <li>点击工具栏中的 AwaitOffer 扩展，再点击“连接 AwaitOffer”。</li>
        </ol>
        <div className="info-box">
          扩展只访问已列出的招聘站点和本机服务，不读取或导出
          Cookie、密码。登录过期和验证码仍需你在官网处理。
        </div>
        <p className="connection-message" role="status">
          {setup?.connected ? (
            <>
              <CheckCircle2 size={16} />
              已检测到扩展连接
            </>
          ) : setup ? (
            '等待扩展连接…'
          ) : (
            '浏览器接入服务未连接。请使用项目启动脚本启动本地服务。'
          )}
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button className="button secondary" onClick={() => void onCheck()}>
          检查连接
        </button>
        <button
          className="button primary"
          disabled={!setup?.connected || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const response = await fetch(`${edgeBase}/api/use-edge`, { method: 'POST' });
              if (!response.ok) throw new Error('切换连接失败，请重试。');
              if (canRefresh) await api('/refresh', 'POST', {});
              await onChange();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <LoaderCircle size={16} className="spin" />}
          {canRefresh ? '连接并同步' : '完成连接'}
        </button>
      </div>
    </Dialog>
  );
}
