/**
 * 场景里的展台清单。
 * 加一条记录就会在场地里多一座构筑物 —— 位置、文案、链接都在这里改。
 *
 * 字段说明：
 *   position   [x, z]  在场地里的坐标
 *   rotation   面向角度（弧度），0 表示牌面朝 +Z
 *   type       project | about | contact | link
 *   accent     强调色（同时用于地面上的发光环和展板侧边条）
 *   radius     玩家走到多近时展开摘要
 *
 * 布局：出生点在场地中央，四座构筑物散在四周，
 * 互相之间不遮挡，从任何一个方向望过去都至少能看见两座。
 *
 * 摆位有一条硬约束：**相机在角色身后二十几米**。
 * 相机和某座构筑物如果同时落在「离出生点差不多远」的位置上，
 * 相机就会从构筑物旁边擦过去，它的门楣会怼进画面右上角。
 * 所以 contact 放在右后方，避开出生点与 about 之间的视线。
 *
 * 这里放的是"这个站自己的东西"：作品与作品背后的项目。
 * 学术履历那套在 GitHub profile README 里，不在这个站。
 */

export const SPAWN = { x: 2, z: 3 }

export default [
  {
    id: 'about',
    type: 'about',
    position: [0, -11],
    rotation: 0,
    accent: '#e8c88a',
    badge: '关于',
    title: 'aufheben',
    subtitle: '一个能走进去的个人主页',
    description:
      '与其贴一张作品清单，不如把场地搭出来：走到展台前才看到内容。左前方是作品，右前方是作品背后的项目，身后是联系方式。',
    links: [],
  },
  {
    id: 'bailu',
    type: 'project',
    position: [-18, 3],
    rotation: Math.PI / 2,
    accent: '#e0705c',
    badge: '作品',
    title: '白鹿疗养院',
    subtitle: '拟真档案网站 / 叙事解谜',
    description:
      '一个把自己伪装成医院病历数字化项目的网站。界面是照着真的做的，档案看起来也是真的——只有打开它的人会发现哪里不对劲。浏览路径本身就是解谜。',
    links: [],
  },
  {
    id: 'story2',
    type: 'project',
    position: [18, -1],
    rotation: -Math.PI / 2,
    accent: '#7fa8c9',
    badge: '项目',
    title: 'story2',
    subtitle: '交互式叙事框架',
    description:
      '白鹿疗养院背后的那套东西：主线内容、角色变体、外围事件日志，还有玩家存档。内容按目录组织，一次构建出一个站点，换一批内容就是一个新作品。',
    links: [{ label: 'GitHub', url: 'https://github.com/daiduo2/story2' }],
  },
  {
    id: 'contact',
    type: 'contact',
    position: [16, 21],
    rotation: Math.PI,
    accent: '#9ac49b',
    badge: '联系',
    title: '找到我',
    subtitle: 'GitHub',
    description: '代码、实验记录和还没做完的草稿都在这儿。',
    links: [{ label: 'GitHub', url: 'https://github.com/daiduo2' }],
  },
]
