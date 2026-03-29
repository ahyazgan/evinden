import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';

type SkeletonProps = {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export function SkeletonBox({ width, height, borderRadius = 8, style }: SkeletonProps) {
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
        { width, height, borderRadius, backgroundColor: '#E8E2DA', opacity },
        style,
      ]}
    />
  );
}

/** Skeleton that mimics a seller list card */
export function SellerCardSkeleton() {
  return (
    <View style={sk.card}>
      <SkeletonBox width="100%" height={120} borderRadius={0} />
      <View style={sk.body}>
        <View style={sk.row}>
          <SkeletonBox width={160} height={16} borderRadius={6} />
          <SkeletonBox width={50} height={16} borderRadius={6} />
        </View>
        <SkeletonBox width="90%" height={12} borderRadius={4} style={{ marginTop: 8 }} />
        <View style={sk.tags}>
          <SkeletonBox width={60} height={20} borderRadius={8} />
          <SkeletonBox width={70} height={20} borderRadius={8} />
          <SkeletonBox width={50} height={20} borderRadius={8} />
        </View>
      </View>
    </View>
  );
}

/** Skeleton for a horizontal featured card */
export function FeaturedCardSkeleton() {
  return (
    <View style={sk.featured}>
      <SkeletonBox width={140} height={90} borderRadius={0} />
      <View style={{ padding: 10, gap: 6 }}>
        <SkeletonBox width={100} height={12} borderRadius={4} />
        <SkeletonBox width={70} height={10} borderRadius={4} />
      </View>
    </View>
  );
}

/** Skeleton row used in explore / favorites */
export function ListCardSkeleton() {
  return (
    <View style={sk.listCard}>
      <SkeletonBox width={54} height={54} borderRadius={14} />
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonBox width={140} height={14} borderRadius={4} />
        <SkeletonBox width="80%" height={12} borderRadius={4} />
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
          <SkeletonBox width={50} height={16} borderRadius={6} />
          <SkeletonBox width={40} height={16} borderRadius={6} />
          <SkeletonBox width={50} height={16} borderRadius={6} />
        </View>
      </View>
    </View>
  );
}

/** Full home screen skeleton layout */
export function HomeScreenSkeleton() {
  return (
    <View style={sk.homeWrap}>
      {/* Banner skeleton */}
      <SkeletonBox width="100%" height={130} borderRadius={18} style={{ marginHorizontal: 16 }} />
      {/* Category pills */}
      <View style={sk.catRow}>
        {[80, 90, 60, 70, 80].map((w, i) => (
          <SkeletonBox key={i} width={w} height={36} borderRadius={24} />
        ))}
      </View>
      {/* Featured section */}
      <SkeletonBox width={140} height={16} borderRadius={4} style={{ marginLeft: 16, marginBottom: 12 }} />
      <View style={sk.featuredRow}>
        {[0, 1, 2].map(i => <FeaturedCardSkeleton key={i} />)}
      </View>
      {/* Seller list */}
      <SkeletonBox width={160} height={16} borderRadius={4} style={{ marginLeft: 16, marginBottom: 12, marginTop: 8 }} />
      {[0, 1].map(i => <SellerCardSkeleton key={i} />)}
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F0ECE6',
    marginHorizontal: 16,
    marginBottom: 14,
  },
  body: { padding: 14, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  tags: { flexDirection: 'row', gap: 6, marginTop: 8 },

  featured: {
    width: 140,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F0ECE6',
  },

  listCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E2',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
  },

  homeWrap: { paddingTop: 16, gap: 16 },
  catRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  featuredRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12 },
});
