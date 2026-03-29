/**
 * Placeholder food image system.
 * In production, these would come from Supabase Storage / CDN.
 * For now, we use colored gradients with emoji overlay.
 */

export type FoodImageConfig = {
  emoji: string;
  bg: string;
  accent: string;
};

/** Seller cover/avatar images */
export const SELLER_IMAGES: Record<string, FoodImageConfig> = {
  'demo-1': { emoji: '🍲', bg: '#FFF3E0', accent: '#FF8A65' },
  'demo-2': { emoji: '🥟', bg: '#E8F5E9', accent: '#66BB6A' },
  'demo-3': { emoji: '🐟', bg: '#E3F2FD', accent: '#42A5F5' },
  'demo-4': { emoji: '🎂', bg: '#FCE4EC', accent: '#EC407A' },
  'demo-5': { emoji: '🥩', bg: '#FBE9E7', accent: '#FF7043' },
  'demo-6': { emoji: '🍳', bg: '#FFFDE7', accent: '#FFCA28' },
};

/** Menu item images */
export const MENU_IMAGES: Record<string, FoodImageConfig> = {
  'm1-1': { emoji: '🍜', bg: '#FFF3E0', accent: '#FFB74D' },
  'm1-2': { emoji: '🍚', bg: '#FFFDE7', accent: '#FFF176' },
  'm1-3': { emoji: '🍖', bg: '#FBE9E7', accent: '#FF8A65' },
  'm1-4': { emoji: '🥗', bg: '#E8F5E9', accent: '#81C784' },
  'm2-1': { emoji: '🥬', bg: '#E8F5E9', accent: '#66BB6A' },
  'm2-2': { emoji: '🥐', bg: '#FFF8E1', accent: '#FFD54F' },
  'm2-3': { emoji: '🌿', bg: '#F1F8E9', accent: '#AED581' },
  'm3-1': { emoji: '🐟', bg: '#E3F2FD', accent: '#64B5F6' },
  'm3-2': { emoji: '🧀', bg: '#FFFDE7', accent: '#FFD54F' },
  'm3-3': { emoji: '🌽', bg: '#FFF8E1', accent: '#FFCA28' },
  'm3-4': { emoji: '🍵', bg: '#E8F5E9', accent: '#81C784' },
  'm4-1': { emoji: '🎂', bg: '#FCE4EC', accent: '#F48FB1' },
  'm4-2': { emoji: '🍪', bg: '#FFF3E0', accent: '#FFB74D' },
  'm4-3': { emoji: '🍮', bg: '#FFF8E1', accent: '#FFD54F' },
  'm5-1': { emoji: '🥩', bg: '#FBE9E7', accent: '#FF8A65' },
  'm5-2': { emoji: '🍗', bg: '#FFF3E0', accent: '#FFB74D' },
  'm5-3': { emoji: '🍽️', bg: '#FFEBEE', accent: '#EF9A9A' },
  'm6-1': { emoji: '🍳', bg: '#FFFDE7', accent: '#FFCA28' },
  'm6-2': { emoji: '🫓', bg: '#FFF8E1', accent: '#FFD54F' },
  'm6-3': { emoji: '🧈', bg: '#FFF3E0', accent: '#FFB74D' },
};

const DEFAULT_IMAGE: FoodImageConfig = { emoji: '🍽️', bg: '#FAF7F2', accent: '#E8E2DA' };

export function getSellerImage(id: string): FoodImageConfig {
  return SELLER_IMAGES[id] ?? DEFAULT_IMAGE;
}

export function getMenuImage(id: string): FoodImageConfig {
  return MENU_IMAGES[id] ?? DEFAULT_IMAGE;
}
