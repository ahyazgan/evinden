import AsyncStorage from '@react-native-async-storage/async-storage';

const STOCK_KEY = '@evinden_stock';

// ─── Types ───────────────────────────────────────────────────────────────────

export type StockItem = {
  menuItemId: string;
  dailyLimit: number; // 0 = unlimited
  sold: number;
  resetDate: string; // YYYY-MM-DD, auto-resets daily
};

// ─── Storage ─────────────────────────────────────────────────────────────────

async function getAllStock(): Promise<StockItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STOCK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveAllStock(items: StockItem[]): Promise<void> {
  await AsyncStorage.setItem(STOCK_KEY, JSON.stringify(items));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function setDailyLimit(menuItemId: string, limit: number): Promise<void> {
  const all = await getAllStock();
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
  await saveAllStock(all);
}

export async function getStock(menuItemId: string): Promise<{ remaining: number; limit: number; soldOut: boolean } | null> {
  const all = await getAllStock();
  const today = new Date().toISOString().slice(0, 10);
  const item = all.find(s => s.menuItemId === menuItemId);
  if (!item || item.dailyLimit === 0) return null; // unlimited

  // Auto-reset if new day
  if (item.resetDate !== today) {
    item.sold = 0;
    item.resetDate = today;
    await saveAllStock(all);
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
  const all = await getAllStock();
  const today = new Date().toISOString().slice(0, 10);
  const item = all.find(s => s.menuItemId === menuItemId);
  if (!item || item.dailyLimit === 0) return true; // unlimited, always ok

  if (item.resetDate !== today) {
    item.sold = 0;
    item.resetDate = today;
  }

  if (item.sold + quantity > item.dailyLimit) return false; // not enough stock
  item.sold += quantity;
  await saveAllStock(all);
  return true;
}

export async function resetDailyStock(): Promise<void> {
  const all = await getAllStock();
  const today = new Date().toISOString().slice(0, 10);
  for (const item of all) {
    if (item.resetDate !== today) {
      item.sold = 0;
      item.resetDate = today;
    }
  }
  await saveAllStock(all);
}
