import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from './Badge';
import { fonts } from '@/lib/fonts';
import { useTheme, type ThemeColors } from '@/lib/theme-context';

function useCardStyles() {
  const { colors: t } = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return { t, styles };
}

// ─── SellerCard ───────────────────────────────────────────────────────────────

type SellerCardProps = {
  id: string;
  name: string;
  bio?: string;
  emoji: string;
  bgColor: string;
  rating: number;
  ratingCount: number;
  district?: string;
  distance?: string;
  deliveryMin: number;
  isOpen: boolean;
  isApproved?: boolean;
  menuCount?: number;
  onPress: () => void;
};

export function SellerCard({
  name, bio, emoji, bgColor, rating, ratingCount,
  district, distance, deliveryMin, isOpen, isApproved, menuCount, onPress,
}: SellerCardProps) {
  const { t, styles } = useCardStyles();
  return (
    <Pressable style={styles.sellerCard} onPress={onPress} accessibilityRole="button">
      {/* Emoji */}
      <View style={[styles.sellerEmoji, { backgroundColor: bgColor }]}>
        <Text style={styles.sellerEmojiText}>{emoji}</Text>
      </View>

      {/* Info */}
      <View style={styles.sellerInfo}>
        <View style={styles.sellerTopRow}>
          <Text style={styles.sellerName} numberOfLines={1}>{name}</Text>
          <Badge label={isOpen ? 'Açık' : 'Kapalı'} variant={isOpen ? 'success' : 'muted'} dot />
        </View>
        {bio ? <Text style={styles.sellerBio} numberOfLines={2}>{bio}</Text> : null}
        <View style={styles.sellerMeta}>
          <View style={styles.sellerMetaItem}>
            <Ionicons name="star" size={11} color={t.textSecondary} />
            <Text style={styles.sellerMetaText}>{rating.toFixed(1)}</Text>
          </View>
          {distance ? <Text style={styles.sellerMetaText}>{distance}</Text> : null}
          {district ? (
            <View style={styles.sellerMetaItem}>
              <Ionicons name="location-outline" size={11} color={t.textSecondary} />
              <Text style={styles.sellerMetaText}>{district}</Text>
            </View>
          ) : null}
          <View style={styles.sellerMetaItem}>
            <Ionicons name="time-outline" size={11} color={t.textSecondary} />
            <Text style={styles.sellerMetaText}>{deliveryMin} dk</Text>
          </View>
          {menuCount !== undefined ? <Text style={styles.sellerMetaText}>{menuCount} ürün</Text> : null}
        </View>
        {isApproved ? (
          <View style={styles.approvedRow}>
            <Badge label="Onaylı Mutfak" variant="success" dot />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── MenuItemCard ─────────────────────────────────────────────────────────────

type MenuItemCardProps = {
  id: string;
  emoji: string;
  title: string;
  description?: string;
  priceCents: number;
  isAvailable: boolean;
  quantity: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
};

function priceTL(cents: number) {
  return `₺${(cents / 100).toFixed(2).replace('.', ',')}`;
}

export function MenuItemCard({
  emoji, title, description, priceCents, isAvailable, quantity, onAdd, onIncrement, onDecrement,
}: MenuItemCardProps) {
  const { t, styles } = useCardStyles();
  return (
    <View style={[styles.menuCard, !isAvailable && styles.menuCardInactive]}>
      <View style={styles.menuIcon}>
        <Text style={styles.menuIconText}>{emoji}</Text>
      </View>
      <View style={styles.menuInfo}>
        <Text style={styles.menuTitle}>{title}</Text>
        {description ? <Text style={styles.menuDesc} numberOfLines={2}>{description}</Text> : null}
        <Text style={styles.menuPrice}>{priceTL(priceCents)}</Text>
      </View>
      <View style={styles.menuQty}>
        {quantity === 0 ? (
          <Pressable
            style={[styles.addBtn, !isAvailable && styles.addBtnDisabled]}
            onPress={isAvailable ? onAdd : undefined}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isAvailable }}
          >
            <Ionicons name="add" size={16} color={t.onBrand} />
            <Text style={styles.addBtnText}>Ekle</Text>
          </Pressable>
        ) : (
          <View style={styles.qtyRow}>
            <Pressable style={styles.qtyBtn} onPress={onDecrement} hitSlop={8} accessibilityRole="button" accessibilityLabel="Azalt">
              <Ionicons name="remove" size={16} color={t.text} />
            </Pressable>
            <Text style={styles.qtyNum}>{quantity}</Text>
            <Pressable style={styles.qtyBtn} onPress={onIncrement} hitSlop={8} accessibilityRole="button" accessibilityLabel="Artır">
              <Ionicons name="add" size={16} color={t.text} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── OrderCard ───────────────────────────────────────────────────────────────

type OrderCardProps = {
  sellerName: string;
  sellerEmoji: string;
  sellerBg: string;
  statusLabel: string;
  statusVariant: 'success' | 'amber' | 'primary' | 'muted' | 'info';
  totalCents: number;
  timeLabel: string;
  itemsSummary: string;
  isExpanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
};

export function OrderCard({
  sellerName, sellerEmoji, sellerBg, statusLabel, statusVariant,
  totalCents, timeLabel, itemsSummary, isExpanded, onToggle, children,
}: OrderCardProps) {
  const { t, styles } = useCardStyles();
  return (
    <Pressable style={styles.orderCard} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: isExpanded }}>
      <View style={styles.orderTop}>
        <View style={[styles.orderEmoji, { backgroundColor: sellerBg }]}>
          <Text style={styles.orderEmojiText}>{sellerEmoji}</Text>
        </View>
        <View style={styles.orderInfo}>
          <Text style={styles.orderSeller} numberOfLines={1}>{sellerName}</Text>
          <Text style={styles.orderTime}>{timeLabel}</Text>
        </View>
        <View style={styles.orderRight}>
          <Badge label={statusLabel} variant={statusVariant} />
          <Text style={styles.orderTotal}>{priceTL(totalCents)}</Text>
        </View>
      </View>
      {!isExpanded ? (
        <Text style={styles.orderPreview} numberOfLines={1}>{itemsSummary}</Text>
      ) : null}
      {children}
      <View style={styles.expandHint}>
        <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={t.textSecondary} />
        <Text style={styles.expandHintText}>{isExpanded ? 'Kapat' : 'Detaylar'}</Text>
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (t: ThemeColors) => StyleSheet.create({
  // SellerCard
  sellerCard: {
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  sellerEmoji: {
    width: 68,
    height: 68,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sellerEmojiText: { fontFamily: fonts.regular, fontSize: 34 },
  sellerInfo: { flex: 1, gap: 4 },
  sellerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sellerName: { flex: 1, fontSize: 14, fontFamily: fonts.extrabold, color: t.text },
  sellerBio: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary, lineHeight: 17 },
  sellerMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10 },
  sellerMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sellerMetaText: { fontFamily: fonts.regular, fontSize: 11, color: t.textSecondary, lineHeight: 16 },
  approvedRow: { marginTop: 2 },

  // MenuItemCard
  menuCard: {
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuCardInactive: { opacity: 0.55 },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  menuIconText: { fontFamily: fonts.regular, fontSize: 24 },
  menuInfo: { flex: 1 },
  menuTitle: { fontSize: 14, fontFamily: fonts.bold, color: t.text, marginBottom: 2 },
  menuDesc: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary, lineHeight: 17, marginBottom: 4 },
  menuPrice: { fontSize: 15, fontFamily: fonts.extrabold, color: t.text },
  menuQty: { alignItems: 'flex-end', flexShrink: 0 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: t.primary,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 12,
  },
  addBtnDisabled: { backgroundColor: t.textMuted },
  addBtnText: { color: t.onBrand, fontSize: 13, fontFamily: fonts.bold },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: t.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyNum: { fontSize: 15, fontFamily: fonts.extrabold, color: t.text, minWidth: 18, textAlign: 'center' },

  // OrderCard
  orderCard: {
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  orderTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderEmoji: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  orderEmojiText: { fontFamily: fonts.regular, fontSize: 24 },
  orderInfo: { flex: 1 },
  orderSeller: { fontSize: 14, fontFamily: fonts.bold, color: t.text, marginBottom: 2 },
  orderTime: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  orderTotal: { fontSize: 14, fontFamily: fonts.extrabold, color: t.text },
  orderPreview: { fontFamily: fonts.regular, fontSize: 12, color: t.textSecondary },
  expandHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  expandHintText: { fontFamily: fonts.regular, fontSize: 11, color: t.textSecondary },
});
