import { EmailOutbox } from './emailOutbox.model';
import { emailHelper } from '../../../helpers/emailHelper';
import { decryptPayload } from '../../../helpers/cryptoHelpers';
import { emailTemplate } from '../../../shared/emailTemplate';

const MAX_RETRIES = 5;

const calculateNextAttempt = (attempts: number): Date => {
  // Exponential backoff: 1m, 5m, 15m, 1h, 6h
  const backoffMinutes = [1, 5, 15, 60, 360];
  const delay = backoffMinutes[Math.min(attempts, backoffMinutes.length - 1)];
  return new Date(Date.now() + delay * 60000);
};

export const processEmailOutbox = async () => {
  // 1. Atomic claim
  const outboxItem = await EmailOutbox.findOneAndUpdate(
    {
      status: { $in: ['PENDING', 'RETRY'] },
      nextAttemptAt: { $lte: new Date() },
    },
    {
      $set: {
        status: 'PROCESSING',
        lockedAt: new Date(),
      },
    },
    {
      sort: { createdAt: 1 },
      new: true,
    }
  );

  if (!outboxItem) {
    return false; // No tasks to process
  }

  try {
    // 2. Decrypt payload
    const payload = decryptPayload(outboxItem.encryptedPayload);

    // 3. Generate template
    let emailData;
    if (outboxItem.template === 'CREATE_ACCOUNT') {
      emailData = emailTemplate.createAccount(payload);
    } else {
      throw new Error(`Unknown template: ${outboxItem.template}`);
    }

    // 4. Send email
    await emailHelper.sendEmail(emailData);

    // 5. Mark as SENT
    await EmailOutbox.findByIdAndUpdate(outboxItem._id, {
      $set: {
        status: 'SENT',
        sentAt: new Date(),
        lastError: null,
      },
    });

    return true; // Successfully processed
  } catch (error: any) {
    const attempts = outboxItem.attempts + 1;
    const isPermanent = error.responseCode && error.responseCode >= 400 && error.responseCode < 500;
    
    if (isPermanent || attempts >= outboxItem.maxAttempts) {
      await EmailOutbox.findByIdAndUpdate(outboxItem._id, {
        $set: {
          status: 'FAILED_PERMANENT',
          attempts,
          lastAttemptAt: new Date(),
          lastError: error.message || 'Unknown error',
        },
      });
    } else {
      await EmailOutbox.findByIdAndUpdate(outboxItem._id, {
        $set: {
          status: 'RETRY',
          attempts,
          lastAttemptAt: new Date(),
          nextAttemptAt: calculateNextAttempt(attempts),
          lastError: error.message || 'Unknown error',
        },
      });
    }

    return true; // Processed but failed
  }
};

let workerInterval: NodeJS.Timeout | null = null;

export const startOutboxWorker = (intervalMs = 10000) => {
  if (workerInterval) return;
  
  workerInterval = setInterval(async () => {
    try {
      let processed = true;
      // Process all pending items in a loop until none are left
      while(processed) {
        processed = await processEmailOutbox();
      }
    } catch (error) {
      console.error('EmailOutbox worker error:', error);
    }
  }, intervalMs);
  
  console.log(`[EmailOutbox] Worker started with interval ${intervalMs}ms`);
};
