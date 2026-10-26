import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/model';
import { api } from '../../lib/api';
export function LlmKeyForm({ onDone }: { onDone: (message: string, error?: boolean) => void }) {
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void api<{ configured: boolean }>('/llm')
      .then((value) => setConfigured(value.configured))
      .catch(() => {});
  }, []);
  const save = (next: string) => {
    setSaving(true);
    void api<{ configured: boolean }>('/llm', 'PUT', { apiKey: next })
      .then((value) => {
        setConfigured(value.configured);
        setApiKey('');
        onDone(
          next
            ? 'AI 辅助识别密钥已保存。'
            : value.configured
              ? '本机密钥已清除；环境变量仍配置了密钥，移除并重启服务后可停用。'
              : 'AI 辅助识别密钥已清除。',
        );
      })
      .catch((error: Error) => onDone(error.message, true))
      .finally(() => setSaving(false));
  };
  return (
    <form
      className="schedule-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (apiKey.trim()) save(apiKey.trim());
      }}
    >
      <h3>AI 辅助识别</h3>
      <p className="muted">
        {configured
          ? '已配置。密钥只保存在本机，不会进入备份。'
          : '未配置。飞书、北森、Moka 不需要它；部分自建官网可使用它辅助识别字段。'}
      </p>
      <p className="muted">
        启用后会向 xAI
        发送招聘接口的字段结构和经过处理的样例，可能包含岗位、状态、时间等短文本。无需此功能时可不配置。如通过环境变量配置，还需移除环境变量并重启服务才能停用。
      </p>
      <div className="schedule-fields">
        <label>
          xAI API 密钥（可选）
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={configured ? '已配置，输入新密钥可替换' : ''}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <button className="button primary" disabled={saving || !apiKey.trim()}>
          保存密钥
        </button>
        {configured && (
          <button className="button" type="button" disabled={saving} onClick={() => save('')}>
            清除
          </button>
        )}
      </div>
    </form>
  );
}
export function ScheduleForm({
  value,
  onSave,
}: {
  value: Settings;
  onSave: (value: Omit<Settings, 'nextRefreshAt'>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(value.enabled);
  const [interval, setIntervalValue] = useState(value.intervalMinutes);
  const [customInterval, setCustomInterval] = useState(
    ![60, 360, 720, 1440, 2880].includes(value.intervalMinutes),
  );
  const [cohort, setCohort] = useState(value.cohort);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="schedule-form"
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        void onSave({ enabled, intervalMinutes: interval, cohort })
          .catch((e) => setError((e as Error).message))
          .finally(() => setSaving(false));
      }}
    >
      <h3>同步计划</h3>
      <label className="schedule-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        服务运行时自动刷新
      </label>
      <div className="schedule-fields">
        <label>
          同步频率
          <select
            aria-label="同步频率"
            value={customInterval ? 'custom' : interval}
            onChange={(e) => {
              const custom = e.target.value === 'custom';
              setCustomInterval(custom);
              if (!custom) setIntervalValue(Number(e.target.value));
            }}
          >
            <option value={60}>每小时</option>
            <option value={360}>每 6 小时</option>
            <option value={720}>每 12 小时</option>
            <option value={1440}>每天</option>
            <option value={2880}>每两天</option>
            <option value="custom">自定义间隔</option>
          </select>
        </label>
        {customInterval && (
          <label>
            间隔（分钟）
            <input
              type="number"
              min={5}
              max={10080}
              required
              value={interval}
              onChange={(e) => setIntervalValue(Number(e.target.value))}
            />
          </label>
        )}
        <label>
          毕业届别
          <input
            type="number"
            min={2020}
            max={2100}
            required
            value={cohort}
            onChange={(e) => setCohort(Number(e.target.value))}
          />
        </label>
        <button className="button primary" disabled={saving}>
          保存设置
        </button>
      </div>
      <p className="muted">
        关闭面板标签页后仍会刷新；退出本地服务或电脑关机后停止。浏览器会话持续复用，过期或验证后暂停该官网。
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
