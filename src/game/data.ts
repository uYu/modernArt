import type { AuctionType, Card } from './types.ts';
export const ARTISTS = [
  {
    name: '林序',
    en: 'LIN XU',
    style: '静物与构成',
    color: '#b9563d',
    paper: '#edd8c3',
  },
  {
    name: '蓝汐',
    en: 'LAN XI',
    style: '海岸与天光',
    color: '#49798a',
    paper: '#d5e4e6',
  },
  {
    name: '莫野',
    en: 'MO YE',
    style: '原野与林间',
    color: '#758163',
    paper: '#e0e2ce',
  },
  {
    name: '叶织',
    en: 'YE ZHI',
    style: '日常与光影',
    color: '#b28b47',
    paper: '#eee2be',
  },
  {
    name: '纪空',
    en: 'JI KONG',
    style: '梦境与人像',
    color: '#8c6e8e',
    paper: '#e5dce4',
  },
];
export const TYPES: Record<
  AuctionType,
  { name: string; icon: string; help: string }
> = {
  open: {
    name: '公开竞价',
    icon: '↗',
    help: '可多次加价。暂不跟价后，若有人加价，你仍可再次参与。',
  },
  once: {
    name: '一次出价',
    icon: '①',
    help: '从拍卖师左手边开始，每人仅一次机会，拍卖师最后出价。',
  },
  sealed: {
    name: '秘密竞价',
    icon: '▣',
    help: '各自锁定报价，一起揭晓。平价时拍卖师优先，其次按顺时针顺序。',
  },
  fixed: {
    name: '一口价',
    icon: '＄',
    help: '拍卖师定价，其他人依次决定购买；无人购买时拍卖师必须自购。',
  },
  double: {
    name: '双重拍卖',
    icon: '×2',
    help: '搭配同艺术家的非双重拍卖卡，两张一起拍卖。补画者成为拍卖师。',
  },
};
export const DEALS: Record<number, number[]> = {
  3: [10, 6, 6, 0],
  4: [9, 4, 4, 0],
  5: [8, 3, 3, 0],
};
// Columns: open, once, sealed, fixed, double. 12 / 13 / 14 / 15 / 16 works.
export const DISTRIBUTION = [
  [2, 3, 2, 3, 2],
  [3, 2, 3, 3, 2],
  [3, 3, 3, 3, 2],
  [3, 3, 3, 3, 3],
  [4, 3, 3, 3, 3],
];
export function makeDeck(): Card[] {
  const types: AuctionType[] = ['open', 'once', 'sealed', 'fixed', 'double'];
  return DISTRIBUTION.flatMap((row, artist) => {
    let index = 0;
    return row.flatMap((count, t) =>
      Array.from({ length: count }, () => ({
        id: `${artist}-${index}`,
        artist,
        type: types[t],
        index: index++,
      })),
    );
  });
}
export function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function title(card: Card) {
  const names = [
    [
      '陶罐与梨',
      '窗边花瓶',
      '琴与静物',
      '铜壶与石榴',
      '柠檬与蓝盘',
      '红椅与玻璃杯',
      '白瓷与黑葡萄',
      '橘子与方镜',
      '烛台与面包',
      '石榴与旧书',
      '茶杯与花影',
      '陶碗与柿子',
    ],
    [
      '晨港',
      '岸边浪花',
      '蓝色岬角',
      '潮汐灯塔',
      '风帆归港',
      '礁石潮池',
      '雾中栈桥',
      '蓝湾小舟',
      '雨前海面',
      '海岸阶梯',
      '晚霞盐田',
      '月光航道',
      '海鸥与浪',
    ],
    [
      '橄榄小径',
      '柳岸',
      '雨后山居',
      '松林晨雾',
      '溪谷石桥',
      '金色麦田',
      '深林木屋',
      '山坡牧场',
      '秋日果园',
      '野花草甸',
      '河湾白桦',
      '暴雨前山谷',
      '夕照梯田',
      '雪线之下',
    ],
    [
      '午后咖啡馆',
      '雨街',
      '向日葵',
      '晨光书房',
      '旧城电车',
      '厨房午餐',
      '裁缝窗台',
      '花市早晨',
      '灯下棋局',
      '雨后面包店',
      '黄色雨伞',
      '窗前猫影',
      '剧院散场',
      '街角报亭',
      '午茶露台',
    ],
    [
      '月下小屋',
      '暮色白马',
      '窗边的人',
      '星河舞者',
      '紫雾列车',
      '镜中花园',
      '漂浮的门',
      '纸鹤与月',
      '夜色长桥',
      '睡莲女孩',
      '云上茶室',
      '双月湖畔',
      '静默天文台',
      '玫瑰阶梯',
      '梦中信使',
      '雨夜白鹿',
    ],
  ];
  return `${names[card.artist][card.index]} · ${String(card.index + 1).padStart(2, '0')}`;
}
