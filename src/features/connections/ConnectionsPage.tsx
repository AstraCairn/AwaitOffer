import { ArrowUpRight, KeyRound, Plus, RefreshCw } from 'lucide-react';
import { supportsAuto, type Application, type Dashboard } from '../../../shared/model';
import type { EdgeSetup } from '../../../shared/edge-protocol';
import { CompanyMark } from '../../components/CompanyMark';
import { date } from '../../lib/format';

export function ConnectionsPage({
  data,
  setup,
  busy,
  onBrowser,
  onConnect,
  onStart,
  onImport,
  onRestoreIgnored,
}: {
  data: Dashboard;
  setup: EdgeSetup | null;
  busy: boolean;
  onBrowser: () => void;
  onConnect: (app: Application) => void;
  onStart: () => void;
  onImport: () => void;
  onRestoreIgnored: (connectionId: string, externalId: string) => void;
}) {
  const companies = data.applications.filter(
    (a, i, all) =>
      supportsAuto(a.url) &&
      all.findIndex((b) => new URL(b.url).origin === new URL(a.url).origin) === i,
  );
  const stateLabels: Record<string, string> = {
    ok: '可查询',
    expired: '需重新登录',
    challenge: '需人工验证',
    error: '查询失败',
    unmatched: '待关联投递',
    unknown: '尚未读取',
    connecting: '等待登录',
  };
  return (
    <div className="connections-page">
      <section className="panel browser-card">
        <div className="feature-icon">
          <KeyRound size={22} />
        </div>
        <div>
          <h2>{setup?.connected ? 'Edge 浏览器已连接' : '连接你的 Edge 浏览器'}</h2>
          <p>复用有效登录，在独立窗口查询进度，最多使用 3 个后台标签页。</p>
        </div>
        <button className="button secondary" onClick={onBrowser}>
          {setup?.connected ? '管理浏览器' : '连接浏览器'}
          <ArrowUpRight size={15} />
        </button>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>
              公司连接<span className="section-count">{companies.length}</span>
            </h2>
            <p>一个官网连接可关联多条投递。登录和验证码由你在官网完成。</p>
          </div>
          <button
            className="button primary small"
            disabled={busy || !setup?.connected || !companies.length || data.onboarding.active}
            onClick={onStart}
          >
            <RefreshCw size={15} />
            依次连接
          </button>
        </div>
        {companies.length ? (
          <div className="connection-list">
            {companies.map((app) => {
              const connection = data.connections.find((c) => c.id === app.connectionId);
              return (
                <div className="connection-list-item" key={app.id}>
                  <CompanyMark company={app.company} />
                  <div>
                    <strong>{app.company}</strong>
                    <small>{new URL(app.url).hostname}</small>
                    <small>
                      {connection?.verifiedAt
                        ? `最近成功读取 ${date(connection.verifiedAt)}`
                        : '尚未成功读取'}
                    </small>
                  </div>
                  <span className={`connection-state ${app.checkState === 'ok' ? 'ok' : ''}`}>
                    {stateLabels[app.checkState]}
                  </span>
                  <button
                    className="button secondary small"
                    disabled={busy || !setup?.connected}
                    onClick={() => onConnect(app)}
                  >
                    管理连接
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <KeyRound size={30} />
            <h3>还没有可连接的公司</h3>
            <p>先导入公司书签，或添加一条已适配官网的投递。</p>
            <button className="button secondary" onClick={onImport}>
              <Plus size={15} />
              导入公司入口
            </button>
          </div>
        )}
      </section>
      <section className="panel coverage-panel">
        <h2>适配范围</h2>
        <p className="muted">以下信息反映本机读取情况，不能保证同一平台的所有公司均可同步。</p>
        {data.adapterCoverage.map((item) => (
          <div className="coverage-item" key={item.platform}>
            <strong>{item.platform}</strong>
            <span>{item.status}</span>
          </div>
        ))}
      </section>
      {!!data.onboarding.results.length && (
        <section className="panel coverage-panel">
          <h2>最近连接结果</h2>
          {data.onboarding.results.map((item, i) => (
            <div className="coverage-item" key={`${item.company}-${i}`}>
              <strong>{item.company}</strong>
              <span>
                {item.message} · 新增 {item.imported} 条
              </span>
            </div>
          ))}
        </section>
      )}
      {!!data.ignored.length && (
        <section className="panel coverage-panel">
          <h2>已忽略的官网投递</h2>
          <p className="muted">删除的自动投递会被记住，恢复导入后可在下次同步重新出现。</p>
          {data.ignored.map((item) => (
            <div className="coverage-item" key={`${item.connectionId}-${item.externalId}`}>
              <strong>
                {data.connections.find((c) => c.id === item.connectionId)?.name ?? '官网投递'}
              </strong>
              <span>{item.position}</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => onRestoreIgnored(item.connectionId, item.externalId)}
              >
                恢复导入
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
