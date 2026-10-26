import { useState } from 'react';
const companyLogos: Record<string, { src: string; bleed?: boolean }> = {
  华为: { src: '/logos/huawei.png' },
  小鹏汽车: { src: '/logos/xiaopeng.png' },
  轻舟智航: { src: '/logos/qcraft.png', bleed: true },
  大疆: { src: '/logos/dji.png' },
  阿里巴巴: { src: '/logos/alibaba.png', bleed: true },
  快手: { src: '/logos/kuaishou.png', bleed: true },
  卓驭科技: { src: '/logos/zyt.png' },
  米哈游: { src: '/logos/mihoyo.png' },
  荣耀: { src: '/logos/honor.png', bleed: true },
  腾讯: { src: '/logos/tencent.png', bleed: true },
  新石器: { src: '/logos/neolix.png' },
  联想: { src: '/logos/lenovo.png', bleed: true },
  拓竹科技: { src: '/logos/bambulab.png' },
  百度: { src: '/logos/baidu.png' },
  京东: { src: '/logos/jd.png', bleed: true },
  蚂蚁集团: { src: '/logos/ant.svg' },
  懂车帝: { src: '/logos/dongchedi.png', bleed: true },
  科大讯飞: { src: '/logos/iflytek.png' },
  小马智行: { src: '/logos/pony.png' },
  蔚来: { src: '/logos/nio.png' },
  理想汽车: { src: '/logos/lixiang.png', bleed: true },
  酷哇科技: { src: '/logos/cowarobot.png', bleed: true },
  哔哩哔哩: { src: '/logos/bilibili.png' },
  Shopee: { src: '/logos/shopee.png', bleed: true },
  携程: { src: '/logos/ctrip.png' },
  途虎养车: { src: '/logos/tuhu.png', bleed: true },
  OPPO: { src: '/logos/oppo.png' },
  vivo: { src: '/logos/vivo.png', bleed: true },
  顺丰: { src: '/logos/sf.png', bleed: true },
  小天才: { src: '/logos/xtc.png', bleed: true },
  影石创新: { src: '/logos/insta360.png', bleed: true },
  腾讯音乐: { src: '/logos/tme.png', bleed: true },
  阶跃星辰: { src: '/logos/stepfun.svg', bleed: true },
  新凯来: { src: '/logos/sicarrier.png', bleed: true },
  魔门塔: { src: '/logos/momenta.png', bleed: true },
};

export function CompanyMark({ company }: { company: string }) {
  const logo = companyLogos[company.trim()];
  const [failed, setFailed] = useState(false);
  if (logo && !failed)
    return (
      <span className={`company-mark logo${logo.bleed ? ' bleed' : ''}`} aria-hidden="true">
        <img src={logo.src} alt="" onError={() => setFailed(true)} />
      </span>
    );
  const palette = ['violet', 'rose', 'blue', 'green', 'orange', 'teal'];
  const color = palette[[...company].reduce((sum, c) => sum + c.charCodeAt(0), 0) % palette.length];
  return (
    <span className={`company-mark ${color}`} aria-hidden="true">
      {company.trim().slice(0, 1) || '?'}
    </span>
  );
}
