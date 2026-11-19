import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { prisma } from '../../../shared/prisma';
import { ILegalPage, IUpdateLegalPagePayload } from './legal.interface';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_LEGAL_DOCS = [
  {
    title: 'Terms of Service',
    slug: 'terms-of-service',
    content: `# Terms of Service

**Last updated:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

Welcome to IslandHop! By using our ferry booking platform, mobile services, or purchasing tickets, you agree to comply with and be bound by the following terms and conditions.

## 1. Booking & Ticketing
* All bookings made through IslandHop are subject to schedule availability and operator confirmation.
* A valid government-issued ID or passport matching the passenger name is required at vessel boarding.
* Digital QR boarding passes issued by IslandHop must be presented at the check-in terminal.

## 2. Cancellations & Refunds
* Cancellation requests submitted more than 24 hours prior to departure are eligible for a refund according to operator policy.
* Late arrivals and no-shows are strictly non-refundable.

## 3. Maritime Safety & Baggage
* Passengers must abide by all safety guidelines and crew instructions aboard the vessel.
* Dangerous goods, hazardous chemicals, and unauthorized weapons are strictly prohibited.

## 4. Platform Role
IslandHop operates as a verified ticketing platform connecting passengers with licensed ferry operators. We ensure transparent pricing with no hidden booking fees.`,
    isPublished: true,
  },
  {
    title: 'Privacy Policy',
    slug: 'privacy-policy',
    content: `# Privacy Policy

**Last updated:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

Your privacy is paramount to IslandHop. This policy outlines how we collect, handle, and protect your personal information.

## 1. Information We Collect
* **Personal Identification:** Name, email address, phone number, and passport/national ID (required for maritime manifests).
* **Booking Details:** Journey routes, travel dates, passenger counts, and payment references.
* **Device & Usage:** IP address, browser type, and navigation logs for fraud prevention.

## 2. How We Use Your Data
* To process ferry reservations and issue authenticated digital boarding passes.
* To provide harbor operators with required international maritime passenger manifests.
* To send real-time trip status alerts, departure changes, and weather delays.

## 3. Security Standards
* All payment transactions are encrypted using TLS 1.3 and processed via PCI-DSS compliant providers.
* We never store raw payment card credentials on our servers.`,
    isPublished: true,
  },
  {
    title: 'Cancellation & Refund Policy',
    slug: 'cancellation-policy',
    content: `# Cancellation & Refund Policy

**Last updated:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

We understand travel plans can change. Here is how cancellations and refunds work across our ferry network:

## 1. Passenger Self-Service Cancellation
* **Up to 24 hours before departure:** Full refund eligible minus platform processing fees.
* **Within 24 hours of departure:** Subject to operator review and maritime penalty fees.
* **Post-departure:** Non-refundable once the vessel departs the harbor.

## 2. Weather & Operator Cancellations
In the event of rough sea conditions or mechanical maintenance:
* Passengers are offered a free rescheduling to the next available sailing, or
* A 100% full refund credited back to the original payment method.`,
    isPublished: true,
  },
];

const ensureDefaultLegalPages = async (): Promise<void> => {
  for (const doc of DEFAULT_LEGAL_DOCS) {
    await prisma.legalPage.upsert({
      where: { slug: doc.slug },
      update: {}, // Preserve any existing edits made by admin
      create: {
        title: doc.title,
        slug: doc.slug,
        content: doc.content,
        isPublished: doc.isPublished,
      },
    });
  }
};

const getAll = async (isAdmin = false): Promise<ILegalPage[]> => {
  await ensureDefaultLegalPages();

  const where = isAdmin ? {} : { isPublished: true };

  return prisma.legalPage.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
};

const getByIdOrSlug = async (
  identifier: string,
  isAdmin = false,
): Promise<ILegalPage> => {
  await ensureDefaultLegalPages();

  const isUuid = UUID_REGEX.test(identifier);

  const page = await prisma.legalPage.findFirst({
    where: isUuid
      ? { OR: [{ id: identifier }, { slug: identifier }] }
      : { slug: identifier },
  });

  if (!page || (!isAdmin && !page.isPublished)) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Legal document not found');
  }

  return page;
};

const updateById = async (
  id: string,
  payload: IUpdateLegalPagePayload,
): Promise<ILegalPage> => {
  const existing = await prisma.legalPage.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, `Legal document not found with ID: ${id}`);
  }

  return prisma.legalPage.update({
    where: { id },
    data: {
      ...(payload.title !== undefined && { title: payload.title.trim() }),
      ...(payload.content !== undefined && { content: payload.content }),
      ...(payload.isPublished !== undefined && { isPublished: payload.isPublished }),
    },
  });
};

export const LegalService = {
  getAll,
  getByIdOrSlug,
  updateById,
  ensureDefaultLegalPages,
};
