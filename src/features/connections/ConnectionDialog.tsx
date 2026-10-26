import { useState } from 'react';
import { ChevronRight, ExternalLink, LoaderCircle } from 'lucide-react';
import type { Application } from '../../../shared/model';
import { api } from '../../lib/api';
import { Dialog } from '../../components/Dialog';

export function ConnectionDialog({
  app,
  active,
  onClose,
  onChange,
}: {
  app: Application;
  active: boolean;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title={`连接 ${app.company}`} subtitle="完成登录，自动读取投递" onClose={onClose}>
      <div className="dialog-body">
        <div className="connection-steps">
          <div>
            <span>1</span>
            <strong>打开官网</strong>
          </div>
          <ChevronRight size={14} />
          <div>
            <span>2</span>
            <strong>正常登录</strong>
          </div>
          <ChevronRight size={14} />
          <div>
            <span>3</span>
            <strong>自动导入</strong>
          </div>
        </div>
        <div className="info-box">
          点击下方按钮，在已配置的 Edge 浏览器中进入“我的投递”。日常 Edge
          连接会复用已有登录；确实过期时再补登。系统按届别筛选并保存读取到的岗位，无需逐条填写。密码和验证码由你在官网输入。
        </div>
        <a className="connection-url" href={app.url} target="_blank" rel="noreferrer">
          <ExternalLink size={14} />
          {new URL(app.url).hostname}
        </a>
        <p className="muted">
          适配范围以文档为准；首次连接请核对读取结果。无法识别的页面会保留原记录并给出提示。
        </p>
        {app.checkMessage && <p className="connection-message">{app.checkMessage}</p>}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button className="button secondary" onClick={onClose}>
          稍后处理
        </button>
        <button
          className="button primary"
          disabled={busy || active}
          onClick={() => {
            setBusy(true);
            setError('');
            void api('/onboarding/start', 'POST', { applicationIds: [app.id] })
              .then(async () => {
                await onChange();
                onClose();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <ExternalLink size={16} />}打开 /
          重新登录
        </button>
      </div>
    </Dialog>
  );
}
