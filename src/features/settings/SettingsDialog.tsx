import { useState } from 'react';
import { ArrowDownToLine, FileUp } from 'lucide-react';
import type { Settings } from '../../../shared/model';
import { Dialog } from '../../components/Dialog';
import { LlmKeyForm, ScheduleForm } from './SettingsForms';

export function SettingsDialog({
  settings,
  onClose,
  onSave,
  onNotice,
  onRestore,
  onGuide,
}: {
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Omit<Settings, 'nextRefreshAt'>) => Promise<void>;
  onNotice: (message: string, error?: boolean) => void;
  onRestore: () => void;
  onGuide: () => void;
}) {
  const [tab, setTab] = useState('schedule');
  const tabIds = ['schedule', 'ai', 'data'];
  return (
    <Dialog title="设置" subtitle="调整同步方式，管理本地数据" onClose={onClose} wide>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {[
          ['schedule', '同步计划'],
          ['ai', 'AI 辅助识别'],
          ['data', '数据与备份'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            tabIndex={tab === id ? 0 : -1}
            aria-selected={tab === id}
            id={`settings-tab-${id}`}
            aria-controls={`settings-panel-${id}`}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const index = tabIds.indexOf(id);
              const next =
                event.key === 'ArrowRight'
                  ? tabIds[(index + 1) % tabIds.length]
                  : event.key === 'ArrowLeft'
                    ? tabIds[(index + tabIds.length - 1) % tabIds.length]
                    : event.key === 'Home'
                      ? tabIds[0]
                      : event.key === 'End'
                        ? tabIds[tabIds.length - 1]
                        : null;
              if (next) {
                event.preventDefault();
                setTab(next);
                document.getElementById(`settings-tab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="dialog-body"
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
      >
        {tab === 'schedule' && <ScheduleForm value={settings} onSave={onSave} />}
        {tab === 'ai' && <LlmKeyForm onDone={onNotice} />}
        {tab === 'data' && (
          <div className="data-settings">
            <h3>数据与备份</h3>
            <p className="muted">
              投递、历史和设置保存在本机。JSON 备份不包含官网登录状态、扩展配对令牌和 AI
              密钥；恢复前会自动保存当前数据。
            </p>
            <div className="connection-buttons">
              <a className="button secondary" href="/api/backup" download>
                <ArrowDownToLine size={16} />
                导出备份
              </a>
              <button className="button secondary" onClick={onRestore}>
                <FileUp size={16} />
                恢复备份
              </button>
            </div>
            <hr />
            <h3>入门引导</h3>
            <p className="muted">重新查看添加投递和连接浏览器的步骤，不会清空已有记录。</p>
            <button className="button secondary" onClick={onGuide}>
              查看入门引导
            </button>
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button className="button secondary" onClick={onClose}>
          完成
        </button>
      </div>
    </Dialog>
  );
}
