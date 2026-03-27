import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function AwaitingApprovalScreen() {
  const { refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);

  const onRefresh = async () => {
    setLoading(true);
    await refreshProfile();
    setLoading(false);
  };

  const onSignOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.heroEmoji} accessibilityLabel="Onay bekleniyor">
          ⏳
        </Text>
        <Text style={styles.title}>Onay bekleniyor</Text>
        <Text style={styles.body}>
          Satıcı hesabınız yönetici onayından sonra aktif olacaktır. Onaylandığında buradan otomatik
          olarak panele yönlendirileceksiniz.
        </Text>

        <Pressable
          style={[styles.primaryBtn, loading && styles.btnDisabled]}
          onPress={onRefresh}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Durumu yenile</Text>
          )}
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={onSignOut} disabled={loading}>
          <Text style={styles.secondaryBtnText}>Çıkış yap</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroEmoji: {
    fontSize: 72,
    lineHeight: 80,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.secondary,
    marginTop: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  primaryBtn: {
    marginTop: 28,
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 24,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '600',
  },
});
