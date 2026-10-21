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
 */

export default [
  {
    id: 'about',
    type: 'about',
    position: [0, -8],
    rotation: 0,
    accent: '#6366f1',
    badge: '关于',
    title: '伊苏林迪竹节虫',
    subtitle: '科研智能体方向',
    description:
      '中国科学院大学 · 他山科学智能社区。把科研流程里的判断题交给能验证的系统：论文要能被检索和追溯，模型要能被求解器跑一遍，证明要由 verifier 判定。',
    links: [],
  },
  {
    id: 'projects',
    type: 'project',
    position: [-8, 2],
    rotation: Math.PI / 2,
    accent: '#22d3ee',
    badge: '项目',
    title: '精选项目',
    subtitle: '从地震解释图到 Lean 证明',
    description:
      'geoseg 从地震解释图直接提取速度区模型，产出 SPECFEM2D 可用的输入；local-proof-loop 用 Lean 的诊断反馈驱动多轮收敛。',
    links: [
      { label: 'geoseg', url: 'https://github.com/daiduo2/geoseg' },
      { label: 'local-proof-loop', url: 'https://github.com/daiduo2/local-proof-loop' },
    ],
  },
  {
    id: 'bailu',
    type: 'project',
    position: [8, 2],
    rotation: -Math.PI / 2,
    accent: '#f472b6',
    badge: '作品',
    title: 'bailu',
    subtitle: '模拟恐怖网站',
    description:
      '一个以拟真界面做外壳的模拟恐怖网站：网站本身是恐吓，浏览路径是解谜。',
    links: [],
  },
  {
    id: 'contact',
    type: 'contact',
    position: [0, 9],
    rotation: Math.PI,
    accent: '#34d399',
    badge: '联系',
    title: '找到我',
    subtitle: 'GitHub / 他山社区 / 邮件',
    description: '站内没写完的部分，先在这里留个位置。',
    links: [
      { label: 'GitHub', url: 'https://github.com/daiduo2' },
      { label: '他山社区', url: 'https://tashan.ac.cn' },
    ],
  },
]
