import type { Appearance } from './types';

export const coatPalettes: Record<Appearance['coat'], [string, string, string]> = {
  橘白: ['#d9863b', '#f8e8c7', '#6e4028'],
  奶牛: ['#f4ead6', '#383638', '#d79285'],
  狸花: ['#8a704f', '#433a31', '#d5b878'],
  三花: ['#eee0c4', '#ce7442', '#4a4038'],
  银灰: ['#9ba6ad', '#e4e0d5', '#4e5961'],
  奶油: ['#e8c987', '#fff0c9', '#9b6c45'],
  玳瑁: ['#4b362e', '#c8753f', '#241f20'],
  重点色: ['#e9d9bc', '#58463f', '#8ab1c6'],
  金渐层: ['#c99645', '#f2d69b', '#5b4432'],
  纯黑: ['#29272a', '#555159', '#111114'],
  蓝白: ['#748594', '#f2eadb', '#34404a'],
  阿比西尼亚: ['#a8613d', '#d99a62', '#56382b'],
};

export const breeds: Appearance['breed'][] = ['田园猫', '英短', '暹罗', '长毛猫', '缅因猫', '布偶猫', '孟加拉豹猫', '德文卷毛猫', '挪威森林猫'];
export const coats = Object.keys(coatPalettes) as Appearance['coat'][];

export function randomAppearance(previous?: Appearance): Appearance {
  let breed = pick(breeds);
  let coat = pick(coats);
  if (previous && breed === previous.breed && coat === previous.coat) coat = coats[(coats.indexOf(coat) + 1) % coats.length]!;
  return { breed, coat, colors: [...coatPalettes[coat]] };
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}
