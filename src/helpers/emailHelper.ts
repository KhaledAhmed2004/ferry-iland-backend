import { EmailService } from './email';

export const emailHelper = {
  sendEmail: EmailService.sendEmail,
};

export { EmailService };
export default emailHelper;
