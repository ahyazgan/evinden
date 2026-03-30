import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const STOCK_KEY = '@evinden_stock';

// ─── Types ───────────────────────────────────────────────────────────────────

export type StockItem = {
  menuItemId: string;
  dailyLimit: number;
  sold: number;
  resetDate: string;
};

// ─── Supabase-backed stock ──────────────────────────────────────────────────

export async function setDailyLimit(menuItemId: string, limit: number): Promise<void> {
  // Try Supabase first
  try {
    await supabase
      .from('menu_items')
      .update({ daily_limit: limit, updated_at: new Date().toISOString() })
      .eq('id', menuItemId);
    return;
  } catch {}

  // Fallback to AsyncStorage
  const all = await getAllStockLocal();
  const today = new Date().toISOString().slice(0, 10);
  const idx = all.findIndex(s => s.menuItemId === menuItemId);
  if (idx >= 0) {
    all[idx].dailyLimit = limit;
    if (all[idx].resetDate !== today) {
      all[idx].sold = 0;
      all[idx].resetDate = today;
    }
  } else {
    all.push({ menuItemId, dailyLimit: limit, sold: 0, resetDate: today });
  }
  await saveAllStockLocal(all);
}

export async function getStock(menuItemId: string): Promise<{ remaining: number; limit: number; soldOut: boolean } | null> {
  const today = new Date().toISOString().slice(0, 10);

  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('daily_limit, sold_today, stock_reset_date')
      .eq('id', menuItemId)
      .single();
    if (!error && data && data.daily_limit > 0) {
      const sold = data.stock_reset_date === today ? (data.sold_today ?? 0) : 0;
      const remaining = Math.max(data.daily_limit - sold, 0);
      return { remaining, limit: data.daily_limit, soldOut: remaining === 0 };
    }
    if (!error && data && data.daily_limit === 0) return null; // unlimited
  } catch {}

  // Fallback to AsyncStorage
  const all = await getAllStockLocal();
  const item = all.find(s => s.menuItemId === menuItemId);
  if (!item || item.dailyLimit === 0) return null;
  if (item.resetDate !== today) {
    item.sold = 0;
    item.resetDate = today;
    await saveAllStockLocal(all);
  }
  const remaining = Math.max(item.dailyLimit - item.sold, 0);
  return { remaining, limit: item.dailyLimit, soldOut: remaining === 0 };
}

export async function getSellerStock(menuItemIds: string[]): Promise<Record<string, { remaining: number; limit: number; soldOut: boolean }>> {
  const result: Record<string, { remaining: number; limit: number; soldOut: boolean }> = {};
  for (const id of menuItemIds) {
    const stock = await getStock(id);
    if (stock) result[id] = stock;
  }
  return result;
}

export async function recordSale(menuItemId: string, quantity: number): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);

  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('daily_limit, sold_today, stock_reset_date')
      .eq('id', menuItemId)
      .single();

    if (!error && data) {
      if (data.daily_limit === 0) return true; // unlimited
      let soldToday = data.stock_reset_date === today ? (data.sold_today ?? 0) : 0;
      if (soldToday + quantity > data.daily_limit) return false;

      await supabase
        .from('menu_items')
        .update({ sold_today: soldToday + quantity, stock_reset_date: today, updated_at: new Date().toISOString() })
        .eq('id', menuItemId);
      return true;
    }
  } catch {}

  // Fallback to AsyncStorage
  const all = await getAllStockLocal();
  const item = all.find(s => s.menuItemId === menuItemId);
  if (!item || item.dailyLimit === 0) return true;
  if (item.resetDate !== today) {
    item.sold = 0;
    item.resetDate = today;
  }
  if (item.sold + quantity > item.dailyLimit) return false;
  item.sold += quantity;
  await saveAllStockLocal(all);
  return true;
}

export async function resetDailyStock(): Promise<void> {
  // Supabase auto-resets via stock_reset_date check
  // Just reset local fallback
  const all = await getAllStockLocal();
  const today = new Date().toISOString().slice(0, 10);
  for (const item of all) {
    if (item.resetDate !== today) {
      item.sold = 0;
      item.resetDate = today;
    }
  }
  await saveAllStockLocal(all);
}

// ─── Local Fallback ─────────────────────────────────────────────────────────

async function getAllStockLocal(): Promise<StockItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STOCK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveAllStockLocal(items: StockItem[]): Promise<void> {
  await AsyncStorage.setItem(STOCK_KEY, JSON.stringify(items));
}
