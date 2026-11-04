import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme-context';

const CIRCLE = 64;
const ACTIVE = 48;

function bottomGap(insetBottom: number) {
  return Math.max(insetBottom, 14) + 8;
}

/** İçeriğin alt barın altında kalmaması için gereken boşluk */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return CIRCLE + bottomGap(insets.bottom) + 16;
}

type Props = BottomTabBarProps & {
  /** İçeriğin üstünde yüzer. Kapalıyken alt barın kendi şeridi olur. */
  floating?: boolean;
};

/** Birbirine bağlı dört koyu daire; etkin sekmede limon iç daire. */
export function ChainTabBar({ state, descriptors, navigation, floating }: Props) {
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const current = state.routes[state.index];
  const currentStyle = current ? (descriptors[current.key].options.tabBarStyle as { display?: string } | undefined) : undefined;
  if (keyboard || currentStyle?.display === 'none') return null;

  // Sepet alt barda değil, sayfa üstündeki limon düğmede durur.
  const routes = state.routes.filter(r => {
    const o = descriptors[r.key].options;
    return r.name !== 'cart' && o.tabBarIcon && o.title;
  });

  return (
    <View
      pointerEvents="box-none"
      style={[s.wrap, floating ? s.floating : { backgroundColor: t.background }, { paddingBottom: bottomGap(insets.bottom) }]}
    >
      <View style={s.row} accessibilityRole="tablist">
        <View pointerEvents="none" style={[s.link, { backgroundColor: t.brand }]} />
        {routes.map(route => {
          const { options } = descriptors[route.key];
          const focused = current?.key === route.key;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable
              key={route.key}
              style={[s.circle, { backgroundColor: t.brand }]}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityLabel={options.title}
              accessibilityState={{ selected: focused }}
            >
              <View style={[s.inner, focused && { backgroundColor: t.accent }]}>
                {options.tabBarIcon?.({ focused, color: focused ? t.onAccent : t.onBrand, size: 22 })}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 34, paddingTop: 8 },
  floating: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row: { height: CIRCLE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 360, alignSelf: 'center' },
  link: { position: 'absolute', left: 20, right: 20, top: 12, height: 40 },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center' },
  inner: { width: ACTIVE, height: ACTIVE, borderRadius: ACTIVE / 2, alignItems: 'center', justifyContent: 'center' },
});
