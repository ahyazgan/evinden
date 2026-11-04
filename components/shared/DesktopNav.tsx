import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LogoMark } from '@/components/shared/Logo';
import { fonts } from '@/lib/fonts';
import { NAV_HEIGHT, PAGE_WIDTH } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

/** Masaüstünde alt sekme çubuğunun yerini alan üst menü. Yalnızca simgesi olan sekmeleri gösterir. */
export function DesktopNav({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors: t, isDark } = useTheme();
  const routes = state.routes.filter(r => descriptors[r.key].options.tabBarIcon && descriptors[r.key].options.title);
  const first = routes[0];

  return (
    <View style={[s.bar, { backgroundColor: t.surface, borderBottomColor: t.surfaceBorder }]}>
      <View style={s.inner}>
        <Pressable
          style={s.brand}
          onPress={() => first && navigation.navigate(first.name, first.params)}
          accessibilityRole="link"
          accessibilityLabel="Evinden ana sayfa"
        >
          <LogoMark size={34} tone={isDark ? 'onBrand' : 'onLight'} steamColor={t.surface} />
          <Text style={[s.word, { color: t.heading }]}>evinden</Text>
        </Pressable>

        <View style={s.items}>
          {routes.map(route => {
            const { options } = descriptors[route.key];
            const focused = state.routes[state.index]?.key === route.key;
            const color = focused ? t.primary : t.textSecondary;
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            };
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={({ hovered }: any) => [s.item, hovered && { backgroundColor: t.chip }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
              >
                {options.tabBarIcon?.({ focused, color, size: 20 })}
                <Text style={[s.label, { color }, focused && s.labelOn]}>{options.title}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { height: NAV_HEIGHT, borderBottomWidth: 1, alignItems: 'center', justifyContent: 'center' },
  inner: { width: '100%', maxWidth: PAGE_WIDTH, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 24 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  word: { fontSize: 24, lineHeight: 30, fontFamily: fonts.display, letterSpacing: -0.7 },
  items: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 22 },
  label: { fontSize: 14, fontFamily: fonts.medium },
  labelOn: { fontFamily: fonts.bold },
});
