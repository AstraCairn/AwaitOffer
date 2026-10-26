import { useState, type FormEvent } from 'react';
import { Check, KeyRound, LoaderCircle, Pencil, RefreshCw } from 'lucide-react';
import {
  stages,
  stageLabels,
  detectPlatform,
  type Application,
  type ApplicationInput,
  type Stage,
} from '../../../shared/model';
import { platformLabels } from '../../lib/format';
import { Dialog } from '../../components/Dialog';

export function ApplicationForm({
  app,
  onClose,
  onSave,
}: {
  app?: Application;
  onClose: () => void;
  onSave: (input: ApplicationInput) => Promise<void>;
}) {
  const [form, setForm] = useState<ApplicationInput>(
    app
      ? {
          company: app.company,
          position: app.position,
          batch: app.batch,
          url: app.url,
          mode: app.mode,
          platform: app.platform,
          rawStatus: app.rawStatus,
          appliedAt: app.appliedAt,
          stageOverride: app.stageOverride,
        }
      : {
          company: '',
          position: '',
          batch: '秋招正式批',
          url: '',
          mode: 'manual',
          platform: 'manual',
          rawStatus: '',
          appliedAt: null,
          stageOverride: null,
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = <K extends keyof ApplicationInput>(key: K, value: ApplicationInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({ ...form, position: form.position || '待确认岗位' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title={app ? '编辑投递' : '新增投递'}
      subtitle={app ? '完善资料或更新手动进度' : '先记下投递，之后可随时连接官网同步。'}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="dialog-body form-body">
          {!app && (
            <div className="mode-picker">
              <button
                type="button"
                className={form.mode === 'auto' ? 'selected' : ''}
                onClick={() => update('mode', 'auto')}
              >
                <RefreshCw size={18} />
                <strong>自动查进度</strong>
                <span>连接官网，自动跟踪变化</span>
              </button>
              <button
                type="button"
                className={form.mode === 'manual' ? 'selected' : ''}
                onClick={() => update('mode', 'manual')}
              >
                <Pencil size={18} />
                <strong>手动记录</strong>
                <span>独立使用，随时更新进度</span>
              </button>
            </div>
          )}
          <div className="form-grid">
            <label>
              公司名称 <b>*</b>
              <input
                required
                maxLength={200}
                placeholder="例如：星河科技"
                value={form.company}
                onChange={(e) => update('company', e.target.value)}
              />
            </label>
            <label>
              投递岗位
              <input
                maxLength={200}
                placeholder="例如：前端开发工程师"
                value={form.position}
                onChange={(e) => update('position', e.target.value)}
              />
            </label>
            <label>
              投递批次
              <input
                maxLength={100}
                placeholder="提前批 / 秋招正式批"
                value={form.batch}
                onChange={(e) => update('batch', e.target.value)}
              />
            </label>
            <label>
              投递时间
              <input
                type="date"
                value={form.appliedAt?.slice(0, 10) ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) update('appliedAt', null);
                  else if (form.appliedAt?.startsWith(next)) update('appliedAt', form.appliedAt);
                  else update('appliedAt', next);
                }}
              />
            </label>
            <label>
              招聘系统
              <select
                disabled={form.mode === 'auto'}
                value={form.platform}
                onChange={(e) => update('platform', e.target.value as ApplicationInput['platform'])}
              >
                {Object.entries(platformLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            官网个人中心链接 <b>*</b>
            <input
              required
              type="url"
              maxLength={2048}
              disabled={!!app && app.mode === 'auto'}
              placeholder="https://careers.example.com/applications"
              value={form.url}
              onChange={(e) => {
                let next = form.platform;
                try {
                  next = detectPlatform(e.target.value);
                } catch {}
                setForm({ ...form, url: e.target.value, platform: next });
              }}
            />
          </label>
          {form.mode === 'manual' && (
            <label>
              官网当前状态
              <input
                maxLength={200}
                placeholder="例如：简历初筛 / 业务复试（可暂时留空）"
                value={form.rawStatus}
                onChange={(e) => update('rawStatus', e.target.value)}
              />
            </label>
          )}
          <label>
            标准阶段
            <select
              value={form.stageOverride ?? ''}
              onChange={(e) => update('stageOverride', (e.target.value || null) as Stage | null)}
            >
              <option value="">根据原始状态自动分类</option>
              {stages.map((stage) => (
                <option key={stage} value={stage}>
                  {stageLabels[stage]}
                </option>
              ))}
            </select>
          </label>
          {form.mode === 'auto' && (
            <div className="info-box">
              <KeyRound size={16} />
              <span>
                保存后连接官网，正常登录即可读取投递。飞书、Moka、北森及已适配的自建官网均可自动查询。
              </span>
            </div>
          )}
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={16} />}
            {app ? '保存修改' : '保存投递'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
