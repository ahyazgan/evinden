import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';

export default function FavoritesScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Favoriler</Text>
      </View>
      <View style={styles.center}>
        <Text style={styles.emoji}>❤️</Text>
        <Text style={styles.text}>Favori satıcılarınız burada görünecek</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF7F2' },
  header: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0EBE3' },
  title: { fontSize: 20, fontWeight: '800', color: '#2D2D2D' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emoji: { fontSize: 52 },
  text: { fontSize: 14, color: '#999', textAlign: 'center' },
});
