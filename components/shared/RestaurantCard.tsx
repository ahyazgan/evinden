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
  /** Kartın neden önerildiği: "2 kez sipariş verdin" */
  note?: string;
  onPress: () => void;
};

/** Beyaz kart: üstte fotoğraf, altta karar için gereken bilgiler. */
export function RestaurantCard({ data, campaign, width, favorite, note, onPress }: Props) {
  const { colors: t } = useTheme();
  const free = data.deliveryFeeCents === 0;
  const inner = width ? width - 16 : undefined;

  return (
    <Pressable
      style={({ pressed }) => [s.card, { backgroundColor: t.surface }, width ? { width } : s.full, pressed && s.pressed]}
      onPress={onPress}
      accessibilityLabel={note ? `${data.name}, ${note}` : data.name}
    >
      <View style={[s.imageWrap, { backgroundColor: t.mint }]}>
        <FoodImage imageUrl={data.photo} height={inner ? Math.round(inner * 0.6) : 160} borderRadius={12} style={s.image} />
        {!data.open ? (
          <View style={s.closed}>
            <Text style={[s.closedText, { color: t.onBrand }]}>Şu an kapalı</Text>
          </View>
        ) : null}
        {campaign ? (
          <View style={[s.deal, { backgroundColor: t.accent }]}>
            <Text style={[s.dealText, { color: t.onAccent }]} numberOfLines={1}>{campaignLabel(campaign)}</Text>
          </View>
        ) : null}
        {favorite ? (
          <Pressable
            style={[s.fav, { backgroundColor: t.brand }]}
            onPress={favorite.onToggle}
            accessibilityRole="button"
            accessibilityLabel={favorite.active ? 'Favorilerden çıkar' : 'Favorilere ekle'}
          >
            <Ionicons name={favorite.active ? 'heart' : 'heart-outline'} size={18} color={favorite.active ? t.accent : t.onBrand} />
          </Pressable>
        ) : null}
      </View>

      <View style={s.topRow}>
        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{data.name}</Text>
        <View style={s.rating}>
          <Ionicons name="star" size={14} color={t.text} />
          {data.ratingCount > 0 ? (
            <Text style={[s.ratingNum, { color: t.text }]}>{data.ratingAvg.toFixed(1).replace('.', ',')}</Text>
          ) : (
            <Text style={[s.ratingNum, { color: t.text }]}>Yeni</Text>
          )}
        </View>
      </View>

      <Text style={[s.meta, { color: t.textSecondary }]} numberOfLines={1}>
        {data.timeMin}-{data.timeMax} dk
        {data.minOrderCents > 0 ? ` • Min. ${lira(data.minOrderCents)}` : ''}
        {data.deliveryFeeCents != null ? (free ? ' • Ücretsiz teslimat' : ` • Teslimat ${lira(data.deliveryFeeCents)}`) : ''}
      </Text>
      {note ? <Text style={[s.note, { color: t.text }]} numberOfLines={2}>{note}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, padding: 8, paddingBottom: 12 },
  full: { width: '100%' },
  pressed: { opacity: 0.85 },
  imageWrap: { borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%' },
  closed: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,26,22,0.6)', alignItems: 'center', justifyContent: 'center' },
  closedText: { fontSize: 14, fontFamily: fonts.bold },
  fav: { position: 'absolute', top: 6, right: 6, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  deal: { position: 'absolute', top: 8, left: 8, maxWidth: '70%', height: 28, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center' },
  dealText: { fontSize: 12, fontFamily: fonts.extrabold },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 9, paddingHorizontal: 4 },
  name: { flex: 1, fontSize: 15, fontFamily: fonts.bold },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingNum: { fontSize: 13, fontFamily: fonts.bold },
  meta: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 2, paddingHorizontal: 4 },
  note: { fontSize: 12, lineHeight: 17, fontFamily: fonts.semibold, marginTop: 4, paddingHorizontal: 4 },
});
