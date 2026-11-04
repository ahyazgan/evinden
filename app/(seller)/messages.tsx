import { ConversationList } from '@/components/shared/ConversationList';

export default function SellerMessagesScreen() {
  return <ConversationList role="seller" emptyText="Henüz mesajın yok. Müşterilerin sana buradan ulaşır." />;
}
