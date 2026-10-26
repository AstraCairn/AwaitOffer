import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  detectPlatform,
  sanitizeRecruitmentUrl,
  type Bookmark,
  type BookmarkFolder,
} from '../shared/model.js';

export interface BookmarkNode {
  id?: string;
  guid?: string;
  name?: string;
  type?: string;
  url?: string;
  children?: BookmarkNode[];
}
export interface BookmarkTree {
  roots: Record<string, BookmarkNode>;
}
export type BookmarkReader = () => Promise<BookmarkTree>;

function folderId(node: BookmarkNode, location: string) {
  return node.guid ? `guid:${node.guid}` : node.id ? `edge:${node.id}` : `path:${location}`;
}
const companyNames: Record<string, string> = {
  'career.huawei.com': '华为',
  'xiaopeng.jobs.feishu.cn': '小鹏汽车',
  'qcraft.jobs.feishu.cn': '轻舟智航',
  'apply.careers.dji.com': '大疆',
  'campus-talent.alibaba.com': '阿里巴巴',
  'campus.kuaishou.cn': '快手',
  'we.zyt.com': '卓驭科技',
  'jobs.mihoyo.com': '米哈游',
  'career.honor.com': '荣耀',
  'join.qq.com': '腾讯',
  'r3c0qt6yjw.jobs.feishu.cn': '新石器',
  'talent.lenovo.com.cn': '联想',
  'bambulab.jobs.feishu.cn': '拓竹科技',
  'talent.baidu.com': '百度',
  'campus.jd.com': '京东',
  'talent.antgroup.com': '蚂蚁集团',
  'dcar.jobs.feishu.cn': '懂车帝',
  'iflytek.zhiye.com': '科大讯飞',
  'ponyai.jobs.feishu.cn': '小马智行',
  'nio.jobs.feishu.cn': '蔚来',
  'www.lixiang.com': '理想汽车',
  'anker-in.jobs.feishu.cn': '安克创新',
  'jobs.bilibili.com': '哔哩哔哩',
  'careers.ctrip.com': '携程',
  'careers.oppo.com': 'OPPO',
  'hr-campus.vivo.com': 'vivo',
  'campus.sf-express.com': '顺丰',
  'transsion.zhiye.com': '传音控股',
  'arashivision.jobs.feishu.cn': '影石创新',
  'join.tencentmusic.com': '腾讯音乐',
  'career.sicarrier.com': '新凯来',
  'momenta.jobs.feishu.cn': '魔门塔',
};
const mokaCompanies: [string, string][] = [
  ['/cowarobot/', '酷哇科技'],
  ['/shopee/', 'Shopee'],
  ['/tuhu/', '途虎养车'],
  ['/eebbk/', '小天才'],
  ['/step/', '阶跃星辰'],
  ['/smartcitysz/', '深智城'],
  ['/grgbanking/', '广电运通'],
];
function companyName(url: URL, fallback?: string) {
  if (url.hostname === 'app.mokahr.com') {
    const path = url.pathname.toLowerCase();
    const match = mokaCompanies.find(([segment]) => path.includes(segment));
    if (match) return match[1];
  }
  return companyNames[url.hostname] ?? fallback ?? url.hostname;
}
export function parseBookmarks(input: BookmarkTree, selectedFolderId?: string): Bookmark[] {
  const result: Bookmark[] = [];
  let found = false;
  const visit = (node: BookmarkNode, selected: boolean, location: string) => {
    const matches = selectedFolderId
      ? folderId(node, location) === selectedFolderId && node.type === 'folder'
      : node.type === 'folder' && node.name === '秋招岗位';
    if (matches) found = true;
    const inside = selected || matches;
    if (inside && node.type === 'url' && node.url) {
      try {
        const url = new URL(node.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
        // 去掉认证参数，保留导航参数和 SPA 的个人中心路由。
        const safeUrl = sanitizeRecruitmentUrl(url.toString());
        result.push({
          company: companyName(url, node.name),
          title: node.name ?? '',
          url: safeUrl,
          platform: detectPlatform(safeUrl),
        });
      } catch {
        /* 忽略无效网址 */
      }
    }
    for (const [index, child] of (node.children ?? []).entries())
      visit(child, inside, `${location}/${index}`);
  };
  for (const [key, root] of Object.entries(input.roots ?? {}))
    visit({ ...root, type: root.type ?? 'folder' }, false, key);
  if (selectedFolderId && !found) throw new Error('书签文件夹已不存在，请重新选择文件夹。');
  return [...new Map(result.map((item) => [item.url, item])).values()];
}
export function listBookmarkFolders(input: BookmarkTree): BookmarkFolder[] {
  const folders: BookmarkFolder[] = [];
  const visit = (node: BookmarkNode, location: string, parents: string[]) => {
    const name = node.name || '未命名文件夹';
    const path = [...parents, name];
    if (node.type === 'folder') {
      const id = folderId(node, location);
      folders.push({ id, name, path: path.join(' / '), count: parseBookmarks(input, id).length });
    }
    for (const [index, child] of (node.children ?? []).entries())
      visit(child, `${location}/${index}`, path);
  };
  for (const [key, root] of Object.entries(input.roots ?? {}))
    visit({ ...root, type: root.type ?? 'folder', name: root.name || key }, key, []);
  return folders;
}
export async function readEdgeBookmarkTree(): Promise<BookmarkTree> {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA)
    throw new Error('当前只支持读取本机 Windows Edge 默认配置的书签。');
  const path = join(
    process.env.LOCALAPPDATA,
    'Microsoft',
    'Edge',
    'User Data',
    'Default',
    'Bookmarks',
  );
  try {
    return JSON.parse(await readFile(path, 'utf8')) as BookmarkTree;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('未找到 Edge 默认配置的书签。请先在 Edge 中添加书签，或使用手动记录。');
    throw new Error('无法读取 Edge 书签文件，请确认文件完整后重试。');
  }
}
export async function readEdgeBookmarks(
  selectedFolderId?: string,
  reader: BookmarkReader = readEdgeBookmarkTree,
): Promise<Bookmark[]> {
  const items = parseBookmarks(await reader(), selectedFolderId);
  if (!selectedFolderId && !items.length)
    throw new Error('Edge 默认配置中未找到“秋招岗位”文件夹或其中没有有效网址，请选择其他文件夹。');
  return items;
}
