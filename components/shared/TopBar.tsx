import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '@/lib/cart-context';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

/** Üst alanın içindeki bileşenler koyu zeminde mi duruyor? */
const OnDark = createContext(false);

/** Limon sepet düğmesi: sayfa üstlerinde hep aynı yerde durur */
export function CartButton() {
  const { colors: t } = useTheme();
  const { totalItems } = useCart();
  const router = useRouter();
  return (
    <Pressable
      style={[s.cart, { backgroundColor: t.accent }]}
      onPress={() => router.push('/(customer)/cart' as any)}
      accessibilityRole="button"
      accessibilityLabel={totalItems > 0 ? `Sepet, ${totalItems} ürün` : 'Sepet'}
    >
      <Ionicons name="bag-outline" size={20} color={t.onAccent} />
      {totalItems > 0 ? <Text style={[s.cartText, { color: t.onAccent }]}>{totalItems > 99 ? '99+' : totalItems}</Text> : null}
    </Pressable>
  );
}

/** Geri düğmesi. Yanıt verirken zemine göre renk alır. */
export function BackButton({ onPress }: { onPress?: () => void }) {
  const { colors: t } = useTheme();
  const router = useRouter();
  const dark = useContext(OnDark);
  return (
    <Pressable
      style={[s.square, { backgroundColor: dark ? t.panel : t.surface }]}
      onPress={onPress ?? (() => router.back())}
      accessibilityRole="button"
      accessibilityLabel="Geri"
    >
      <Ionicons name="arrow-back" size={20} color={dark ? t.onBrand : t.text} />
    </Pressable>
  );
}

/** Üst alandaki kare simge düğmesi */
export function TopIconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors: t } = useTheme();
  const dark = useContext(OnDark);
  return (
    <Pressable
      style={[s.square, { backgroundColor: dark ? t.panel : t.surface }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={dark ? t.onBrand : t.text} />
    </Pressable>
  );
}

/** Arama kutusu. Üst alanın içindeyse koyu, dışındaysa beyaz görünür. */
export function SearchField({ value, onChangeText, accessibilityLabel = 'Ara', ...rest }: TextInputProps) {
  const { colors: t } = useTheme();
  const dark = useContext(OnDark);
  return (
    <View style={[s.search, { backgroundColor: dark ? t.panel : t.surface }]}>
      <Ionicons name="search" size={18} color={dark ? t.onBrandSoft : t.textSecondary} />
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        style={[s.searchInput, { color: dark ? t.onBrand : t.text }]}
        placeholderTextColor={dark ? t.onBrandSoft : t.textMuted}
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel}
      />
      {value ? (
        <Pressable onPress={() => onChangeText?.('')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
          <Ionicons name="close-circle" size={20} color={dark ? t.onBrandSoft : t.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

type Props = {
  title?: string;
  subtitle?: string;
  /** Başlığın yerine özel içerik (ör. logo) */
  leading?: ReactNode;
  onBack?: () => void;
  /** Geri düğmesi gösterilsin */
  back?: boolean;
  /** Limon sepet düğmesi gösterilsin */
  cart?: boolean;
  right?: ReactNode;
  /** Başlık satırının altındaki içerik: arama, kategori sekmeleri */
  children?: ReactNode;
};

/**
 * Sayfaların üst alanı. Telefonda koyu ve alttan yuvarlak, masaüstünde üst menü zaten
 * koyu olduğu için sayfa zemininde sade bir başlık olur.
 */
export function TopBar({ title, subtitle, leading, onBack, back, cart, right, children }: Props) {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();
  const dark = !isDesktop;
  const showBack = back || !!onBack;

  return (
    <OnDark.Provider value={dark}>
      <View
        style={[
          s.wrap,
          dark
            ? { backgroundColor: t.brand, paddingTop: Math.max(insets.top + 8, 16), paddingBottom: 16 }
            : { paddingTop: 16, paddingBottom: 8 },
        ]}
      >
        <View style={s.row}>
          {showBack ? <BackButton onPress={onBack} /> : null}
          <View style={s.titleWrap}>
            {leading}
            {title ? (
              <Text style={[s.title, { color: dark ? t.onBrand : t.heading }]} numberOfLines={1} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text style={[s.subtitle, { color: dark ? t.onBrandSoft : t.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
            ) : null}
          </View>
          {right}
          {cart && !isDesktop ? <CartButton /> : null}
        </View>
        {children ? <View style={s.body}>{children}</View> : null}
      </View>
    </OnDark.Provider>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 24, lineHeight: 30, fontFamily: fonts.display, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, marginTop: 1 },
  body: { marginTop: 12 },
  square: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cart: { minWidth: 44, height: 44, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cartText: { fontSize: 15, fontFamily: fonts.extrabold },
  search: { height: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.regular, padding: 0 },
});
