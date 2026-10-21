/**
 * 场景里的展台清单。
 * 加一条记录就会在场地里多一个展台 —— 位置、文案、链接都在这里改。
 *
 * 字段说明：
 *   position   [x, z]  在场地里的坐标
 *   rotation   面向角度（弧度），0 表示牌面朝 +Z
 *   type       project | about | contact | link
 *   accent     强调色
 *   radius     玩家走到多近时触发
 *
 * 这里放的是"这个站自己的东西"：作品与作品背后的项目。
 * 学术履历那套在 GitHub profile README 里，不在这个站。
 */

export default [
  {
    id: 'about',
    type: 'about',
    position: [0, -8],
    rotation: 0,
    accent: '#6366f1',
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
    position: [-8, 2],
    rotation: Math.PI / 2,
    accent: '#f472b6',
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
    position: [8, 2],
    rotation: -Math.PI / 2,
    accent: '#22d3ee',
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
    position: [0, 9],
    rotation: Math.PI,
    accent: '#34d399',
    badge: '联系',
    title: '找到我',
    subtitle: 'GitHub',
    description: '代码、实验记录和还没做完的草稿都在这儿。',
    links: [{ label: 'GitHub', url: 'https://github.com/daiduo2' }],
  },
]
