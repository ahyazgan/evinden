import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/theme';
import { Badge } from './Badge';
import { fonts } from '@/lib/fonts';

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
  return (
    <Pressable style={styles.sellerCard} onPress={onPress}>
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
        <Text style={styles.sellerMetaLine} numberOfLines={1}>
          {'⭐ ' + rating.toFixed(1)}
          {distance ? '  ·  ' + distance : ''}
          {district ? '  ·  📍 ' + district : ''}
          {'  ·  🕐 ' + deliveryMin + ' dk'}
          {menuCount !== undefined ? '  ·  ' + menuCount + ' ürün' : ''}
        </Text>
        {isApproved ? (
          <View style={styles.approvedRow}>
            <Badge label="✓ Onaylı Mutfak" variant="success" />
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
          >
            <Text style={styles.addBtnText}>+ Ekle</Text>
          </Pressable>
        ) : (
          <View style={styles.qtyRow}>
            <Pressable style={styles.qtyBtn} onPress={onDecrement} hitSlop={8}>
              <Text style={styles.qtyBtnText}>−</Text>
            </Pressable>
            <Text style={styles.qtyNum}>{quantity}</Text>
            <Pressable style={styles.qtyBtn} onPress={onIncrement} hitSlop={8}>
              <Text style={styles.qtyBtnText}>+</Text>
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
  return (
    <Pressable style={styles.orderCard} onPress={onToggle}>
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
      <Text style={styles.expandHint}>{isExpanded ? '▲ Kapat' : '▼ Detaylar'}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // SellerCard
  sellerCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E3E6DE',
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
  sellerName: { flex: 1, fontSize: 14, fontFamily: fonts.extrabold, color: '#151A16' },
  sellerBio: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 17 },
  sellerMetaLine: { fontFamily: fonts.regular, fontSize: 11, color: '#6B766F', lineHeight: 16 },
  approvedRow: { marginTop: 2 },

  // MenuItemCard
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E3E6DE',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuCardInactive: { opacity: 0.55 },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FAF8F2',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#E3E6DE',
  },
  menuIconText: { fontFamily: fonts.regular, fontSize: 24 },
  menuInfo: { flex: 1 },
  menuTitle: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16', marginBottom: 2 },
  menuDesc: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F', lineHeight: 17, marginBottom: 4 },
  menuPrice: { fontSize: 15, fontFamily: fonts.extrabold, color: colors.primary },
  menuQty: { alignItems: 'flex-end', flexShrink: 0 },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnDisabled: { backgroundColor: '#E0D8D0' },
  addBtnText: { color: '#fff', fontSize: 13, fontFamily: fonts.bold },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#EFF2EA',
    borderWidth: 1,
    borderColor: '#E3E6DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 17, fontFamily: fonts.bold, color: '#151A16', lineHeight: 20 },
  qtyNum: { fontSize: 15, fontFamily: fonts.extrabold, color: '#151A16', minWidth: 18, textAlign: 'center' },

  // OrderCard
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E6DE',
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
  orderSeller: { fontSize: 14, fontFamily: fonts.bold, color: '#151A16', marginBottom: 2 },
  orderTime: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  orderTotal: { fontSize: 14, fontFamily: fonts.extrabold, color: colors.primary },
  orderPreview: { fontFamily: fonts.regular, fontSize: 12, color: '#6B766F' },
  expandHint: { fontFamily: fonts.regular, fontSize: 11, color: '#A3ACA5', textAlign: 'center' },
});
