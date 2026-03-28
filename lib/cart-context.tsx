import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type CartItem = {
  menuItemId: string;
  title: string;
  priceCents: number;
  quantity: number;
};

type CartContextValue = {
  sellerId: string | null;
  items: CartItem[];
  totalItems: number;
  totalCents: number;
  /** Farklı satıcı varsa true döner ve ekleme yapmaz — kullanıcı onayı sonrası forceAdd ile yeniden çağrılabilir */
  addItem: (sellerId: string, item: Omit<CartItem, 'quantity'>) => boolean;
  forceAdd: (sellerId: string, item: Omit<CartItem, 'quantity'>) => void;
  incrementItem: (menuItemId: string) => void;
  decrementItem: (menuItemId: string) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const sellerIdRef = useRef<string | null>(null);

  const _upsertItem = useCallback((item: Omit<CartItem, 'quantity'>) => {
    setItems(prev => {
      const existing = prev.find(i => i.menuItemId === item.menuItemId);
      if (existing) {
        return prev.map(i =>
          i.menuItemId === item.menuItemId ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  /** Farklı satıcı çakışması varsa ekleme yapılmaz ve true yerine false döner */
  const addItem = useCallback(
    (newSellerId: string, item: Omit<CartItem, 'quantity'>): boolean => {
      if (sellerIdRef.current && sellerIdRef.current !== newSellerId) {
        return false; // çakışma — kullanıcı onayı gerekli
      }
      sellerIdRef.current = newSellerId;
      setSellerId(newSellerId);
      _upsertItem(item);
      return true;
    },
    [_upsertItem],
  );

  /** Sepeti temizleyip yeni satıcıdan ekler (kullanıcı onayı sonrası) */
  const forceAdd = useCallback(
    (newSellerId: string, item: Omit<CartItem, 'quantity'>) => {
      sellerIdRef.current = newSellerId;
      setSellerId(newSellerId);
      setItems([{ ...item, quantity: 1 }]);
    },
    [],
  );

  const incrementItem = useCallback((menuItemId: string) => {
    setItems(prev =>
      prev.map(i => (i.menuItemId === menuItemId ? { ...i, quantity: i.quantity + 1 } : i)),
    );
  }, []);

  const decrementItem = useCallback((menuItemId: string) => {
    setItems(prev => {
      const updated = prev.map(i =>
        i.menuItemId === menuItemId ? { ...i, quantity: i.quantity - 1 } : i,
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
