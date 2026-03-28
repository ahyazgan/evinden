import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/theme';
import type { Seller } from '@/types';

interface Props {
  seller: Seller;
  onPress: (id: string) => void;
}

export function SellerCard({ seller, onPress }: Props) {
  const rating = seller.rating_avg ? seller.rating_avg.toFixed(1) : null;
  const location = [seller.district, seller.city].filter(Boolean).join(', ');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => onPress(seller.id)}
    >
      {/* Avatar placeholder */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {seller.display_name.charAt(0).toUpperCase()}
        </Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {seller.display_name}
        </Text>

        {seller.bio ? (
          <Text style={styles.bio} numberOfLines={2}>
            {seller.bio}
          </Text>
        ) : null}

        <View style={styles.meta}>
          {location ? (
            <Text style={styles.location}>{location}</Text>
          ) : null}

          {rating ? (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>★ {rating}</Text>
              <Text style={styles.ratingCount}> ({seller.rating_count})</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.secondary,
  },
  bio: {
    fontSize: 13,
    color: '#888',
    lineHeight: 18,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  location: {
    fontSize: 12,
    color: '#aaa',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.amber,
  },
  ratingCount: {
    fontSize: 12,
    color: '#aaa',
  },
});
