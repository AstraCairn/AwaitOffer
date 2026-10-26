import { useState, useEffect } from 'react';
import { ArrowRight, CheckCheck, ExternalLink, LoaderCircle, Sparkles } from 'lucide-react';
import { stageLabels, hasUnread, type Application, type History } from '../../../shared/model';
import { api } from '../../lib/api';
import { date } from '../../lib/format';
import { Dialog } from '../../components/Dialog';
import { CompanyMark } from '../../components/CompanyMark';

export function HistoryDialog({
  app,
  onClose,
  onRead,
}: {
  app: Application;
  onClose: () => void;
  onRead: () => void;
}) {
  const [history, setHistory] = useState<History[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<History[]>(`/applications/${app.id}/history`)
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, [app.id, app.lastChangeId]);
  const lastChange = history?.find((h) => h.id === app.lastChangeId);
  return (
    <Dialog
      title={`${app.company} · 进度时间轴`}
      subtitle={`${app.position} / ${app.batch}`}
      onClose={onClose}
    >
      <div className="dialog-body">
        <div className="history-summary">
          <CompanyMark company={app.company} />
          <div>
            <strong>{app.rawStatus || '尚未记录进度'}</strong>
            <span className={`stage-badge stage-${app.stage}`}>{stageLabels[app.stage]}</span>
          </div>
          <a className="button secondary small" href={app.url} target="_blank" rel="noreferrer">
            官网
            <ExternalLink size={13} />
          </a>
        </div>
        {hasUnread(app) && lastChange && (
          <div className="change-detail">
            <Sparkles size={17} />
            <span>
              {lastChange.fromStatus}
              <ArrowRight size={15} />
              <strong>{lastChange.toStatus}</strong>
            </span>
            <button onClick={onRead}>
              标为已读
              <CheckCheck size={14} />
            </button>
          </div>
        )}
        {!app.sinceKnown && app.rawStatus && (
          <p className="muted timeline-note">
            首次记录前的状态开始日期未知，停留时间从首次记录起计算。
          </p>
        )}
        <div className="timeline">
          {history?.map((item, index) => (
            <div className={`timeline-item ${index === 0 ? 'latest' : ''}`} key={item.id}>
              <div className="timeline-point" />
              <div>
                <small>
                  {date(item.at)}{' '}
                  <span>
                    {item.source === 'initial'
                      ? '首次记录'
                      : item.source === 'auto'
                        ? '官网查询'
                        : '手动更新'}
                  </span>
                </small>
                <p>
                  {item.fromStatus ? (
                    <>
                      <span>{item.fromStatus}</span>
                      <ArrowRight size={13} />
                      <strong>{item.toStatus}</strong>
                    </>
                  ) : (
                    <strong>{item.toStatus}</strong>
                  )}
                </p>
              </div>
            </div>
          ))}
          {history?.length === 0 && (
            <p className="muted">还没有状态记录。连接官网或手动填写进度后，时间轴会从这里开始。</p>
          )}
          {history === null && !error && <LoaderCircle className="spin" size={20} />}
          {error && <div className="inline-error">{error}</div>}
        </div>
      </div>
    </Dialog>
  );
}
