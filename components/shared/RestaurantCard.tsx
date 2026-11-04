import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FoodImage from '@/components/shared/FoodImage';
import type { CouponRow } from '@/lib/db';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';

export type RestaurantCardData = {
  name: string;
  photo: string | null;
  ratingAvg: number;
  ratingCount: number;
  typeLabel: string;
  timeMin: number;
  timeMax: number;
  deliveryFeeCents: number | null;
  minOrderCents: number;
  open: boolean;
};

const lira = (cents: number) => `₺${(cents / 100).toFixed(0)}`;

/** "%15 indirim: KOMSU15" */
export function campaignLabel(c: Pick<CouponRow, 'discount_type' | 'discount_value' | 'code'>): string {
  if (c.discount_type === 'free_delivery') return `Ücretsiz teslimat: ${c.code}`;
  const what = c.discount_type === 'percent' ? `%${c.discount_value} indirim` : `${lira(c.discount_value)} indirim`;
  return `${what}: ${c.code}`;
}

type Props = {
  data: RestaurantCardData;
  campaign?: CouponRow;
  width?: number;
  favorite?: { active: boolean; onToggle: () => void };
  onPress: () => void;
};

/** Yemek platformlarındaki restoran kartı: üstte fotoğraf, altta karar için gereken bilgiler. */
export function RestaurantCard({ data, campaign, width, favorite, onPress }: Props) {
  const { colors: t } = useTheme();
  const free = data.deliveryFeeCents === 0;

  return (
    <Pressable
      style={({ pressed }) => [width ? { width } : s.full, pressed && s.pressed]}
      onPress={onPress}
      accessibilityLabel={data.name}
    >
      <View style={[s.imageWrap, { backgroundColor: t.mint }]}>
        <FoodImage imageUrl={data.photo} height={width ? Math.round(width * 0.58) : 190} borderRadius={14} style={s.image} />
        {!data.open ? (
          <View style={s.closed}>
            <Text style={s.closedText}>Şu an kapalı</Text>
          </View>
        ) : null}
        {favorite ? (
          <Pressable style={s.fav} onPress={favorite.onToggle} accessibilityRole="button" accessibilityLabel={favorite.active ? 'Favorilerden çıkar' : 'Favorilere ekle'}>
            <Ionicons name={favorite.active ? 'heart' : 'heart-outline'} size={20} color={favorite.active ? '#CE3A1F' : '#151A16'} />
          </Pressable>
        ) : null}
      </View>

      <View style={s.topRow}>
        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{data.name}</Text>
        <View style={s.rating}>
          <Ionicons name="star" size={14} color="#E8A317" />
          {data.ratingCount > 0 ? (
            <>
              <Text style={[s.ratingNum, { color: t.text }]}>{data.ratingAvg.toFixed(1).replace('.', ',')}</Text>
              <Text style={[s.ratingCount, { color: t.textSecondary }]}>({data.ratingCount})</Text>
            </>
          ) : (
            <Text style={[s.ratingNum, { color: t.text }]}>Yeni</Text>
          )}
        </View>
      </View>

      <Text style={[s.meta, { color: t.textSecondary }]} numberOfLines={1}>
        {data.timeMin}-{data.timeMax} dk
        {data.minOrderCents > 0 ? ` • Min. ${lira(data.minOrderCents)}` : ' • Minimum yok'}
        {` • ${data.typeLabel}`}
      </Text>

      {data.deliveryFeeCents != null ? (
        <View style={s.deliveryRow}>
          <Ionicons name="bicycle-outline" size={15} color={free ? t.primary : t.textSecondary} />
          <Text style={[s.delivery, { color: free ? t.primary : t.textSecondary }, free && s.deliveryFree]}>
            {free ? 'Ücretsiz teslimat' : `Teslimat ${lira(data.deliveryFeeCents)}`}
          </Text>
        </View>
      ) : null}

      {campaign ? (
        <View style={s.deal}>
          <Ionicons name="pricetag" size={12} color="#CE3A1F" />
          <Text style={s.dealText} numberOfLines={1}>{campaignLabel(campaign)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  full: { width: '100%' },
  pressed: { opacity: 0.85 },
  imageWrap: { borderRadius: 14, overflow: 'hidden' },
  image: { width: '100%' },
  closed: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,26,22,0.55)', alignItems: 'center', justifyContent: 'center' },
  closedText: { color: '#fff', fontSize: 14, fontFamily: fonts.bold },
  fav: { position: 'absolute', top: 8, right: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  name: { flex: 1, fontSize: 15, fontFamily: fonts.bold },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingNum: { fontSize: 13, fontFamily: fonts.bold },
  ratingCount: { fontSize: 12, fontFamily: fonts.regular },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 2 },
  deliveryRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  delivery: { fontSize: 12, fontFamily: fonts.regular },
  deliveryFree: { fontFamily: fonts.semibold },
  deal: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 5, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: '#FBEDE9', maxWidth: '100%' },
  dealText: { flexShrink: 1, fontSize: 11, fontFamily: fonts.bold, color: '#CE3A1F' },
});
