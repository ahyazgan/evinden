/**
 * Food image system with real generated images.
 * Uses local assets generated via Grok API.
 */
import { ImageSourcePropType } from 'react-native';

export type FoodImageConfig = {
  emoji: string;
  bg: string;
  accent: string;
  image: ImageSourcePropType;
};

/** Seller cover/avatar images */
export const SELLER_IMAGES: Record<string, FoodImageConfig> = {
  'demo-1': { emoji: '🍲', bg: '#FFF3E0', accent: '#FF8A65', image: require('@/assets/images/sellers/demo-1.png') },
  'demo-2': { emoji: '🥟', bg: '#E8F5E9', accent: '#66BB6A', image: require('@/assets/images/sellers/demo-2.png') },
  'demo-3': { emoji: '🐟', bg: '#E3F2FD', accent: '#42A5F5', image: require('@/assets/images/sellers/demo-3.png') },
  'demo-4': { emoji: '🎂', bg: '#FCE4EC', accent: '#EC407A', image: require('@/assets/images/sellers/demo-4.png') },
  'demo-5': { emoji: '🥩', bg: '#FBE9E7', accent: '#FF7043', image: require('@/assets/images/sellers/demo-5.png') },
  'demo-6': { emoji: '🍳', bg: '#FFFDE7', accent: '#FFCA28', image: require('@/assets/images/sellers/demo-6.png') },
};

/** Menu item images */
export const MENU_IMAGES: Record<string, FoodImageConfig> = {
  'm1-1': { emoji: '🍜', bg: '#FFF3E0', accent: '#FFB74D', image: require('@/assets/images/menu/m1-1.png') },
  'm1-2': { emoji: '🍚', bg: '#FFFDE7', accent: '#FFF176', image: require('@/assets/images/menu/m1-2.png') },
  'm1-3': { emoji: '🍖', bg: '#FBE9E7', accent: '#FF8A65', image: require('@/assets/images/menu/m1-3.png') },
  'm1-4': { emoji: '🥗', bg: '#E8F5E9', accent: '#81C784', image: require('@/assets/images/menu/m1-4.png') },
  'm2-1': { emoji: '🥬', bg: '#E8F5E9', accent: '#66BB6A', image: require('@/assets/images/menu/m2-1.png') },
  'm2-2': { emoji: '🥐', bg: '#FFF8E1', accent: '#FFD54F', image: require('@/assets/images/menu/m2-2.png') },
  'm2-3': { emoji: '🌿', bg: '#F1F8E9', accent: '#AED581', image: require('@/assets/images/menu/m2-3.png') },
  'm3-1': { emoji: '🐟', bg: '#E3F2FD', accent: '#64B5F6', image: require('@/assets/images/menu/m3-1.png') },
  'm3-2': { emoji: '🧀', bg: '#FFFDE7', accent: '#FFD54F', image: require('@/assets/images/menu/m3-2.png') },
  'm3-3': { emoji: '🌽', bg: '#FFF8E1', accent: '#FFCA28', image: require('@/assets/images/menu/m3-3.png') },
  'm3-4': { emoji: '🍵', bg: '#E8F5E9', accent: '#81C784', image: require('@/assets/images/menu/m3-4.png') },
  'm4-1': { emoji: '🎂', bg: '#FCE4EC', accent: '#F48FB1', image: require('@/assets/images/menu/m4-1.png') },
  'm4-2': { emoji: '🍪', bg: '#FFF3E0', accent: '#FFB74D', image: require('@/assets/images/menu/m4-2.png') },
  'm4-3': { emoji: '🍮', bg: '#FFF8E1', accent: '#FFD54F', image: require('@/assets/images/menu/m4-3.png') },
  'm5-1': { emoji: '🥩', bg: '#FBE9E7', accent: '#FF8A65', image: require('@/assets/images/menu/m5-1.png') },
  'm5-2': { emoji: '🍗', bg: '#FFF3E0', accent: '#FFB74D', image: require('@/assets/images/menu/m5-2.png') },
  'm5-3': { emoji: '🍽️', bg: '#FFEBEE', accent: '#EF9A9A', image: require('@/assets/images/menu/m5-3.png') },
  'm6-1': { emoji: '🍳', bg: '#FFFDE7', accent: '#FFCA28', image: require('@/assets/images/menu/m6-1.png') },
  'm6-2': { emoji: '🫓', bg: '#FFF8E1', accent: '#FFD54F', image: require('@/assets/images/menu/m6-2.png') },
  'm6-3': { emoji: '🧈', bg: '#FFF3E0', accent: '#FFB74D', image: require('@/assets/images/menu/m6-3.png') },
};

const DEFAULT_IMAGE: FoodImageConfig = { emoji: '🍽️', bg: '#FAF7F2', accent: '#E8E2DA', image: require('@/assets/images/menu/m1-1.png') };

export function getSellerImage(id: string): FoodImageConfig {
  return SELLER_IMAGES[id] ?? DEFAULT_IMAGE;
}

export function getMenuImage(id: string): FoodImageConfig {
  return MENU_IMAGES[id] ?? DEFAULT_IMAGE;
}
