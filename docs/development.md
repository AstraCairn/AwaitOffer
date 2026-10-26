# 开发说明

## 环境与命令

Windows、Microsoft Edge、Node.js 24.15–24.x；开发和 CI 使用 `.node-version`。不需要额外数据库或额外下载浏览器。

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run test:ui
npm.cmd run screenshots
```

`test:ui` 和 `screenshots` 需要先构建前端，使用 Playwright 的系统 Edge 通道。脚本启动临时本地服务，使用随机空闲端口、临时 SQLite 和模拟查询器；接入服务请求在浏览器中被拦截，其他外部请求被拒绝。退出时清理临时目录，失败截图保存在被 Git 忽略的 `test-results/`。

`screenshots` 运行相同流程，并生成 `docs/images/` 中三张文档截图；公司、岗位和状态均为虚构示例。修改页面后应重新生成截图，不能使用真实投递页面替代。

## 目录

```text
src/
  components/            公共弹窗与公司标识
  features/              投递、书签、连接、设置与首次使用
  hooks/                 本机数据与扩展连接加载
  lib/                   API 与显示格式
  styles/                弹窗与引导样式
server/                  API、SQLite、调度与适配器
shared/                  数据校验、站点清单与扩展协议
extension/               Edge 扩展源码与静态页面
tests/                   隔离的界面测试服务
scripts/                 扩展构建与浏览器流程测试
```

数据库与备份版本保持为 2，继续兼容 v1 备份；本次 UI 改版不要求迁移。主程序版本以 `package.json` 为来源；扩展使用独立版本，由 `extension/manifest.json` 指定。

扩展构建从 `shared/sites.ts` 生成权限清单，并从 TypeScript 生成 JS 和版本信息。生成的 JS 与构建信息不进入 Git；固定身份公钥保持不变。修改扩展代码或页面时需要增加扩展版本。

## 本机配置

```powershell
$env:PORT = '3183'
$env:AWAIT_OFFER_DATA_DIR = 'D:\AwaitOfferData'
$env:AWAIT_OFFER_NO_OPEN = '1'
npm.cmd start
```

3182 为扩展接入服务保留，不能作为面板端口。多个实例不能用不同数据目录争用同一个接入服务。不要在包含真实数据的目录启动测试程序。

开发或启动冒烟验证可使用 `AWAIT_OFFER_NO_EDGE_BRIDGE=1` 禁用扩展接入服务，避免访问本机已有接入服务；正常使用无需设置。关闭该服务时自动同步不可用，手动记录仍可运行。

## 兼容接口

`GET /api/bookmarks/folders` 返回文件夹的 `id`、`name`、`path` 和去重后的递归 `count`。`GET /api/bookmarks?folderId=...` 预览选择范围，`POST /api/bookmarks/import` 接受 `{ folderId?, urls }`。

不传 `folderId` 保留原有“秋招岗位”行为。ID 只用于匹配书签树，不作为文件路径。导入时重新读取当前树，忽略所选范围外的 URL，文件夹不存在时要求重新选择。

## 检查要求

CI 在 Windows 上执行检查、单元测试、构建与界面流程测试。测试覆盖统计、筛选、手动记录、时间轴、v1/v2 恢复、无效备份保护、书签导入、首次引导、连接异常、焦点恢复及三种屏幕尺寸。

所有新增适配器还应提供脱敏 fixture 和失败保护测试。解析测试通过不等于真实站点已验证。
