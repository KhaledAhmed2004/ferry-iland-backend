import { SupportTicket, SupportMessage } from '@prisma/client';

export type ISupportMessage = SupportMessage;
export type ISupport = SupportTicket & {
  messages?: SupportMessage[];
};
