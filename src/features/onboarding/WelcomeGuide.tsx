import { useState } from 'react';
import {
  ArrowRight,
  Check,
  FolderOpen,
  GraduationCap,
  KeyRound,
  LoaderCircle,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import type { Settings } from '../../../shared/model';

export function WelcomeGuide({
  settings,
  hasApplications,
  connected,
  onSave,
  onAdd,
  onImport,
  onConnect,
  onFinish,
}: {
  settings: Settings;
  hasApplications: boolean;
  connected: boolean;
  onSave: (next: Omit<Settings, 'nextRefreshAt'>) => Promise<void>;
  onAdd: () => void;
  onImport: () => void;
  onConnect: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [cohort, setCohort] = useState(
    hasApplications
      ? settings.cohort
      : Number(
          new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(
            new Date(),
          ),
        ) + 1,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="welcome-guide" aria-label="首次使用引导">
      <div className="guide-top">
        <span className="brand-mini">
          A<span>·</span>
        </span>
        <span>欢迎来到 AwaitOffer</span>
        <button className="text-button" onClick={onFinish}>
          跳过引导
        </button>
      </div>
      <div className="guide-intro">
        <span className="guide-kicker">等一个好消息</span>
        <h1>
          把投递整理好，
          <br />
          让每一步进展都有迹可循。
        </h1>
        <p>一个本地工作台，记录投递、同步进度，留住每次变化。</p>
      </div>
      <div className="guide-steps" aria-label="引导步骤">
        {['选择届别', '添加投递', '连接浏览器'].map((label, i) => (
          <div className={i === step ? 'current' : i < step ? 'complete' : ''} key={label}>
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            {label}
          </div>
        ))}
      </div>
      <div className="guide-content">
        {step === 0 && (
          <>
            <div className="feature-icon">
              <GraduationCap size={24} />
            </div>
            <h2>你正在准备哪一届校招？</h2>
            <p>自动同步按毕业届别筛选投递，之后可在设置中调整。</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await onSave({
                    enabled: settings.enabled,
                    intervalMinutes: settings.intervalMinutes,
                    cohort,
                  });
                  setStep(1);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                毕业届别
                <input
                  aria-label="毕业届别"
                  type="number"
                  min={2020}
                  max={2100}
                  required
                  value={cohort}
                  onChange={(e) => setCohort(Number(e.target.value))}
                />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : null}下一步
                <ArrowRight size={16} />
              </button>
            </form>
          </>
        )}
        {step === 1 && (
          <>
            <h2>从你的第一条投递开始</h2>
            <p>手动记录可以独立使用，也可以从 Edge 书签批量导入公司入口。</p>
            <div className="guide-options">
              <button onClick={onAdd}>
                <Pencil size={23} />
                <strong>手动添加</strong>
                <span>记下公司、岗位和当前状态</span>
                <ArrowRight size={17} />
              </button>
              <button onClick={onImport}>
                <FolderOpen size={23} />
                <strong>导入书签</strong>
                <span>选择文件夹，预览后批量导入</span>
                <ArrowRight size={17} />
              </button>
            </div>
            {hasApplications && (
              <p className="success-line">
                <Check size={16} />
                投递已记下，可以继续了。
              </p>
            )}
            <button className="button primary" onClick={() => setStep(2)}>
              {hasApplications ? '继续' : '暂不添加，继续'}
              <ArrowRight size={16} />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <div className="feature-icon">
              <KeyRound size={24} />
            </div>
            <h2>{connected ? '浏览器已连接，可以开始了' : '连接 Edge，让进度自动更新'}</h2>
            <p>可选：加载本地扩展后复用有效登录。登录失效和验证码仍需你在官网处理。</p>
            <div className="guide-buttons">
              {!connected && (
                <button className="button primary" onClick={onConnect}>
                  连接浏览器
                  <ArrowRight size={16} />
                </button>
              )}
              <button
                className={`button ${connected ? 'primary' : 'secondary'}`}
                onClick={onFinish}
              >
                {connected ? '进入工作台' : '先用手动记录'}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="guide-footer">
        <ShieldCheck size={15} />
        数据保存在本机，无需注册账号
      </div>
    </section>
  );
}
