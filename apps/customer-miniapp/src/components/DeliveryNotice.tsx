import { DoorOpen } from 'lucide-react';
import { Icon } from './ui';

/** Shown in the cart and at checkout (owner decision 2026-10-27): the taxi does not promise door-to-door delivery. Mirrors the "Yetkazish" clause of the terms of use. */
export function DeliveryNotice() {
  return (
    <div className="banner warn notice" role="note">
      <Icon as={DoorOpen} size={22} />
      <div>
        <strong>Eshikkacha yetkazish kafolatlanmaydi.</strong>
        <div>Taksi haydovchisi buyurtmani manzilingizdagi bino kirish joyigacha olib keladi. Yuqori qavatga (masalan, 5-qavatga) ko‘tarib chiqishi shart emas: iltimos, haydovchi kelganda pastga tushib oling.</div>
      </div>
    </div>
  );
}
