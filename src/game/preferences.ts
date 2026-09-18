export type GameLevel = 'beginner' | 'medium' | 'hard' | 'expert';
export const LEVELS: Record<GameLevel, string> = {
  beginner: '入门',
  medium: '中等',
  hard: '困难',
  expert: '专家',
};
export type Difficulty = 'easy' | 'standard' | 'adaptive';
export type Personality =
  | 'novice'
  | 'relaxed'
  | 'classic'
  | 'balanced'
  | 'cautious'
  | 'bold'
  | 'control';
export interface AIConfig {
  level?: GameLevel;
  difficulty: Difficulty;
  personalities: Personality[];
}
export interface Preferences {
  level?: GameLevel;
  speed: number;
  saleMode: 'brief' | 'confirm';
  hints: boolean;
  difficulty: Difficulty;
  personality: Personality | 'mixed';
}
export const PREFERENCES_KEY = 'modern-art.preferences.v1';
export const DEFAULT_PREFERENCES: Preferences = {
  level: 'beginner',
  speed: 850,
  saleMode: 'brief',
  hints: true,
  difficulty: 'standard',
  personality: 'classic',
};
export const PERSONALITIES: Record<Personality, string> = {
  novice: '新手收藏家 · 简单',
  relaxed: '佛系买家 · 更轻松',
  classic: '原版稳健',
  balanced: '均衡',
  cautious: '保守',
  bold: '激进',
  control: '控场',
};
export function validAIConfig(value: unknown): value is AIConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as AIConfig;
  return (
    (v.level === undefined || Object.hasOwn(LEVELS, v.level)) &&
    ['easy', 'standard', 'adaptive'].includes(v.difficulty) &&
    Array.isArray(v.personalities) &&
    v.personalities.length >= 3 &&
    v.personalities.length <= 5 &&
    v.personalities.every((p) => Object.hasOwn(PERSONALITIES, p))
  );
}
export function parsePreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw ?? '{}');
    return {
      level: Object.hasOwn(LEVELS, p.level) ? p.level : 'beginner',
      speed: [200, 850, 1500].includes(p.speed) ? p.speed : 850,
      saleMode: p.saleMode === 'confirm' ? 'confirm' : 'brief',
      hints: typeof p.hints === 'boolean' ? p.hints : true,
      difficulty: ['easy', 'standard', 'adaptive'].includes(p.difficulty)
        ? p.difficulty
        : 'standard',
      personality: ['mixed', ...Object.keys(PERSONALITIES)].includes(
        p.personality,
      )
        ? p.personality
        : 'classic',
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function makeAIConfig(
  count: number,
  preferences: Preferences,
  salt: number,
): AIConfig {
  const styles: Personality[] = ['cautious', 'bold', 'control', 'balanced'];
  // A separate cosmetic draw assigns styles, not a fixed seat-to-strength mapping.
  return {
    difficulty: preferences.difficulty,
    personalities: Array.from({ length: count }, (_, i) =>
      preferences.personality === 'mixed'
        ? styles[(i + (salt % 4)) % 4]
        : preferences.personality,
    ),
  };
}

export function makeLevelConfig(count: number, level: GameLevel): AIConfig {
  return {
    level,
    difficulty:
      level === 'beginner' || level === 'medium' ? 'easy' : 'standard',
    personalities: Array<Personality>(count).fill('classic'),
  };
}
export function configLevel(config?: AIConfig): GameLevel {
  if (!config) return 'hard';
  if (config.level) return config.level;
  if (
    config.personalities
      .slice(1)
      .every((p) => p === 'relaxed' || p === 'novice')
  )
    return 'beginner';
  return config.difficulty === 'easy'
    ? 'medium'
    : config.difficulty === 'adaptive'
      ? 'expert'
      : 'hard';
}
