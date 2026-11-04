import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AuthLead, AuthShell } from '@/components/shared/AuthGate';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';

export default function AwaitingApprovalScreen() {
  const { colors: t } = useTheme();
  const { refreshProfile, signOut } = useAuth();
  const [loading, setLoading] = useState(false);

  const onRefresh = async () => {
    setLoading(true);
    await refreshProfile();
    setLoading(false);
  };

  const onSignOut = async () => {
    setLoading(true);
    await signOut();
    setLoading(false);
  };

  return (
    <AuthShell title="Onay bekleniyor" titleSize={30}>
      <View style={[s.icon, { backgroundColor: t.background }]}>
        <Ionicons name="hourglass-outline" size={28} color={t.text} />
      </View>
      <AuthLead>
        Satıcı hesabın yönetici onayından sonra açılacak. Onaylandığında buradan otomatik olarak panele yönlendirileceksin.
      </AuthLead>
      <Button label="Durumu yenile" onPress={onRefresh} loading={loading} size="lg" fullWidth />
      <Button label="Çıkış yap" onPress={onSignOut} disabled={loading} variant="ghost" fullWidth />
    </AuthShell>
  );
}

const s = StyleSheet.create({
  icon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
