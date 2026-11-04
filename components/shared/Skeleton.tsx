import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

type SkeletonProps = {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export function SkeletonBox({ width, height, borderRadius = 8, style }: SkeletonProps) {
  const { colors: t } = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: t.divider, opacity },
        style,
      ]}
    />
  );
}

/** Skeleton that mimics a seller list card */
export function SellerCardSkeleton() {
  const { colors: t } = useTheme();
  return (
    <View style={[sk.card, { backgroundColor: t.surface }]}>
      <SkeletonBox width="100%" height={160} borderRadius={12} />
      <View style={sk.body}>
        <View style={sk.row}>
          <SkeletonBox width={160} height={16} borderRadius={6} />
          <SkeletonBox width={50} height={16} borderRadius={6} />
        </View>
        <SkeletonBox width="90%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

/** Skeleton for a horizontal featured card */
export function FeaturedCardSkeleton() {
  const { colors: t } = useTheme();
  return (
    <View style={[sk.featured, { backgroundColor: t.surface }]}>
      <SkeletonBox width="100%" height={90} borderRadius={12} />
      <View style={sk.featuredBody}>
        <SkeletonBox width="80%" height={12} borderRadius={4} />
        <SkeletonBox width="55%" height={10} borderRadius={4} />
      </View>
    </View>
  );
}

/** Skeleton row used in explore / favorites */
export function ListCardSkeleton() {
  const { colors: t } = useTheme();
  return (
    <View style={[sk.listCard, { backgroundColor: t.surface }]}>
      <SkeletonBox width={54} height={54} borderRadius={12} />
      <View style={sk.listBody}>
        <SkeletonBox width={140} height={14} borderRadius={4} />
        <SkeletonBox width="80%" height={12} borderRadius={4} />
        <View style={sk.tags}>
          <SkeletonBox width={50} height={16} borderRadius={6} />
          <SkeletonBox width={40} height={16} borderRadius={6} />
          <SkeletonBox width={50} height={16} borderRadius={6} />
        </View>
      </View>
    </View>
  );
}

/** Ana sayfanın yüklenme hâli: telefon düzenini ve koyu üst alanı taklit eder */
export function HomeScreenSkeleton() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const onDark = { backgroundColor: t.panel };

  return (
    <View style={sk.homeWrap} accessibilityLabel="Yükleniyor">
      {isDesktop ? null : (
        <View style={[sk.top, { backgroundColor: t.brand, paddingTop: Math.max(insets.top + 8, 16) }]}>
          <View style={sk.topRow}>
            <SkeletonBox width={110} height={26} borderRadius={6} style={onDark} />
            <SkeletonBox width={44} height={44} borderRadius={12} style={onDark} />
          </View>
          <SkeletonBox width={170} height={16} borderRadius={4} style={{ ...onDark, marginTop: 26, marginBottom: 14 }} />
          <SkeletonBox width="100%" height={44} borderRadius={12} style={onDark} />
        </View>
      )}

      <View style={[sk.quick, { backgroundColor: t.surface }]}>
        <View style={[sk.quickRow, { borderBottomColor: t.divider, borderBottomWidth: 1 }]}>
          <SkeletonBox width={20} height={20} borderRadius={10} />
          <SkeletonBox width={170} height={14} borderRadius={4} />
        </View>
        <View style={sk.quickRow}>
          <SkeletonBox width={20} height={20} borderRadius={10} />
          <SkeletonBox width={100} height={14} borderRadius={4} />
        </View>
      </View>

      <SkeletonBox width={120} height={18} borderRadius={4} style={sk.heading} />
      <View style={sk.catRow}>
        {[110, 90, 96, 90].map((w, i) => (
          <View key={i} style={[sk.catPill, { width: w, backgroundColor: t.surface }]}>
            <SkeletonBox width={36} height={36} borderRadius={18} />
            <SkeletonBox width={w - 66} height={12} borderRadius={4} />
          </View>
        ))}
      </View>

      <SkeletonBox width={170} height={18} borderRadius={4} style={sk.heading} />
      <View style={sk.dishRow}>
        {[0, 1].map(i => (
          <View key={i} style={sk.dish}>
            <FeaturedCardSkeleton />
          </View>
        ))}
      </View>

      <SkeletonBox width={140} height={18} borderRadius={4} style={sk.heading} />
      <SellerCardSkeleton />
    </View>
  );
}

const sk = StyleSheet.create({
  card: { borderRadius: 16, padding: 8, paddingBottom: 12, marginHorizontal: 16, marginBottom: 12 },
  body: { paddingHorizontal: 4, paddingTop: 10, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  tags: { flexDirection: 'row', gap: 6, marginTop: 2 },

  featured: { borderRadius: 16, padding: 10 },
  featuredBody: { paddingTop: 10, gap: 6 },

  listCard: { borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10 },
  listBody: { flex: 1, gap: 6 },

  homeWrap: { flex: 1, overflow: 'hidden' },
  top: { paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quick: { marginHorizontal: 16, marginTop: 12, borderRadius: 16, paddingHorizontal: 14 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },
  heading: { marginLeft: 16, marginTop: 26, marginBottom: 13 },
  catRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingLeft: 6, paddingRight: 14, borderRadius: 14, flexShrink: 0 },
  dishRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10 },
  dish: { flex: 1, minWidth: 0 },
});
