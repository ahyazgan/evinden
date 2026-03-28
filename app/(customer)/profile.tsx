import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

export default function ProfileScreen() {
  const { profile } = useAuth();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Profil</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.name?.charAt(0).toUpperCase() ?? '?'}
          </Text>
        </View>
        <Text style={styles.name}>{profile?.name ?? 'Kullanıcı'}</Text>
        <Text style={styles.phone}>{profile?.phone ?? ''}</Text>

        <Pressable style={styles.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Çıkış Yap</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0EBE3' },
  title: { fontSize: 20, fontWeight: '800', color: '#2D2D2D' },
  body: { flex: 1, alignItems: 'center', paddingTop: 40, paddingHorizontal: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  name: { fontSize: 20, fontWeight: '700', color: '#2D2D2D', marginBottom: 4 },
  phone: { fontSize: 14, color: '#999', marginBottom: 32 },
  signOutBtn: {
    paddingHorizontal: 32, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1, borderColor: '#E8E4DD',
  },
  signOutText: { fontSize: 14, fontWeight: '600', color: '#999' },
});
