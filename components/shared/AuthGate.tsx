import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/shared/Logo';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/lib/auth-context';
import { fonts } from '@/lib/fonts';
import { useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

export function AuthGate() {
  const { session, profile, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const navState = useRootNavigationState();

  useEffect(() => {
    if (loading || !navState?.key) return;

    const seg0 = segments[0];
    const seg1 = segments.at(1);
    const inAuth = seg0 === '(auth)';
    const inCustomer = seg0 === '(customer)';
    const inSeller = seg0 === 'restoran';

    const isAwaiting = inAuth && seg1 === 'awaiting-approval';

    // No session → login
    if (!session) {
      if (!inAuth || isAwaiting) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // Session but no profile shouldn't happen in demo, but safety net
    if (!profile) {
      if (!inAuth) {
        router.replace('/(auth)/register');
      }
      return;
    }

    // Buyer → customer area
    if (profile.role === 'buyer') {
      if (inAuth || inSeller) {
        router.replace('/(customer)');
      }
      return;
    }

    // Seller
    if (profile.role === 'seller') {
      if (profile.is_approved) {
        if (inAuth || (!inSeller && !inCustomer)) {
          router.replace('/restoran/dashboard');
        }
      } else if (!isAwaiting) {
        router.replace('/(auth)/awaiting-approval');
      }
    }
  }, [loading, session, profile, segments, navState?.key, router]);

  return null;
}

// ─── Giriş ekranlarının ortak düzeni ──────────────────────────────────────────

/** Üst alanın güvenli alan dahil yüksekliği */
const TOP_HEIGHT = 236;
/** Beyaz yaprağın üst alana bindiği miktar */
const SHEET_OVERLAP = 24;

type ShellProps = {
  title: string;
  titleSize?: number;
  subtitle?: string;
  /** Verilirse koyu alanda geri düğmesi görünür */
  onBack?: () => void;
  /** Geri düğmesi yoksa logo varsayılan olarak görünür */
  logo?: boolean;
  children: ReactNode;
};

/**
 * Koyu üst alan ve üstüne binen beyaz yaprak. Telefonda üst alan sabit kalır, yaprak kayar.
 * Masaüstünde koyu alan sayfaya yayılmasın diye ikisi birlikte ortalanmış bir kart olur.
 */
export function AuthShell({ title, titleSize = 34, subtitle, onBack, logo = !onBack, children }: ShellProps) {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  const insets = useSafeAreaInsets();

  const head = (
    <View
      style={[
        sh.top,
        { backgroundColor: t.brand },
        isDesktop ? sh.topDesktop : { minHeight: TOP_HEIGHT, paddingTop: Math.max(insets.top + 8, 20) },
      ]}
    >
      <View style={sh.topRow}>
        {onBack ? (
          <Pressable
            style={[sh.back, { backgroundColor: t.panel }]}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Geri"
          >
            <Ionicons name="arrow-back" size={20} color={t.onBrand} />
          </Pressable>
        ) : null}
        {logo ? <Logo size={26} tone="onBrand" inline /> : null}
      </View>
      <Text
        accessibilityRole="header"
        style={[
          sh.title,
          { color: t.accent, fontSize: titleSize, lineHeight: Math.round(titleSize * 1.1), marginTop: onBack ? 18 : 22 },
        ]}
      >
        {title}
      </Text>
      {subtitle ? <Text style={[sh.subtitle, { color: t.onBrand }]}>{subtitle}</Text> : null}
    </View>
  );

  if (isDesktop) {
    return (
      <ScrollView
        style={[sh.flex, { backgroundColor: t.background }]}
        contentContainerStyle={sh.desktopScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[sh.card, { backgroundColor: t.surface }]}>
          {head}
          <View style={[sh.sheetTop, sh.sheetBody, { backgroundColor: t.surface }]}>{children}</View>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={[sh.flex, { backgroundColor: t.brand }]}>
      {head}
      <KeyboardAvoidingView
        style={[sh.flex, sh.sheetTop, sh.clip, { backgroundColor: t.surface }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[sh.sheetBody, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Google ve Apple düğmeleri. Apple düğmesi platform kuralı gereği siyahtır. */
export function AuthSocialButtons({
  onGoogle,
  onApple,
  busy,
  disabled,
}: {
  onGoogle: () => void;
  onApple: () => void;
  busy: 'google' | 'apple' | null;
  disabled: boolean;
}) {
  const { colors: t } = useTheme();
  return (
    <View style={sh.socialRow}>
      <Pressable
        style={[sh.social, { backgroundColor: t.surface, borderColor: t.surfaceBorder, borderWidth: 1 }, disabled && sh.dimmed]}
        onPress={onGoogle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Google ile devam et"
        accessibilityState={{ disabled, busy: busy === 'google' }}
      >
        {busy === 'google' ? (
          <ActivityIndicator size="small" color={t.text} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color={t.text} />
            <Text style={[sh.socialText, { color: t.text }]}>Google</Text>
          </>
        )}
      </Pressable>
      <Pressable
        style={[sh.social, sh.apple, disabled && sh.dimmed]}
        onPress={onApple}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Apple ile devam et"
        accessibilityState={{ disabled, busy: busy === 'apple' }}
      >
        {busy === 'apple' ? (
          <ActivityIndicator size="small" color={t.onBrand} />
        ) : (
          <>
            <Ionicons name="logo-apple" size={20} color={t.onBrand} />
            <Text style={[sh.socialText, { color: t.onBrand }]}>Apple</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

export function AuthDivider({ label = 'veya e-posta ile' }: { label?: string }) {
  const { colors: t } = useTheme();
  return (
    <View style={sh.dividerRow}>
      <View style={[sh.dividerLine, { backgroundColor: t.divider }]} />
      <Text style={[sh.dividerText, { color: t.textSecondary }]}>{label}</Text>
      <View style={[sh.dividerLine, { backgroundColor: t.divider }]} />
    </View>
  );
}

/** Göster/gizle düğmeli şifre alanı. Input sağ tarafa içerik almadığı için düğme üstüne oturur. */
export function AuthPasswordField({
  label,
  visible,
  onToggle,
  ...rest
}: TextInputProps & { label: string; visible: boolean; onToggle: () => void }) {
  const { colors: t } = useTheme();
  return (
    <View>
      <Input label={label} accessibilityLabel={label} secureTextEntry={!visible} style={sh.passwordInput} {...rest} />
      <Pressable
        style={sh.eye}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Şifreyi gizle' : 'Şifreyi göster'}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.textMuted} />
      </Pressable>
    </View>
  );
}

export function AuthError({ message }: { message: string }) {
  const { colors: t } = useTheme();
  return (
    <Text style={[sh.error, { color: t.danger }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

/** Yaprağın başındaki açıklama satırı */
export function AuthLead({ children }: { children: ReactNode }) {
  const { colors: t } = useTheme();
  return <Text style={[sh.lead, { color: t.textSecondary }]}>{children}</Text>;
}

const sh = StyleSheet.create({
  flex: { flex: 1 },
  clip: { overflow: 'hidden' },

  top: { paddingHorizontal: 20, paddingBottom: SHEET_OVERLAP + 12 },
  topDesktop: { paddingTop: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, letterSpacing: -0.6 },
  subtitle: { marginTop: 8, fontSize: 14, lineHeight: 20, fontFamily: fonts.regular },

  sheetTop: { marginTop: -SHEET_OVERLAP, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetBody: { paddingTop: 22, paddingHorizontal: 20, paddingBottom: 24, gap: 14 },

  desktopScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  card: { borderRadius: 24, overflow: 'hidden' },

  socialRow: { flexDirection: 'row', gap: 8 },
  social: { flex: 1, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  apple: { backgroundColor: '#000000' },
  socialText: { fontSize: 14, fontFamily: fonts.semibold },
  dimmed: { opacity: 0.6 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontFamily: fonts.regular },

  passwordInput: { paddingRight: 32 },
  eye: { position: 'absolute', right: 0, bottom: 0, width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },

  error: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold },
  lead: { fontSize: 15, lineHeight: 22, fontFamily: fonts.regular },
});
