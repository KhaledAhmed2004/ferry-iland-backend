const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.resolve('C:/Users/Khaled/Khaled Dask/Frontend/island-hop');

console.log('🚀 Starting Frontend Integration Script...');
console.log('Frontend Root:', FRONTEND_ROOT);

if (!fs.existsSync(FRONTEND_ROOT)) {
  console.error('❌ Frontend directory not found at:', FRONTEND_ROOT);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Update models.ts with Trips, Booking, and Ticket types
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nStep 1: Updating types/models.ts...');
const modelsPath = path.join(FRONTEND_ROOT, 'src/types/models.ts');
let modelsContent = fs.readFileSync(modelsPath, 'utf8');

const typesToAdd = `
/**
 * ─── Trips & Public Search Types ──────────────────────────────────────────────
 */
export interface ISearchedTrip {
  tripId: string;
  operator: string;
  vessel: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  availableSeats: number;
  pricePerAdult: number;
  pricePerChild: number;
  totalPrice: number;
}

export interface ITripSearchResponse {
  message?: string;
  pagination: {
    nextCursor: string | null;
    hasNextPage: boolean;
    limit: number;
  };
  outboundTrips: ISearchedTrip[];
  returnTrips: ISearchedTrip[];
}

export interface ITripSearchParams {
  tripType?: "one-way" | "round-trip";
  from: string;
  to: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  children?: number;
  limit?: number;
  cursor?: string;
}

export interface ITripDetail {
  id: string;
  tripId: string;
  operator: string;
  vessel: string;
  vesselType?: string;
  departurePort: string;
  departurePortId?: string;
  destinationPort: string;
  destinationPortId?: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  availableSeats: number;
  adultFare: number;
  childFare: number;
  status: string;
  gate?: string;
  captain?: string;
}

/**
 * ─── Booking & Ticket Types ──────────────────────────────────────────────────
 */
export interface IPassengerInput {
  passengerName: string;
  nationality: string;
  passportOrId: string;
  cabinClass?: "STANDARD" | "BUSINESS" | "VIP";
  luggageCount?: number;
}

export interface ICreateBookingPayload {
  scheduleId: string;
  leadPassengerName: string;
  leadPassengerEmail: string;
  leadPassengerPhone?: string;
  adultsCount: number;
  childrenCount?: number;
  passengers: IPassengerInput[];
}

export interface ITicketItem {
  id: string;
  bookingId: string;
  ticketNumber: string;
  passengerName: string;
  nationality: string;
  passportOrId: string;
  cabinClass: "STANDARD" | "BUSINESS" | "VIP";
  luggageCount: number;
  boardingStatus: "PENDING" | "CHECKED_IN" | "BOARDED";
  boardedAt?: string | null;
  createdAt: string;
}

export interface IPaymentRecord {
  id: string;
  bookingId: string;
  transactionId?: string | null;
  amount: number;
  platformCommission: number;
  operatorPayout: number;
  status: "PENDING" | "COMPLETED" | "REFUNDED" | "FAILED";
  paymentMethod?: string | null;
  paidAt?: string | null;
}

export interface IBookingDetail {
  id: string;
  reference: string;
  userId?: string | null;
  scheduleId: string;
  leadPassengerName: string;
  leadPassengerEmail: string;
  leadPassengerPhone?: string | null;
  adultsCount: number;
  childrenCount: number;
  totalAmount: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "CHECKED_IN";
  createdAt: string;
  updatedAt: string;
  tickets: ITicketItem[];
  payment?: IPaymentRecord | null;
  schedule: {
    id: string;
    departureTime: string;
    arrivalTime: string;
    gate?: string | null;
    captain?: string | null;
    adultFare: number;
    childFare: number;
    status: string;
    availableSeats: number;
    route: {
      id: string;
      durationMinutes: number;
      departurePort: { id: string; name: string };
      destinationPort: { id: string; name: string };
      operator: { id: string; companyName: string; contactPersonName?: string };
    };
    ferry: {
      id: string;
      name: string;
      capacity: number;
      type: string;
    };
  };
}

export interface IDigitalPassResponse {
  ticketNumber: string;
  bookingReference: string;
  passengerName: string;
  nationality: string;
  passportOrId: string;
  cabinClass: string;
  luggageCount: number;
  boardingStatus: string;
  boardedAt?: string | null;
  trip: {
    tripId: string;
    operatorName: string;
    vesselName: string;
    departurePort: string;
    destinationPort: string;
    departureTime: string;
    arrivalTime: string;
    gate?: string;
  };
  qrCodePayload: string;
}
`;

if (!modelsContent.includes('ISearchedTrip')) {
  modelsContent += typesToAdd;
  fs.writeFileSync(modelsPath, modelsContent, 'utf8');
  console.log('✓ types/models.ts updated successfully');
} else {
  console.log('ℹ️ types/models.ts already contains ISearchedTrip, skipping');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Create hooks/use-trips.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nStep 2: Creating hooks/use-trips.ts...');
const useTripsContent = `"use client";

import { useQuery } from "@tanstack/react-query";
import type { ApiResponse, ITripDetail, ITripSearchParams, ITripSearchResponse } from "@/types";
import { get } from "@/lib/api";

export const tripKeys = {
  all: ["trips"] as const,
  search: (params?: ITripSearchParams) => [...tripKeys.all, "search", params] as const,
  details: () => [...tripKeys.all, "detail"] as const,
  detail: (id: string) => [...tripKeys.details(), id] as const,
};

/**
 * 1. Query: Search available ferry trips by origin, destination, date & passenger count
 */
export function useTripsSearchQuery(params: ITripSearchParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: tripKeys.search(params),
    queryFn: async ({ signal }) => {
      const cleanParams: Record<string, string | number> = {};
      if (params.tripType) cleanParams.tripType = params.tripType;
      if (params.from) cleanParams.from = params.from;
      if (params.to) cleanParams.to = params.to;
      if (params.departureDate) cleanParams.departureDate = params.departureDate;
      if (params.returnDate && params.tripType === "round-trip") {
        cleanParams.returnDate = params.returnDate;
      }
      if (params.adults !== undefined) cleanParams.adults = params.adults;
      if (params.children !== undefined) cleanParams.children = params.children;
      if (params.limit !== undefined) cleanParams.limit = params.limit;
      if (params.cursor) cleanParams.cursor = params.cursor;

      const response = await get<ApiResponse<ITripSearchResponse>>("/trips/search", {
        params: cleanParams,
        signal,
      });

      return (
        response.data ?? {
          pagination: { nextCursor: null, hasNextPage: false, limit: 10 },
          outboundTrips: [],
          returnTrips: [],
        }
      );
    },
    enabled: Boolean(params.from && params.to && params.departureDate && (options?.enabled ?? true)),
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * 2. Query: Fetch public trip details for checkout review
 */
export function useTripDetailsQuery(tripId: string) {
  return useQuery({
    queryKey: tripKeys.detail(tripId),
    queryFn: async ({ signal }) => {
      const response = await get<ApiResponse<ITripDetail>>(\`/trips/\${tripId}\`, {
        signal,
      });
      return response.data ?? null;
    },
    enabled: Boolean(tripId && tripId !== "undefined"),
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
`;

fs.writeFileSync(path.join(FRONTEND_ROOT, 'src/hooks/use-trips.ts'), useTripsContent, 'utf8');
console.log('✓ hooks/use-trips.ts created successfully');

// ─────────────────────────────────────────────────────────────────────────────
// 3. Create hooks/use-bookings.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nStep 3: Creating hooks/use-bookings.ts...');
const useBookingsContent = `"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiResponse, IBookingDetail, ICreateBookingPayload } from "@/types";
import { get, patch, post } from "@/lib/api";
import { tripKeys } from "./use-trips";

export const bookingKeys = {
  all: ["bookings"] as const,
  mine: () => [...bookingKeys.all, "my"] as const,
  details: () => [...bookingKeys.all, "detail"] as const,
  detail: (reference: string) => [...bookingKeys.details(), reference] as const,
  operator: (params?: Record<string, unknown>) => [...bookingKeys.all, "operator", params] as const,
};

/**
 * 1. Mutation: Create New Booking (Guest or Authenticated Checkout)
 */
export function useCreateBookingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ICreateBookingPayload) => {
      return await post<ApiResponse<IBookingDetail>>("/bookings", payload);
    },
    onSuccess: async (response) => {
      // Invalidate active trips so seats update immediately for all viewers
      await queryClient.invalidateQueries({ queryKey: tripKeys.all });
      await queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      toast.success(response.message || "Booking confirmed successfully!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to confirm booking. Please try again.");
    },
  });
}

/**
 * 2. Query: Lookup Booking by Reference (Self-Service & Confirmation)
 */
export function useBookingLookupQuery(reference: string, emailVerification?: string) {
  return useQuery({
    queryKey: bookingKeys.detail(reference),
    queryFn: async ({ signal }) => {
      const cleanParams: Record<string, string> = {};
      if (emailVerification?.trim()) {
        cleanParams.email = emailVerification.trim();
      }

      const response = await get<ApiResponse<IBookingDetail>>(\`/bookings/manage/\${reference}\`, {
        params: cleanParams,
        signal,
      });

      return response.data ?? null;
    },
    enabled: Boolean(reference && reference.trim().length >= 4),
    staleTime: 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("not found")) return false;
      return failureCount < 1;
    },
  });
}

/**
 * 3. Mutation: Cancel Booking (Passenger or Operator)
 */
export function useCancelBookingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ bookingId, reason }: { bookingId: string; reason?: string }) => {
      return await patch<ApiResponse<null>>(\`/bookings/\${bookingId}/cancel\`, { reason });
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      await queryClient.invalidateQueries({ queryKey: tripKeys.all });
      toast.success(response?.message || "Booking cancelled successfully.");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to cancel booking.");
    },
  });
}
`;

fs.writeFileSync(path.join(FRONTEND_ROOT, 'src/hooks/use-bookings.ts'), useBookingsContent, 'utf8');
console.log('✓ hooks/use-bookings.ts created successfully');

// ─────────────────────────────────────────────────────────────────────────────
// 4. Create hooks/use-tickets.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nStep 4: Creating hooks/use-tickets.ts...');
const useTicketsContent = `"use client";

import { useQuery } from "@tanstack/react-query";
import type { ApiResponse, IDigitalPassResponse } from "@/types";
import { get } from "@/lib/api";

export const ticketKeys = {
  all: ["tickets"] as const,
  pass: (identifier: string) => [...ticketKeys.all, "pass", identifier] as const,
};

/**
 * Query: Fetch digital boarding pass by ticket number or booking reference
 */
export function useDigitalPassQuery(identifier: string) {
  return useQuery({
    queryKey: ticketKeys.pass(identifier),
    queryFn: async ({ signal }) => {
      const response = await get<ApiResponse<IDigitalPassResponse>>(\`/tickets/pass/\${identifier}\`, {
        signal,
      });
      return response.data ?? null;
    },
    enabled: Boolean(identifier && identifier.trim().length >= 4),
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
`;

fs.writeFileSync(path.join(FRONTEND_ROOT, 'src/hooks/use-tickets.ts'), useTicketsContent, 'utf8');
console.log('✓ hooks/use-tickets.ts created successfully');

// ─────────────────────────────────────────────────────────────────────────────
// 5. Update hooks/index.ts
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nStep 5: Updating hooks/index.ts...');
const hooksIndexPath = path.join(FRONTEND_ROOT, 'src/hooks/index.ts');
let hooksIndexContent = fs.readFileSync(hooksIndexPath, 'utf8');

if (!hooksIndexContent.includes('use-trips')) {
  hooksIndexContent += `export * from "./use-trips";\nexport * from "./use-bookings";\nexport * from "./use-tickets";\n`;
  fs.writeFileSync(hooksIndexPath, hooksIndexContent, 'utf8');
  console.log('✓ hooks/index.ts updated successfully');
} else {
  console.log('ℹ️ hooks/index.ts already exports use-trips, skipping');
}

console.log('\n✅ All integration hooks and types are ready!');
