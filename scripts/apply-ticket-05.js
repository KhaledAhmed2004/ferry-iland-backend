const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve('..', '..', 'Frontend', 'island-hop');
console.log('Target Frontend Directory:', frontendDir);

// 1. Step 1: Review Page
const reviewPagePath = path.join(
  frontendDir,
  'src',
  'app',
  '(marketing-and-booking)',
  'book',
  '[tripId]',
  'review',
  'page.tsx'
);
const reviewPageCode = `"use client";

import { use, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Clock,
  Info,
  Minus,
  Plus,
  Ship,
  Tag
} from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";

import { useTripDetailsQuery } from "@/hooks/use-trips";
import { BookingStepperNav, BookingSummarySidebar } from "@/widgets";
import { AnimatedSection, Button, Card, CardContent } from "@/ui";

interface Step1ReviewPageProps {
  params: Promise<{ tripId: string }>;
}

export default function Step1ReviewPage({ params }: Step1ReviewPageProps) {
  const { tripId } = use(params);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [passengerCount, setPassengerCount] = useQueryState(
    "passengers",
    parseAsInteger.withDefault(1)
  );
  const [departureDate] = useQueryState("departureDate", parseAsString.withDefault(""));
  const [fromPort] = useQueryState("from", parseAsString.withDefault(""));
  const [toPort] = useQueryState("to", parseAsString.withDefault(""));
  const [tripType] = useQueryState("tripType", parseAsString.withDefault("one-way"));

  const { data: trip, isLoading, isError, error } = useTripDetailsQuery(tripId);

  const availableSeats = trip?.availableSeats ?? 50;
  const fare = trip?.adultFare ?? 25;

  const handleIncrement = () => {
    if (passengerCount < availableSeats) {
      void setPassengerCount(passengerCount + 1);
    }
  };

  const handleDecrement = () => {
    if (passengerCount > 1) {
      void setPassengerCount(passengerCount - 1);
    }
  };

  const handleContinue = () => {
    startTransition(() => {
      router.push(
        \`/book/\${tripId}/passengers?passengers=\${passengerCount}&departureDate=\${encodeURIComponent(
          departureDate || (trip?.departureTime ? trip.departureTime.split("T")[0] : "")
        )}&from=\${encodeURIComponent(trip?.departurePort || fromPort)}&to=\${encodeURIComponent(
          trip?.destinationPort || toPort
        )}&tripType=\${tripType}\`
      );
    });
  };

  // Format date display
  const effectiveDate = departureDate || (trip?.departureTime ? trip.departureTime.split("T")[0] : "");
  let formattedDate = effectiveDate;
  try {
    const d = new Date(effectiveDate);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    }
  } catch {
    formattedDate = effectiveDate;
  }

  // Format departure / arrival times
  const depTimeDisplay = trip?.departureTime
    ? new Date(trip.departureTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";
  const arrTimeDisplay = trip?.arrivalTime
    ? new Date(trip.arrivalTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";

  if (isLoading) {
    return (
      <div className="dark:bg-background min-h-screen bg-[#F8FAFC] py-20">
        <div className="border-border/60 dark:bg-card border-b bg-white">
          <BookingStepperNav currentStep={1} />
        </div>
        <main className="container mx-auto mt-8 max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-8">
              <Card className="animate-pulse p-6 rounded-2xl border border-border bg-card">
                <div className="h-44 w-full bg-muted/60 rounded-xl" />
              </Card>
            </div>
            <div className="lg:col-span-4">
              <Card className="animate-pulse p-6 rounded-2xl border border-border bg-card">
                <div className="h-64 w-full bg-muted/60 rounded-xl" />
              </Card>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (isError || !trip) {
    return (
      <div className="dark:bg-background min-h-screen bg-[#F8FAFC] py-20">
        <main className="container mx-auto mt-8 max-w-xl px-4 text-center">
          <Card className="p-8 rounded-2xl border border-destructive/20 bg-destructive/5 space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <h2 className="text-xl font-bold text-foreground">Ferry Trip Not Found</h2>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "The requested sailing could not be retrieved."}
            </p>
            <Button asChild className="rounded-xl">
              <Link href="/book">Return to Search</Link>
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  const sidebarTripData = {
    adultFare: fare,
    departurePort: trip.departurePort,
    arrivalPort: trip.destinationPort,
    departureTime: depTimeDisplay,
    duration: trip.duration,
    operator: trip.operator
  };

  return (
    <div className="dark:bg-background min-h-screen bg-[#F8FAFC] py-20">
      {/* 1. Top Stepper Header */}
      <div className="border-border/60 dark:bg-card border-b bg-white">
        <BookingStepperNav currentStep={1} />
      </div>

      {/* 2. Main Content Grid */}
      <main className="container mx-auto mt-8 max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Column: Trip Details & Passenger Selector */}
          <AnimatedSection
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="space-y-6 lg:col-span-8"
          >
            {/* Trip Recap Card */}
            <Card className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 shadow-sm">
              <CardContent className="space-y-6 p-0">
                <div className="border-border/60 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs font-semibold">
                      Your ferry trip
                    </span>
                    <h2 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
                      {trip.departurePort} &rarr; {trip.destinationPort}
                    </h2>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border h-9 rounded-xl px-4 text-xs font-semibold"
                    asChild
                  >
                    <Link
                      href={\`/book?from=\${encodeURIComponent(trip.departurePort)}&to=\${encodeURIComponent(
                        trip.destinationPort
                      )}&departureDate=\${encodeURIComponent(effectiveDate)}&passengers=\${passengerCount}\`}
                    >
                      Change Trip
                    </Link>
                  </Button>
                </div>

                {/* Trip Metadata Grid */}
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="flex items-start gap-3.5">
                    <div className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-[11px] font-medium">Date</div>
                      <div className="text-foreground text-sm font-bold">{formattedDate}</div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-[11px] font-medium">Time</div>
                      <div className="text-foreground text-sm font-bold">
                        {depTimeDisplay} &rarr; {arrTimeDisplay}
                      </div>
                      <div className="text-muted-foreground text-xs">{trip.duration}</div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Ship className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-[11px] font-medium">Operator &amp; Vessel</div>
                      <div className="text-foreground text-sm font-bold">{trip.operator}</div>
                      <div className="text-muted-foreground text-xs">{trip.vessel} ({trip.vesselType || "Speedboat"})</div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5">
                    <div className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Tag className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-[11px] font-medium">Fare</div>
                      <div className="text-foreground text-sm font-bold">
                        \${fare}{" "}
                        <span className="text-muted-foreground text-xs font-normal">
                          / passenger
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Seats Remaining Blue Banner */}
            <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-[#EBF5FF] p-4 text-[#003B95] dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
              <Info className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-0.5 text-xs sm:text-sm">
                <div className="font-bold">{availableSeats} seats remaining</div>
                <div className="text-xs text-blue-900/80 dark:text-blue-200/80">
                  Tickets are confirmed instantly and seat reservations are locked for checkout.
                </div>
              </div>
            </div>

            {/* Tickets / Passenger Counter Card */}
            <Card className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 shadow-sm">
              <CardContent className="space-y-4 p-0">
                <div className="space-y-1">
                  <div className="text-muted-foreground text-[11px] font-extrabold tracking-wider uppercase">
                    TICKETS
                  </div>
                  <h3 className="text-foreground text-base font-bold">How many passengers?</h3>
                  <p className="text-muted-foreground text-xs">
                    Select the number of passengers travelling on this booking.
                  </p>
                </div>

                {/* Counter Input Box */}
                <div className="border-border/80 bg-card flex max-w-sm items-center justify-between rounded-2xl border p-2 sm:p-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleDecrement}
                    disabled={passengerCount <= 1}
                    className="border-border/80 bg-muted/50 hover:bg-muted h-10 w-10 rounded-xl"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>

                  <span className="text-foreground text-sm font-bold">
                    {passengerCount} {passengerCount === 1 ? "Passenger" : "Passengers"}
                  </span>

                  <Button
                    type="button"
                    size="icon"
                    onClick={handleIncrement}
                    disabled={passengerCount >= availableSeats}
                    className="h-10 w-10 rounded-xl bg-[#003B95] text-white hover:bg-[#002f77]"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </AnimatedSection>

          {/* Right Column: Sticky Summary Sidebar */}
          <AnimatedSection delay={0.08} className="lg:col-span-4">
            <div className="sticky top-24">
              <BookingSummarySidebar
                trip={sidebarTripData}
                passengerCount={passengerCount}
                departureDate={formattedDate}
                actionButton={
                  <Button
                    onClick={handleContinue}
                    className="h-12 w-full rounded-xl bg-[#003B95] text-xs font-bold text-white shadow-md transition-all hover:bg-[#002f77] sm:text-sm"
                  >
                    Continue to Passenger Details <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                }
              />
            </div>
          </AnimatedSection>
        </div>
      </main>
    </div>
  );
}
`;
fs.writeFileSync(reviewPagePath, reviewPageCode, 'utf8');
console.log('✓ Updated review/page.tsx');

// 2. Step 2: Passengers Page
const passengersPagePath = path.join(
  frontendDir,
  'src',
  'app',
  '(marketing-and-booking)',
  'book',
  '[tripId]',
  'passengers',
  'page.tsx'
);
const passengersPageCode = `"use client";

import { use, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Luggage, Mail, Phone, ShieldCheck, User } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";

import { useTripDetailsQuery } from "@/hooks/use-trips";
import { BookingStepperNav, BookingSummarySidebar } from "@/widgets";
import { AnimatedSection, Button, Card, CardContent, Input, Label } from "@/ui";

interface Step2PassengersPageProps {
  params: Promise<{ tripId: string }>;
}

export interface DetailedPassengerInput {
  fullName: string;
  nationality: string;
  passportOrId: string;
  cabinClass: "STANDARD" | "BUSINESS" | "VIP";
  luggageCount: number;
}

export default function Step2PassengersPage({ params }: Step2PassengersPageProps) {
  const { tripId } = use(params);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [passengerCount] = useQueryState("passengers", parseAsInteger.withDefault(1));
  const [departureDate] = useQueryState("departureDate", parseAsString.withDefault(""));
  const [fromPort] = useQueryState("from", parseAsString.withDefault(""));
  const [toPort] = useQueryState("to", parseAsString.withDefault(""));

  const { data: trip } = useTripDetailsQuery(tripId);

  // Dynamic passengers state based on count
  const [passengers, setPassengers] = useState<DetailedPassengerInput[]>(() =>
    Array.from({ length: passengerCount }, (_, i) => ({
      fullName: i === 0 ? "Mohamed Solih" : \`Traveler \${i + 1}\`,
      nationality: "Maldivian",
      passportOrId: \`A\${Math.floor(100000 + Math.random() * 900000)}\`,
      cabinClass: "STANDARD",
      luggageCount: 1
    }))
  );

  const [prevCount, setPrevCount] = useState(passengerCount);
  if (prevCount !== passengerCount) {
    setPrevCount(passengerCount);
    setPassengers((prev) =>
      Array.from({ length: passengerCount }, (_, i) => ({
        fullName: prev[i]?.fullName || (i === 0 ? "Mohamed Solih" : \`Traveler \${i + 1}\`),
        nationality: prev[i]?.nationality || "Maldivian",
        passportOrId: prev[i]?.passportOrId || \`A\${Math.floor(100000 + Math.random() * 900000)}\`,
        cabinClass: prev[i]?.cabinClass || "STANDARD",
        luggageCount: prev[i]?.luggageCount ?? 1
      }))
    );
  }

  const [leadEmail, setLeadEmail] = useState("traveler@islandhop.mv");
  const [leadPhone, setLeadPhone] = useState("+960 7712345");

  const handlePassengerChange = <K extends keyof DetailedPassengerInput>(
    index: number,
    field: K,
    value: DetailedPassengerInput[K]
  ) => {
    setPassengers((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        \`booking_\${tripId}_passengers\`,
        JSON.stringify({
          leadName: passengers[0]?.fullName || "Lead Traveler",
          leadEmail,
          leadPhone,
          passengers
        })
      );
    }

    startTransition(() => {
      router.push(
        \`/book/\${tripId}/payment?passengers=\${passengerCount}&departureDate=\${encodeURIComponent(
          departureDate
        )}&from=\${encodeURIComponent(fromPort)}&to=\${encodeURIComponent(toPort)}\`
      );
    });
  };

  // Format date display
  const effectiveDate = departureDate || (trip?.departureTime ? trip.departureTime.split("T")[0] : "");
  let formattedDate = effectiveDate;
  try {
    const d = new Date(effectiveDate);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    }
  } catch {
    formattedDate = effectiveDate;
  }

  const depTimeDisplay = trip?.departureTime
    ? new Date(trip.departureTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "";

  const sidebarTripData = {
    adultFare: trip?.adultFare ?? 25,
    departurePort: trip?.departurePort || fromPort || "Departure Port",
    arrivalPort: trip?.destinationPort || toPort || "Destination Port",
    departureTime: depTimeDisplay,
    duration: trip?.duration,
    operator: trip?.operator
  };

  return (
    <div className="dark:bg-background min-h-screen bg-[#F8FAFC] py-20">
      {/* 1. Top Stepper Header */}
      <div className="border-border/60 dark:bg-card border-b bg-white">
        <BookingStepperNav currentStep={2} />
      </div>

      {/* 2. Main Content Grid */}
      <main className="container mx-auto mt-8 max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Column: Passenger Info Form */}
          <AnimatedSection
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="space-y-6 lg:col-span-8"
          >
            {/* Header Titles */}
            <div className="space-y-1">
              <div className="text-[11px] font-extrabold tracking-wider text-[#003B95] uppercase dark:text-blue-400">
                PASSENGER INFORMATION
              </div>
              <h1 className="text-foreground text-3xl font-black tracking-tight sm:text-4xl">
                Who&apos;s travelling?
              </h1>
              <p className="text-muted-foreground text-xs sm:text-sm">
                Required for Coast Guard manifest and digital boarding pass generation.
              </p>
            </div>

            <form id="passenger-form" onSubmit={handleContinue} className="space-y-6">
              {/* Dynamic Passenger Cards */}
              {passengers.map((passenger, idx) => (
                <Card
                  key={idx}
                  className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 shadow-sm"
                >
                  <CardContent className="space-y-4 p-0">
                    <div className="text-foreground flex items-center justify-between border-l-2 border-[#003B95] pl-3 text-sm font-bold">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-[#003B95]" />
                        <span>Passenger {idx + 1} {idx === 0 && "(Lead Traveler)"}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-semibold uppercase">
                        Seat Guaranteed
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-foreground text-xs font-semibold">Full Legal Name</Label>
                        <Input
                          value={passenger.fullName}
                          onChange={(e) => handlePassengerChange(idx, "fullName", e.target.value)}
                          placeholder="e.g. Mohamed Solih"
                          required
                          className="bg-card h-11 rounded-xl text-xs font-medium"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-foreground text-xs font-semibold">Nationality</Label>
                        <Input
                          value={passenger.nationality}
                          onChange={(e) => handlePassengerChange(idx, "nationality", e.target.value)}
                          placeholder="e.g. Maldivian"
                          required
                          className="bg-card h-11 rounded-xl text-xs font-medium"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-foreground text-xs font-semibold">National ID / Passport Number</Label>
                        <Input
                          value={passenger.passportOrId}
                          onChange={(e) => handlePassengerChange(idx, "passportOrId", e.target.value)}
                          placeholder="e.g. A1234567"
                          required
                          className="bg-card h-11 rounded-xl text-xs font-medium uppercase"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-foreground text-xs font-semibold">Cabin Class</Label>
                        <select
                          value={passenger.cabinClass}
                          onChange={(e) =>
                            handlePassengerChange(
                              idx,
                              "cabinClass",
                              e.target.value as "STANDARD" | "BUSINESS" | "VIP"
                            )
                          }
                          className="w-full bg-card border border-input h-11 rounded-xl text-xs font-semibold px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="STANDARD">Standard Class (Air-conditioned)</option>
                          <option value="BUSINESS">Business Upper Deck</option>
                          <option value="VIP">VIP Lounge Cabin</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-foreground text-xs font-semibold">Luggage Allowance</Label>
                        <select
                          value={passenger.luggageCount}
                          onChange={(e) =>
                            handlePassengerChange(idx, "luggageCount", parseInt(e.target.value, 10))
                          }
                          className="w-full bg-card border border-input h-11 rounded-xl text-xs font-semibold px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value={1}>1 Check-in Bag (up to 20kg)</option>
                          <option value={2}>2 Check-in Bags (up to 40kg)</option>
                          <option value={3}>3+ Heavy Cargo / Dive Equipment</option>
                        </select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Booking Contact Card */}
              <Card className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 shadow-sm">
                <CardContent className="space-y-4 p-0">
                  <div className="space-y-1">
                    <h3 className="text-foreground text-base font-bold">Booking Contact &amp; Boarding Pass Delivery</h3>
                    <p className="text-muted-foreground text-xs">
                      We will send your digital boarding passes, gate alerts, and payment receipts here.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-foreground text-xs font-semibold">Email Address</Label>
                      <div className="relative">
                        <Mail className="text-muted-foreground absolute top-3.5 left-3.5 h-4 w-4" />
                        <Input
                          type="email"
                          value={leadEmail}
                          onChange={(e) => setLeadEmail(e.target.value)}
                          placeholder="traveler@islandhop.mv"
                          required
                          className="bg-card h-11 rounded-xl pl-10 text-xs font-medium"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-foreground text-xs font-semibold">Phone Number (with country code)</Label>
                      <div className="relative">
                        <Phone className="text-muted-foreground absolute top-3.5 left-3.5 h-4 w-4" />
                        <Input
                          type="tel"
                          value={leadPhone}
                          onChange={(e) => setLeadPhone(e.target.value)}
                          placeholder="+960 7712345"
                          required
                          className="bg-card h-11 rounded-xl pl-10 text-xs font-medium"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </form>
          </AnimatedSection>

          {/* Right Column: Sticky Summary Sidebar */}
          <AnimatedSection delay={0.08} className="lg:col-span-4">
            <div className="sticky top-24">
              <BookingSummarySidebar
                trip={sidebarTripData}
                passengerCount={passengerCount}
                departureDate={formattedDate}
                actionButton={
                  <Button
                    type="submit"
                    form="passenger-form"
                    className="h-12 w-full rounded-xl bg-[#003B95] text-xs font-bold text-white shadow-md transition-all hover:bg-[#002f77] sm:text-sm"
                  >
                    Continue to Payment <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                }
                secondaryButton={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      router.push(
                        \`/book/\${tripId}/review?passengers=\${passengerCount}&departureDate=\${encodeURIComponent(
                          departureDate
                        )}\`
                      )
                    }
                    className="border-border/80 text-muted-foreground hover:text-foreground h-11 w-full rounded-xl text-xs font-semibold"
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Review
                  </Button>
                }
              />
            </div>
          </AnimatedSection>
        </div>
      </main>
    </div>
  );
}
`;
fs.writeFileSync(passengersPagePath, passengersPageCode, 'utf8');
console.log('✓ Updated passengers/page.tsx');

// 3. Step 3: Payment Page
const paymentPagePath = path.join(
  frontendDir,
  'src',
  'app',
  '(marketing-and-booking)',
  'book',
  '[tripId]',
  'payment',
  'page.tsx'
);
const paymentPageCode = `"use client";

import { use, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Info, Lock, ShieldCheck } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { toast } from "sonner";

import { useTripDetailsQuery } from "@/hooks/use-trips";
import { useCreateBookingMutation } from "@/hooks/use-bookings";
import type { ICreateBookingPayload } from "@/types";
import { BookingStepperNav, BookingSummarySidebar } from "@/widgets";
import { AnimatedSection, Button, Card, CardContent, Input, Label } from "@/ui";

interface Step3PaymentPageProps {
  params: Promise<{ tripId: string }>;
}

export default function Step3PaymentPage({ params }: Step3PaymentPageProps) {
  const { tripId } = use(params);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [passengerCount] = useQueryState("passengers", parseAsInteger.withDefault(1));
  const [departureDate] = useQueryState("departureDate", parseAsString.withDefault(""));
  const [fromPort] = useQueryState("from", parseAsString.withDefault(""));
  const [toPort] = useQueryState("to", parseAsString.withDefault(""));

  const { data: trip } = useTripDetailsQuery(tripId);
  const createBookingMutation = useCreateBookingMutation();

  const [cardNumber, setCardNumber] = useState("4532 •••• •••• 8821");
  const [cardholderName, setCardholderName] = useState("MOHAMED SOLIH");
  const [expiryDate, setExpiryDate] = useState("12/28");
  const [cvv, setCvv] = useState("789");

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\\s+/g, "").replace(/[^0-9]/gi, "");
    const matches = v.match(/\\d{4,16}/g);
    const match = (matches && matches[0]) || "";
    const parts = [];

    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }

    return parts.length ? parts.join(" ") : value;
  };

  const handlePayAndConfirm = async (e: React.FormEvent) => {
    e.preventDefault();

    // Read saved passenger details
    let storedLeadName = "Mohamed Solih";
    let storedEmail = "traveler@islandhop.mv";
    let storedPhone = "+960 7712345";
    let storedPassengers = [
      {
        passengerName: "Mohamed Solih",
        nationality: "Maldivian",
        passportOrId: "A1234567",
        cabinClass: "STANDARD" as const,
        luggageCount: 1
      }
    ];

    if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(\`booking_\${tripId}_passengers\`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.leadName) storedLeadName = parsed.leadName;
          if (parsed.leadEmail) storedEmail = parsed.leadEmail;
          if (parsed.leadPhone) storedPhone = parsed.leadPhone;
          if (Array.isArray(parsed.passengers) && parsed.passengers.length > 0) {
            storedPassengers = parsed.passengers.map((p: any) => ({
              passengerName: p.fullName || p.passengerName || "Traveler",
              nationality: p.nationality || "Maldivian",
              passportOrId: p.passportOrId || "A998877",
              cabinClass: p.cabinClass || "STANDARD",
              luggageCount: p.luggageCount ?? 1
            }));
          }
        }
      } catch {
        // fallback
      }
    }

    const payload: ICreateBookingPayload = {
      scheduleId: tripId,
      leadPassengerName: storedLeadName,
      leadPassengerEmail: storedEmail,
      leadPassengerPhone: storedPhone,
      adultsCount: passengerCount,
      childrenCount: 0,
      passengers: storedPassengers
    };

    try {
      const response = await createBookingMutation.mutateAsync(payload);
      const bookingData = response.data;
      const ref = bookingData?.reference || "FRY-CONFIRMED";

      toast.success("Booking confirmed successfully!", {
        description: \`Reference \${ref} generated with \${bookingData?.tickets?.length || passengerCount} boarding passes.\`
      });

      startTransition(() => {
        router.push(
          \`/book/\${tripId}/confirmation?ref=\${ref}&passengers=\${passengerCount}&departureDate=\${encodeURIComponent(
            departureDate
          )}\`
        );
      });
    } catch (err: any) {
      toast.error("Payment failed", {
        description: err?.message || "Could not process booking. Please check available seats or try again."
      });
    }
  };

  const effectiveDate = departureDate || (trip?.departureTime ? trip.departureTime.split("T")[0] : "");
  let formattedDate = effectiveDate;
  try {
    const d = new Date(effectiveDate);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    }
  } catch {
    formattedDate = effectiveDate;
  }

  const depTimeDisplay = trip?.departureTime
    ? new Date(trip.departureTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "";

  const fare = trip?.adultFare ?? 25;
  const totalPrice = fare * passengerCount;

  const sidebarTripData = {
    adultFare: fare,
    departurePort: trip?.departurePort || fromPort || "Departure Port",
    arrivalPort: trip?.destinationPort || toPort || "Destination Port",
    departureTime: depTimeDisplay,
    duration: trip?.duration,
    operator: trip?.operator
  };

  const isProcessing = createBookingMutation.isPending;

  return (
    <div className="dark:bg-background min-h-screen bg-[#F8FAFC] py-20">
      {/* 1. Top Stepper Header */}
      <div className="border-border/60 dark:bg-card border-b bg-white">
        <BookingStepperNav currentStep={3} />
      </div>

      {/* 2. Main Content Grid */}
      <main className="container mx-auto mt-8 max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Column: Payment Form */}
          <AnimatedSection
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="space-y-6 lg:col-span-8"
          >
            {/* Header Titles */}
            <div className="space-y-1">
              <h1 className="text-foreground text-3xl font-black tracking-tight sm:text-4xl">
                Complete your booking
              </h1>
              <p className="text-muted-foreground text-xs sm:text-sm">
                Review your trip and complete your payment securely. Instant digital boarding passes will be issued.
              </p>
            </div>

            <form id="payment-form" onSubmit={handlePayAndConfirm} className="space-y-6">
              {/* Payment Details Card */}
              <Card className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 shadow-sm">
                <CardContent className="space-y-5 p-0">
                  <div className="text-foreground flex items-center justify-between text-base font-bold">
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-[#003B95]" />
                      <span>Credit or Debit Card</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                      <ShieldCheck className="h-4 w-4" />
                      <span>Bank-Grade 256-bit SSL</span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Card Number */}
                    <div className="space-y-1.5">
                      <Label className="text-foreground text-xs font-semibold">Card Number</Label>
                      <div className="relative">
                        <Input
                          value={cardNumber}
                          onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                          placeholder="0000 0000 0000 0000"
                          maxLength={19}
                          required
                          className="bg-card h-11 rounded-xl pr-10 text-xs font-medium font-mono"
                        />
                        <CreditCard className="text-muted-foreground absolute top-3.5 right-3.5 h-4 w-4" />
                      </div>
                    </div>

                    {/* Cardholder Name */}
                    <div className="space-y-1.5">
                      <Label className="text-foreground text-xs font-semibold">
                        Cardholder Name
                      </Label>
                      <Input
                        value={cardholderName}
                        onChange={(e) => setCardholderName(e.target.value.toUpperCase())}
                        placeholder="Name on card"
                        required
                        className="bg-card h-11 rounded-xl text-xs font-medium uppercase"
                      />
                    </div>

                    {/* Expiry & CVV */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-foreground text-xs font-semibold">Expiry Date</Label>
                        <Input
                          value={expiryDate}
                          onChange={(e) => setExpiryDate(e.target.value)}
                          placeholder="MM/YY"
                          maxLength={5}
                          required
                          className="bg-card h-11 rounded-xl text-xs font-medium font-mono"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-foreground text-xs font-semibold">CVV / CVC</Label>
                        <div className="relative">
                          <Input
                            value={cvv}
                            onChange={(e) => setCvv(e.target.value.replace(/\\D/g, ""))}
                            placeholder="123"
                            maxLength={4}
                            required
                            type="password"
                            className="bg-card h-11 rounded-xl pr-10 text-xs font-medium font-mono"
                          />
                          <Info className="text-muted-foreground absolute top-3.5 right-3.5 h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Secure Payment Guarantee */}
              <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-[#F0F7FF] p-4 text-[#003B95] dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
                <Lock className="h-5 w-5 shrink-0" />
                <div className="text-xs sm:text-sm">
                  <span className="font-bold">Sandbox / Instant Payment Active</span>
                  <div className="text-muted-foreground text-xs">
                    Upon clicking &quot;Pay &amp; Confirm Booking&quot;, your reservation is recorded directly into the Maldives Port Authority database.
                  </div>
                </div>
              </div>
            </form>
          </AnimatedSection>

          {/* Right Column: Sticky Summary Sidebar */}
          <AnimatedSection delay={0.08} className="lg:col-span-4">
            <div className="sticky top-24">
              <BookingSummarySidebar
                trip={sidebarTripData}
                passengerCount={passengerCount}
                departureDate={formattedDate}
                title="Booking Summary"
                actionButton={
                  <Button
                    type="submit"
                    form="payment-form"
                    disabled={isProcessing}
                    className="h-12 w-full rounded-xl bg-[#003B95] text-xs font-bold text-white shadow-md transition-all hover:bg-[#002f77] sm:text-sm disabled:opacity-50"
                  >
                    {isProcessing ? "Authorizing Payment & Reserving Seats..." : \`Pay \$\${totalPrice} & Confirm Booking\`}
                  </Button>
                }
                secondaryButton={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      router.push(
                        \`/book/\${tripId}/passengers?passengers=\${passengerCount}&departureDate=\${encodeURIComponent(
                          departureDate
                        )}\`
                      )
                    }
                    className="border-border/80 text-muted-foreground hover:text-foreground h-11 w-full rounded-xl text-xs font-semibold"
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Passengers
                  </Button>
                }
              />
            </div>
          </AnimatedSection>
        </div>
      </main>
    </div>
  );
}
`;
fs.writeFileSync(paymentPagePath, paymentPageCode, 'utf8');
console.log('✓ Updated payment/page.tsx');

// 4. Step 4: Confirmation Page
const confirmationPagePath = path.join(
  frontendDir,
  'src',
  'app',
  '(marketing-and-booking)',
  'book',
  '[tripId]',
  'confirmation',
  'page.tsx'
);
const confirmationPageCode = `"use client";

import { use } from "react";
import Link from "next/link";
import { Check, Download, QrCode, Ship, Ticket, User } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { QRCodeSVG } from "qrcode.react";

import { useBookingLookupQuery } from "@/hooks/use-bookings";
import { BookingStepperNav } from "@/widgets";
import { AnimatedSection, Button, Card, CardContent } from "@/ui";

interface Step4ConfirmationPageProps {
  params: Promise<{ tripId: string }>;
}

export default function Step4ConfirmationPage({ params }: Step4ConfirmationPageProps) {
  const { tripId } = use(params);
  const [bookingRef] = useQueryState("ref", parseAsString.withDefault(""));

  const { data: booking, isLoading } = useBookingLookupQuery(bookingRef);

  // Derived values from live DB booking
  const refCode = booking?.reference || bookingRef || "BK-CONFIRMED";
  const depPort = booking?.schedule?.route?.departurePort?.name || "Malé Ferry Terminal";
  const arrPort = booking?.schedule?.route?.destinationPort?.name || "Maafushi Jetty";
  const operatorName = booking?.schedule?.route?.operator?.companyName || "Atoll Ferries";
  const vesselName = booking?.schedule?.ferry?.name || "Ocean Express";
  const totalAmount = booking?.totalAmount ?? 35;
  const passengers = booking?.tickets || [];
  const status = booking?.status || "CONFIRMED";

  const departureDateDisplay = booking?.schedule?.departureTime
    ? new Date(booking.schedule.departureTime).toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
      })
    : "Departure Scheduled";

  const departureTimeDisplay = booking?.schedule?.departureTime
    ? new Date(booking.schedule.departureTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";

  const arrivalTimeDisplay = booking?.schedule?.arrivalTime
    ? new Date(booking.schedule.arrivalTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";

  return (
    <div className="dark:bg-background min-h-screen bg-[#F8FAFC] py-20">
      {/* 1. Top Stepper Header */}
      <div className="border-border/60 dark:bg-card border-b bg-white">
        <BookingStepperNav currentStep={4} />
      </div>

      {/* 2. Main Content */}
      <main className="container mx-auto mt-8 max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* Success Header Icon & Title */}
        <AnimatedSection
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          className="space-y-3 text-center"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600">
              <Check className="h-5 w-5 stroke-[3]" />
            </div>
          </div>

          <h1 className="text-foreground text-3xl font-black tracking-tight sm:text-4xl">
            Your booking is confirmed!
          </h1>
          <p className="text-muted-foreground mx-auto max-w-md text-xs sm:text-sm">
            Your digital ferry boarding pass is ready. Show your QR code at the pier gate for priority boarding.
          </p>
        </AnimatedSection>

        {/* 3. Confirmation Cards Layout */}
        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-12">
          {/* Left Column: QR Code & Reference Card */}
          <AnimatedSection delay={0.05} className="md:col-span-4">
            <Card className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 text-center shadow-sm">
              <CardContent className="space-y-5 p-0">
                <div className="space-y-1">
                  <div className="text-muted-foreground text-[10px] font-extrabold tracking-widest uppercase">
                    BOOKING REFERENCE
                  </div>
                  <div className="text-3xl font-black tracking-tight text-[#003B95] dark:text-blue-400 font-mono">
                    {refCode}
                  </div>
                </div>

                {/* QR Code */}
                <div className="border-border/80 mx-auto flex w-fit items-center justify-center rounded-2xl border bg-white p-4 shadow-inner">
                  <QRCodeSVG
                    value={\`https://islandhop.com/tickets/\${refCode}\`}
                    size={160}
                    level="H"
                    includeMargin={false}
                  />
                </div>

                {/* Actions */}
                <div className="space-y-2.5 pt-2">
                  <Button
                    asChild
                    className="h-11 w-full rounded-xl bg-[#003B95] text-xs font-bold text-white shadow-md transition-all hover:bg-[#002f77]"
                  >
                    <Link href={\`/tickets/\${refCode}\`}>
                      <Ticket className="mr-2 h-4 w-4" /> View Digital Boarding Pass
                    </Link>
                  </Button>

                  <Button
                    variant="outline"
                    asChild
                    className="border-border/80 h-11 w-full rounded-xl text-xs font-semibold"
                  >
                    <Link href={\`/manage-booking/\${refCode}\`}>Manage Booking</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </AnimatedSection>

          {/* Right Column: Trip Details & Passenger Info */}
          <AnimatedSection delay={0.08} className="space-y-6 md:col-span-8">
            {/* Trip Details Card */}
            <Card className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 shadow-sm">
              <CardContent className="space-y-6 p-0">
                <div className="border-border/60 text-foreground flex items-center justify-between border-b pb-4 text-base font-bold">
                  <div className="flex items-center gap-2">
                    <Ship className="h-4 w-4 text-[#003B95]" />
                    <span>Trip Details</span>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-600">
                    {status}
                  </span>
                </div>

                {/* Origin to Destination Track */}
                <div className="bg-muted/40 flex items-center justify-between rounded-xl p-4">
                  <div className="space-y-0.5">
                    <div className="text-muted-foreground text-[10px] font-bold uppercase">
                      Origin Port
                    </div>
                    <div className="text-foreground text-base font-bold sm:text-lg">
                      {depPort}
                    </div>
                    <div className="text-muted-foreground text-xs font-medium">
                      {departureTimeDisplay}
                    </div>
                  </div>

                  <div className="flex flex-col items-center px-4">
                    <Ship className="h-4 w-4 text-[#003B95]" />
                    <div className="text-muted-foreground mt-1 text-[11px] font-medium">
                      {departureDateDisplay}
                    </div>
                  </div>

                  <div className="space-y-0.5 text-right">
                    <div className="text-muted-foreground text-[10px] font-bold uppercase">
                      Destination Port
                    </div>
                    <div className="text-foreground text-base font-bold sm:text-lg">
                      {arrPort}
                    </div>
                    <div className="text-muted-foreground text-xs font-medium">
                      {arrivalTimeDisplay}
                    </div>
                  </div>
                </div>

                {/* Metadata Row */}
                <div className="grid grid-cols-2 gap-4 text-xs sm:text-sm">
                  <div>
                    <div className="text-muted-foreground text-[11px] font-medium">Operator &amp; Vessel</div>
                    <div className="text-foreground font-bold">{operatorName}</div>
                    <div className="text-muted-foreground text-xs">{vesselName}</div>
                  </div>

                  <div>
                    <div className="text-muted-foreground text-[11px] font-medium">Boarding Gate</div>
                    <div className="text-foreground font-bold">
                      {booking?.schedule?.gate || "Pier 1"}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {passengers.length || 1} Registered Pax
                    </div>
                  </div>
                </div>

                <div className="bg-border/60 h-[1px] w-full" />

                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-foreground text-sm font-bold">Total Paid</span>
                  <span className="text-foreground text-2xl font-black sm:text-3xl text-emerald-600">
                    \${totalAmount}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Passenger Information Card */}
            <Card className="border-border/80 dark:bg-card rounded-2xl border bg-white p-6 shadow-sm">
              <CardContent className="space-y-4 p-0">
                <div className="text-foreground flex items-center justify-between text-base font-bold">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-[#003B95]" />
                    <span>Issued Tickets ({passengers.length || 1})</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-normal">
                    Coast Guard Manifest Registered
                  </span>
                </div>

                <div className="space-y-2.5">
                  {passengers.length > 0 ? (
                    passengers.map((t, idx) => (
                      <div
                        key={t.id || idx}
                        className="bg-muted/40 text-foreground flex items-center justify-between rounded-xl p-3.5 text-xs font-semibold sm:text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-lg">
                            <Ticket className="h-4 w-4" />
                          </div>
                          <div className="space-y-0.5">
                            <div className="text-foreground font-bold">{t.passengerName}</div>
                            <div className="text-muted-foreground text-[11px]">
                              {t.nationality} &bull; ID: {t.passportOrId} &bull; {t.cabinClass}
                            </div>
                          </div>
                        </div>
                        <div className="font-mono text-xs font-extrabold text-[#003B95] dark:text-blue-400">
                          {t.ticketNumber}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="bg-muted/40 text-foreground flex items-center gap-3 rounded-xl p-3.5 text-xs font-semibold sm:text-sm">
                      <div className="bg-muted text-muted-foreground flex h-7 w-7 items-center justify-center rounded-lg">
                        <User className="h-3.5 w-3.5" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-foreground font-bold">
                          {booking?.leadPassengerName || "Lead Passenger"}
                        </div>
                        <div className="text-muted-foreground text-[10px]">
                          {booking?.leadPassengerEmail || "Registered"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </AnimatedSection>
        </div>
      </main>
    </div>
  );
}
`;
fs.writeFileSync(confirmationPagePath, confirmationPageCode, 'utf8');
console.log('✓ Updated confirmation/page.tsx');
