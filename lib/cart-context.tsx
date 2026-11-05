import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { track } from './analytics';

export type CartItem = {
  /** Aynı ürünün farklı seçimlerini (varyant/porsiyon/ekstra) ayıran anahtar — bkz. buildLineKey */
  lineKey: string;
  menuItemId: string;
  title: string;
  /** Sepette gösterilen ürün fotoğrafı */
  imageUrl?: string | null;
  /** Yalnızca ekranda gösterim içindir; sipariş tutarını sunucu menüden yeniden hesaplar. */
  priceCents: number;
  quantity: number;
  variantId?: string | null;
  portionId?: string | null;
  extraIds?: string[];
  optionIds?: string[];
};

/** Sepete eklerken verilen alanlar: lineKey ve adet bağlam tarafından eklenir. */
export type CartItemInput = Omit<CartItem, 'quantity' | 'lineKey'>;

export function buildLineKey(i: Pick<CartItem, 'menuItemId' | 'variantId' | 'portionId' | 'extraIds' | 'optionIds'>): string {
  return [
    i.menuItemId,
    i.variantId ?? '',
    i.portionId ?? '',
    [...(i.extraIds ?? [])].sort().join(','),
    [...(i.optionIds ?? [])].sort().join(','),
  ].join('|');
}

type CartContextValue = {
  sellerId: string | null;
  items: CartItem[];
  totalItems: number;
  totalCents: number;
  /** Farklı satıcı varsa true döner ve ekleme yapmaz — kullanıcı onayı sonrası forceAdd ile yeniden çağrılabilir */
  addItem: (sellerId: string, item: CartItemInput, qty?: number) => boolean;
  forceAdd: (sellerId: string, item: CartItemInput, qty?: number) => void;
  incrementItem: (lineKey: string) => void;
  decrementItem: (lineKey: string) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const sellerIdRef = useRef<string | null>(null);

  const _upsertItem = useCallback((item: CartItemInput, qty: number) => {
    const lineKey = buildLineKey(item);
    setItems(prev => {
      const existing = prev.find(i => i.lineKey === lineKey);
      if (existing) {
        return prev.map(i => (i.lineKey === lineKey ? { ...i, quantity: i.quantity + qty } : i));
      }
      return [...prev, { ...item, lineKey, quantity: qty }];
    });
  }, []);

  /** Farklı satıcı çakışması varsa ekleme yapılmaz ve true yerine false döner */
  const addItem = useCallback(
    (newSellerId: string, item: CartItemInput, qty = 1): boolean => {
      if (sellerIdRef.current && sellerIdRef.current !== newSellerId) {
        return false; // çakışma — kullanıcı onayı gerekli
      }
      sellerIdRef.current = newSellerId;
      setSellerId(newSellerId);
      _upsertItem(item, qty);
      track('add_to_cart', { seller_id: newSellerId });
      return true;
    },
    [_upsertItem],
  );

  /** Sepeti temizleyip yeni satıcıdan ekler (kullanıcı onayı sonrası) */
  const forceAdd = useCallback(
    (newSellerId: string, item: CartItemInput, qty = 1) => {
      sellerIdRef.current = newSellerId;
      setSellerId(newSellerId);
      setItems([{ ...item, lineKey: buildLineKey(item), quantity: qty }]);
      track('add_to_cart', { seller_id: newSellerId });
    },
    [],
  );

  const incrementItem = useCallback((lineKey: string) => {
    setItems(prev =>
      prev.map(i => (i.lineKey === lineKey ? { ...i, quantity: i.quantity + 1 } : i)),
    );
  }, []);

  const decrementItem = useCallback((lineKey: string) => {
    setItems(prev => {
      const updated = prev.map(i =>
        i.lineKey === lineKey ? { ...i, quantity: i.quantity - 1 } : i,
      );
      const filtered = updated.filter(i => i.quantity > 0);
      if (filtered.length === 0) {
        sellerIdRef.current = null;
        setSellerId(null);
      }
      return filtered;
    });
  }, []);

  const clearCart = useCallback(() => {
    sellerIdRef.current = null;
    setSellerId(null);
    setItems([]);
  }, []);

  const totalItems = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);
  const totalCents = useMemo(
    () => items.reduce((s, i) => s + i.priceCents * i.quantity, 0),
    [items],
  );

  const value = useMemo(
    () => ({
      sellerId,
      items,
      totalItems,
      totalCents,
      addItem,
      forceAdd,
      incrementItem,
      decrementItem,
      clearCart,
    }),
    [sellerId, items, totalItems, totalCents, addItem, forceAdd, incrementItem, decrementItem, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart yalnızca CartProvider içinde kullanılabilir');
  return ctx;
}
