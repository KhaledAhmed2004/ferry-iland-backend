const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve('..', '..', 'Frontend', 'island-hop');

console.log('Target Frontend Directory:', frontendDir);

// 1. Update booking-params.ts
const bookingParamsPath = path.join(frontendDir, 'src', 'schemas', 'booking-params.ts');
const bookingParamsCode = `import {
  createSearchParamsCache,
  parseAsString,
  parseAsStringEnum
} from "nuqs/server";

export const tripTypeValues = ["one-way", "round-trip"] as const;
export type TripType = (typeof tripTypeValues)[number];

export const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return \`\${year}-\${month}-\${day}\`;
};

export const bookingSearchParamsParsers = {
  tripType: parseAsStringEnum<TripType>(["one-way", "round-trip"]).withDefault("one-way"),
  from: parseAsString.withDefault("Malé Ferry Terminal"),
  to: parseAsString.withDefault("Maafushi Jetty"),
  departureDate: parseAsString.withDefault(getTodayDateString()),
  returnDate: parseAsString.withDefault(""),
  passengers: parseAsString.withDefault("1 Passenger"),
  adults: parseAsString.withDefault("1"),
  children: parseAsString.withDefault("0"),
  bookingRef: parseAsString.withDefault("")
};

export const bookingSearchParamsCache = createSearchParamsCache(bookingSearchParamsParsers);

/**
 * Helper to reliably parse numeric passenger count from strings like "1 Passenger", "2 Passengers", "4"
 */
export function extractPassengerCount(passengersStr: string | null | undefined): number {
  if (!passengersStr) return 1;
  const match = passengersStr.match(/\\d+/);
  const count = match ? parseInt(match[0], 10) : 1;
  return isNaN(count) || count < 1 ? 1 : count;
}
`;
fs.writeFileSync(bookingParamsPath, bookingParamsCode, 'utf8');
console.log('✓ Updated booking-params.ts');

// 2. Update FerryCard.tsx to support ISearchedTrip and FerryTrip
const ferryCardPath = path.join(frontendDir, 'src', 'components', 'widgets', 'booking', 'FerryCard.tsx');
const ferryCardCode = `"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Ship, Users } from "lucide-react";
import { useQueryStates } from "nuqs";

import { bookingSearchParamsParsers, extractPassengerCount } from "@/schemas/booking-params";
import type { ISearchedTrip } from "@/types";
import type { FerryTrip } from "@/data/ferries";
import { Badge, Button, Card, CardContent } from "@/ui";

const FERRY_IMAGES = [
  "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1505705694340-019e1e335916?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80"
];

interface FerryCardProps {
  trip: ISearchedTrip | FerryTrip;
  fromPortName?: string;
  toPortName?: string;
}

export function FerryCard({ trip, fromPortName, toPortName }: FerryCardProps) {
  const [params] = useQueryStates(bookingSearchParamsParsers);
  const numericCount = extractPassengerCount(params.passengers);

  const tripId = "tripId" in trip ? trip.tripId : trip.id;
  const operatorName = trip.operator;
  const vesselName = "vessel" in trip ? trip.vessel : trip.vesselName;
  const price = "pricePerAdult" in trip ? trip.pricePerAdult : trip.price;
  const departurePort = fromPortName || ("departurePort" in trip ? trip.departurePort : params.from);
  const arrivalPort = toPortName || ("arrivalPort" in trip ? trip.arrivalPort : params.to);
  const availableSeats = trip.availableSeats;

  // Stable image selection based on tripId string hash
  const imageIndex = Math.abs(
    tripId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
  ) % FERRY_IMAGES.length;
  const imageSrc = "image" in trip && trip.image ? trip.image : FERRY_IMAGES[imageIndex];

  const reviewUrl = \`/book/\${tripId}/review?passengers=\${numericCount}&departureDate=\${encodeURIComponent(
    params.departureDate
  )}&from=\${encodeURIComponent(departurePort)}&to=\${encodeURIComponent(arrivalPort)}&tripType=\${
    params.tripType
  }\`;

  return (
    <Card className="group border-border bg-card hover:border-primary/40 overflow-hidden rounded-2xl p-0 shadow-sm transition-all duration-200 hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex flex-col lg:flex-row">
          {/* Left: Ferry Vessel Image */}
          <div className="bg-muted relative h-48 w-full overflow-hidden rounded-md lg:h-auto lg:w-72 lg:shrink-0">
            <Image
              src={imageSrc}
              alt={\`\${operatorName} - \${vesselName}\`}
              fill
              sizes="(max-width: 1024px) 100vw, 288px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </div>

          {/* Right: Ferry Info & Booking Action */}
          <div className="flex flex-1 flex-col justify-between p-6">
            <div>
              {/* Header: Operator & Seats */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="bg-primary/10 text-primary flex h-7 w-7 items-center justify-center rounded-lg">
                    <Ship className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-foreground text-base font-bold">{operatorName}</h3>
                    <p className="text-muted-foreground text-xs">{vesselName}</p>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className="gap-1.5 border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {availableSeats} seats available
                </Badge>
              </div>

              {/* Timing & Timeline Route Track */}
              <div className="mt-6 grid grid-cols-1 items-center gap-6 sm:grid-cols-12">
                {/* Departure */}
                <div className="sm:col-span-3">
                  <div className="text-muted-foreground text-[10px] font-extrabold tracking-wider uppercase">
                    DEPARTURE
                  </div>
                  <div className="text-foreground mt-0.5 text-2xl font-black tracking-tight">
                    {trip.departureTime}
                  </div>
                  <div className="text-muted-foreground text-xs font-medium">
                    {departurePort}
                  </div>
                </div>

                {/* Progress duration indicator */}
                <div className="flex flex-col items-center justify-center sm:col-span-4">
                  <span className="text-muted-foreground text-[11px] font-medium">
                    {trip.duration}
                  </span>
                  <div className="relative mt-2 flex w-full max-w-[160px] items-center">
                    <div className="bg-primary h-2 w-2 rounded-full" />
                    <div className="bg-border h-[2px] flex-1" />
                    <div className="text-primary">
                      <ArrowRight className="h-3 w-3" />
                    </div>
                    <div className="bg-border h-[2px] flex-1" />
                    <div className="border-primary bg-background h-2 w-2 rounded-full border-2" />
                  </div>
                </div>

                {/* Arrival */}
                <div className="sm:col-span-3">
                  <div className="text-muted-foreground text-[10px] font-extrabold tracking-wider uppercase">
                    ARRIVAL
                  </div>
                  <div className="text-foreground mt-0.5 text-2xl font-black tracking-tight">
                    {trip.arrivalTime}
                  </div>
                  <div className="text-muted-foreground text-xs font-medium">
                    {arrivalPort}
                  </div>
                </div>

                {/* Price & Action */}
                <div className="border-border flex flex-row items-center justify-between border-t pt-4 sm:col-span-2 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                  <div className="text-left sm:text-right">
                    <span className="text-muted-foreground text-[10px] font-extrabold tracking-wider uppercase">
                      FROM
                    </span>
                    <div className="text-foreground text-2xl font-black sm:text-3xl">
                      \${price}
                    </div>
                    <div className="text-muted-foreground text-[10px]">/ per passenger</div>
                  </div>

                  <Button
                    size="sm"
                    className="mt-3 rounded-xl px-5 font-bold shadow-md transition-all hover:shadow-lg"
                    asChild
                  >
                    <Link href={reviewUrl}>
                      <span>Select Trip</span>
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
`;
fs.writeFileSync(ferryCardPath, ferryCardCode, 'utf8');
console.log('✓ Updated FerryCard.tsx');

// 3. Create BookingResultsList.tsx (Client component for search results)
const bookingResultsListPath = path.join(
  frontendDir,
  'src',
  'components',
  'widgets',
  'booking',
  'BookingResultsList.tsx'
);
const bookingResultsListCode = `"use client";

import { useMemo } from "react";
import { useQueryStates } from "nuqs";
import { AlertCircle, Calendar, RefreshCw, Ship } from "lucide-react";

import { bookingSearchParamsParsers, extractPassengerCount } from "@/schemas/booking-params";
import { useTripsSearchQuery } from "@/hooks/use-trips";
import { FerryCard } from "./FerryCard";
import { Button, Card, CardContent } from "@/ui";

export function BookingResultsList() {
  const [params] = useQueryStates(bookingSearchParamsParsers);
  const numericCount = extractPassengerCount(params.passengers);
  const adults = parseInt(params.adults || "1", 10) || 1;
  const children = parseInt(params.children || "0", 10) || 0;

  const searchParams = useMemo(() => ({
    from: params.from,
    to: params.to,
    departureDate: params.departureDate,
    returnDate: params.returnDate || undefined,
    tripType: params.tripType,
    adults,
    children,
    limit: 20
  }), [params.from, params.to, params.departureDate, params.returnDate, params.tripType, adults, children]);

  const { data, isLoading, isError, error, refetch } = useTripsSearchQuery(searchParams);

  // Format date for readable display
  const formattedDate = useMemo(() => {
    try {
      const d = new Date(params.departureDate);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric"
        });
      }
    } catch {
      // fallback
    }
    return params.departureDate;
  }, [params.departureDate]);

  const outboundTrips = data?.outboundTrips ?? [];
  const returnTrips = data?.returnTrips ?? [];

  return (
    <div className="space-y-8">
      {/* Summary Header */}
      <div className="space-y-1">
        <div className="text-primary text-xs font-extrabold tracking-wider uppercase">
          AVAILABLE FERRIES
        </div>
        <h2 className="text-foreground text-2xl font-black tracking-tight sm:text-3xl">
          Choose your ferry
        </h2>
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="text-foreground font-semibold">
            {params.from} &rarr; {params.to}
          </span>
          <span>&bull;</span>
          <span>{formattedDate}</span>
          <span>&bull;</span>
          <span>{params.passengers}</span>
        </div>
        {!isLoading && (
          <div className="text-muted-foreground pt-1 text-[11px] font-bold uppercase">
            {outboundTrips.length} {outboundTrips.length === 1 ? "TRIP" : "TRIPS"} AVAILABLE
          </div>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse overflow-hidden rounded-2xl border border-border/80 bg-card p-6">
              <div className="flex flex-col gap-6 lg:flex-row">
                <div className="h-44 w-full rounded-xl bg-muted/60 lg:w-72" />
                <div className="flex-1 space-y-4">
                  <div className="flex justify-between">
                    <div className="h-6 w-44 rounded-md bg-muted/60" />
                    <div className="h-6 w-28 rounded-md bg-muted/60" />
                  </div>
                  <div className="grid grid-cols-3 gap-4 pt-4">
                    <div className="h-14 rounded-md bg-muted/50" />
                    <div className="h-14 rounded-md bg-muted/50" />
                    <div className="h-14 rounded-md bg-muted/50" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {isError && (
        <Card className="rounded-2xl border-destructive/20 bg-destructive/5 p-8 text-center">
          <CardContent className="space-y-4 p-0">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-foreground text-lg font-bold">Failed to load ferry trips</h3>
              <p className="text-muted-foreground text-xs mt-1">
                {error instanceof Error ? error.message : "Could not connect to the ferry schedule service."}
              </p>
            </div>
            <Button onClick={() => void refetch()} variant="outline" size="sm" className="gap-2 rounded-xl">
              <RefreshCw className="h-4 w-4" /> Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && !isError && outboundTrips.length === 0 && (
        <Card className="rounded-2xl border-border/80 bg-card p-10 text-center shadow-xs">
          <CardContent className="mx-auto max-w-md space-y-4 p-0">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Ship className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-foreground text-xl font-bold">No ferry trips found</h3>
              <p className="text-muted-foreground text-xs sm:text-sm">
                No active sailings scheduled from <span className="font-semibold text-foreground">{params.from}</span> to{" "}
                <span className="font-semibold text-foreground">{params.to}</span> on {formattedDate}.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 text-left text-xs space-y-1.5 text-muted-foreground">
              <div className="font-bold text-foreground">Suggestions:</div>
              <div>• Try another departure date (daily scheduled sailings operate between Malé and Maafushi).</div>
              <div>• Check connected ports in the search filter bar above.</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Outbound Trips List */}
      {!isLoading && !isError && outboundTrips.length > 0 && (
        <div className="space-y-4">
          {outboundTrips.map((trip) => (
            <FerryCard
              key={trip.tripId}
              trip={trip}
              fromPortName={params.from}
              toPortName={params.to}
            />
          ))}
        </div>
      )}

      {/* Return Trips List (if Round Trip) */}
      {!isLoading && !isError && params.tripType === "round-trip" && returnTrips.length > 0 && (
        <div className="space-y-4 pt-10 border-t border-border/80">
          <div className="space-y-1">
            <div className="text-primary text-xs font-extrabold tracking-wider uppercase">
              RETURN JOURNEY
            </div>
            <h3 className="text-foreground text-xl font-black tracking-tight sm:text-2xl">
              Choose your return ferry
            </h3>
            <p className="text-muted-foreground text-xs">
              {params.to} &rarr; {params.from}
            </p>
          </div>
          <div className="space-y-4">
            {returnTrips.map((trip) => (
              <FerryCard
                key={trip.tripId}
                trip={trip}
                fromPortName={params.to}
                toPortName={params.from}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
`;
fs.writeFileSync(bookingResultsListPath, bookingResultsListCode, 'utf8');
console.log('✓ Created BookingResultsList.tsx');

// 4. Update widgets index to export BookingResultsList
const widgetsIndexPath = path.join(frontendDir, 'src', 'components', 'widgets', 'index.ts');
let widgetsIndexCode = fs.readFileSync(widgetsIndexPath, 'utf8');
if (!widgetsIndexCode.includes('BookingResultsList')) {
  widgetsIndexCode += `\nexport * from "./booking/BookingResultsList";\n`;
  fs.writeFileSync(widgetsIndexPath, widgetsIndexCode, 'utf8');
  console.log('✓ Exported BookingResultsList from widgets index');
}

// 5. Update book/page.tsx
const bookPagePath = path.join(frontendDir, 'src', 'app', '(marketing-and-booking)', 'book', 'page.tsx');
const bookPageCode = `import { Suspense } from "react";
import type { Metadata } from "next";
import Image from "next/image";

import heroBg from "@/assets/landing-page/hero-bg.png";
import { BookingResultsList, BookingSearchFilterBar, BookingValueProps } from "@/widgets";
import { AnimatedSection, Badge } from "@/ui";

export const metadata: Metadata = {
  title: "Available Ferries | IslandHop",
  description: "Browse and select from available ferry trips matching your journey."
};

export default function BookPage() {
  return (
    <div className="flex min-h-screen flex-col py-16">
      {/* 1. Top Hero Section with Ferry Banner */}
      <AnimatedSection initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} delay={0}>
        <section className="bg-background relative w-full overflow-hidden pt-12 pb-24 md:pt-16 md:pb-28">
          {/* Background Ferry Image */}
          <div className="absolute inset-0 z-0">
            <Image
              src={heroBg}
              alt="Available Ferries on blue ocean"
              fill
              priority
              sizes="100vw"
              className="object-cover object-right"
            />
            {/* Gradient Overlay for Text Readability */}
            <div className="from-background via-background/10 to-background/20 md:via-background/80 absolute inset-0 bg-gradient-to-r md:hidden" />
          </div>

          <div className="relative z-10 container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-xl space-y-3">
              <Badge
                variant="outline"
                className="border-primary/30 bg-card/60 text-primary w-fit text-xs font-semibold backdrop-blur-sm"
              >
                SEARCH RESULTS
              </Badge>

              <h1 className="text-foreground text-3xl font-black tracking-tight sm:text-5xl">
                Available Ferries
              </h1>

              <p className="text-muted-foreground text-sm sm:text-base">
                Choose from the available trips below for your journey.
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>

      {/* 2. Floating Search Filter Bar */}
      <AnimatedSection
        delay={0.05}
        className="relative z-20 mx-auto -mt-16 w-full max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        <Suspense fallback={<div className="h-28 rounded-2xl bg-card animate-pulse" />}>
          <BookingSearchFilterBar />
        </Suspense>
      </AnimatedSection>

      {/* 3. Search Results & Ferry Trip Cards List */}
      <main className="container mx-auto mt-10 max-w-7xl px-4 sm:px-6 lg:px-8">
        <Suspense
          fallback={
            <div className="space-y-4">
              <div className="h-8 w-48 rounded bg-muted animate-pulse" />
              <div className="h-44 w-full rounded-2xl bg-card border border-border animate-pulse" />
            </div>
          }
        >
          <BookingResultsList />
        </Suspense>

        {/* 4. Bottom Value Proposition Grid */}
        <AnimatedSection delay={0.1} className="mt-14">
          <BookingValueProps />
        </AnimatedSection>
      </main>
    </div>
  );
}
`;
fs.writeFileSync(bookPagePath, bookPageCode, 'utf8');
console.log('✓ Updated book/page.tsx');

// 6. Update BookingSummarySidebar.tsx to be flexible with trip object properties
const sidebarPath = path.join(
  frontendDir,
  'src',
  'components',
  'widgets',
  'booking',
  'BookingSummarySidebar.tsx'
);
const sidebarCode = `"use client";

import type { ReactNode } from "react";
import { Ship } from "lucide-react";
import { Card, CardContent } from "@/ui";

interface TripSummaryData {
  price?: number;
  adultFare?: number;
  totalPrice?: number;
  departurePort?: string;
  arrivalPort?: string;
  destinationPort?: string;
  departureTime?: string;
  duration?: string;
  operator?: string;
  [key: string]: any;
}

interface BookingSummarySidebarProps {
  trip: TripSummaryData;
  passengerCount: number;
  departureDate?: string;
  actionButton?: ReactNode;
  secondaryButton?: ReactNode;
  title?: string;
}

export function BookingSummarySidebar({
  trip,
  passengerCount,
  departureDate = "Sat, 24 May 2026",
  actionButton,
  secondaryButton,
  title = "Your booking"
}: BookingSummarySidebarProps) {
  const farePerPassenger = trip.price ?? trip.adultFare ?? 25;
  const totalPrice = trip.totalPrice ?? farePerPassenger * passengerCount;
  const depPort = trip.departurePort || "Departure Port";
  const arrPort = trip.arrivalPort || trip.destinationPort || "Destination Port";

  // Format departure date nicely if valid ISO
  let displayDate = departureDate;
  try {
    const d = new Date(departureDate);
    if (!isNaN(d.getTime())) {
      displayDate = d.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    }
  } catch {
    displayDate = departureDate;
  }

  return (
    <Card className="border-border/80 bg-card rounded-2xl border p-6 shadow-sm">
      <CardContent className="space-y-6 p-0">
        <h3 className="text-foreground text-lg font-bold tracking-tight">{title}</h3>

        {/* Route Details */}
        <div className="space-y-3 text-xs sm:text-sm">
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground font-medium">Route</span>
            <div className="text-foreground flex items-center gap-1.5 font-bold">
              <Ship className="h-3.5 w-3.5 shrink-0 text-[#003B95]" />
              <span>
                {depPort} &rarr; {arrPort}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground font-medium">Date</span>
            <span className="text-foreground font-semibold">{displayDate}</span>
          </div>

          {trip.departureTime && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground font-medium">Departure</span>
              <span className="text-foreground font-semibold">{trip.departureTime}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground font-medium">Passengers</span>
            <span className="text-foreground font-semibold">
              {passengerCount} {passengerCount === 1 ? "Passenger" : "Passengers"}
            </span>
          </div>
        </div>

        <div className="bg-border/60 h-[1px] w-full" />

        {/* Pricing Breakdown */}
        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>
              Fare (\${farePerPassenger} &times; {passengerCount})
            </span>
            <span className="text-foreground font-medium">\${totalPrice}</span>
          </div>

          <div className="flex items-baseline justify-between pt-2">
            <span className="text-foreground text-sm font-bold">Total</span>
            <span className="text-foreground text-3xl font-black tracking-tight sm:text-4xl">
              \${totalPrice}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        {(actionButton || secondaryButton) && (
          <div className="space-y-2.5 pt-2">
            {actionButton}
            {secondaryButton}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
`;
fs.writeFileSync(sidebarPath, sidebarCode, 'utf8');
console.log('✓ Updated BookingSummarySidebar.tsx');
