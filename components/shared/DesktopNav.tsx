import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BrandWord, LogoMark } from '@/components/shared/Logo';
import { useCart } from '@/lib/cart-context';
import { fonts } from '@/lib/fonts';
import { NAV_HEIGHT, PAGE_WIDTH } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

/** Masaüstünde alt barın yerini alan koyu üst menü. Sepet sağda limon düğme olur. */
export function DesktopNav({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors: t } = useTheme();
  const { totalItems } = useCart();
  const routes = state.routes.filter(r => descriptors[r.key].options.tabBarIcon && descriptors[r.key].options.title);
  const items = routes.filter(r => r.name !== 'cart');
  const cart = routes.find(r => r.name === 'cart');
  const first = items[0];
  const go = (route: (typeof routes)[number]) => {
    const focused = state.routes[state.index]?.key === route.key;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  return (
    <View style={[s.bar, { backgroundColor: t.brand }]}>
      <View style={s.inner}>
        <Pressable
          style={s.brand}
          onPress={() => first && navigation.navigate(first.name, first.params)}
          accessibilityRole="link"
          accessibilityLabel="Afiyetli ana sayfa"
        >
          <LogoMark size={30} tone="onBrand" />
          <Text style={[s.word, { color: t.onBrand }]}><BrandWord fontSize={24} /></Text>
        </Pressable>

        <View style={s.right}>
          <View style={s.items}>
            {items.map(route => {
              const { options } = descriptors[route.key];
              const focused = state.routes[state.index]?.key === route.key;
              return (
                <Pressable
                  key={route.key}
                  onPress={() => go(route)}
                  style={({ hovered }: any) => [s.item, hovered && { backgroundColor: t.panel }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: focused }}
                >
                  <Text style={[s.label, { color: focused ? t.accent : t.onBrand }, focused && s.labelOn]}>{options.title}</Text>
                </Pressable>
              );
            })}
          </View>
          {cart ? (
            <Pressable
              style={[s.cart, { backgroundColor: t.accent }]}
              onPress={() => go(cart)}
              accessibilityRole="button"
              accessibilityLabel={totalItems > 0 ? `Sepet, ${totalItems} ürün` : 'Sepet'}
            >
              <Ionicons name="bag-outline" size={20} color={t.onAccent} />
              {totalItems > 0 ? <Text style={[s.cartText, { color: t.onAccent }]}>{totalItems > 99 ? '99+' : totalItems}</Text> : null}
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { height: NAV_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  inner: { width: '100%', maxWidth: PAGE_WIDTH, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 24 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  word: { fontSize: 24, lineHeight: 30, fontFamily: fonts.display, letterSpacing: -0.7 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  items: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  item: { justifyContent: 'center', height: 44, paddingHorizontal: 12, borderRadius: 10 },
  label: { fontSize: 14, fontFamily: fonts.medium },
  labelOn: { fontFamily: fonts.extrabold },
  cart: { minWidth: 44, height: 44, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cartText: { fontSize: 15, fontFamily: fonts.extrabold },
});
