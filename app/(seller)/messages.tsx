import { ConversationList } from '@/components/shared/ConversationList';

export default function SellerMessagesScreen() {
  return <ConversationList role="seller" emptyText="Henüz mesajınız yok. Müşterileriniz size buradan ulaşır." />;
}
