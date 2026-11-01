const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve('..', '..', 'Frontend', 'island-hop');
console.log('Target Frontend Directory:', frontendDir);

// 1. Digital Boarding Pass: tickets/[bookingRef]/page.tsx
const ticketsPagePath = path.join(
  frontendDir,
  'src',
  'app',
  '(marketing-and-booking)',
  'tickets',
  '[bookingRef]',
  'page.tsx'
);
const ticketsPageCode = `"use client";

import { use } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  Info,
  MapPin,
  Printer,
  Sailboat,
  ShieldCheck,
  Ship,
  Ticket,
  User
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { useDigitalPassQuery } from "@/hooks/use-tickets";
import { AnimatedSection, Badge, Button, Card } from "@/ui";

interface ETicketPageProps {
  params: Promise<{ bookingRef: string }>;
}

export default function ETicketPage({ params }: ETicketPageProps) {
  const { bookingRef } = use(params);

  const { data: pass, isLoading, isError, error } = useDigitalPassQuery(bookingRef);

  if (isLoading) {
    return (
      <div className="dark:bg-background flex min-h-screen flex-col items-center justify-center bg-[#F8FAFC] px-4 py-20">
        <div className="w-full max-w-md space-y-4">
          <div className="h-8 w-48 rounded bg-muted animate-pulse" />
          <div className="h-[520px] w-full rounded-3xl bg-card border border-border animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError || !pass) {
    return (
      <div className="dark:bg-background flex min-h-screen flex-col items-center justify-center bg-[#F8FAFC] px-4 py-20">
        <Card className="w-full max-w-md p-8 text-center rounded-3xl border border-destructive/20 bg-destructive/5 space-y-4">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <h2 className="text-xl font-bold text-foreground">Boarding Pass Not Found</h2>
          <p className="text-xs text-muted-foreground">
            {error instanceof Error ? error.message : \`No active ticket found for reference \${bookingRef}.\`}
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <Button asChild className="rounded-xl">
              <Link href="/manage-booking">Search by Reference</Link>
            </Button>
            <Button variant="outline" asChild className="rounded-xl">
              <Link href="/">Back to Home</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Format date display
  const depTimeDate = pass.trip?.departureTime ? new Date(pass.trip.departureTime) : null;
  const formattedDate = depTimeDate && !isNaN(depTimeDate.getTime())
    ? depTimeDate.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
      })
    : "Scheduled Departure";

  const departureTimeDisplay = depTimeDate && !isNaN(depTimeDate.getTime())
    ? depTimeDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";

  const arrTimeDate = pass.trip?.arrivalTime ? new Date(pass.trip.arrivalTime) : null;
  const arrivalTimeDisplay = arrTimeDate && !isNaN(arrTimeDate.getTime())
    ? arrTimeDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";

  const qrPayload = pass.qrCodePayload || \`https://islandhop.com/tickets/\${pass.ticketNumber || bookingRef}\`;

  return (
    <div className="dark:bg-background flex min-h-screen flex-col items-center justify-center bg-[#F8FAFC] px-4 py-20">
      <AnimatedSection
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        className="flex w-full max-w-md flex-col items-center"
      >
        {/* Top Back and Print Actions */}
        <div className="mb-6 flex w-full items-center justify-between">
          <Button variant="ghost" size="sm" asChild className="text-xs font-semibold">
            <Link href={\`/manage-booking/\${pass.bookingReference}\`}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Manage Booking
            </Link>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5 text-xs font-semibold"
              onClick={() => window.print()}
              title="Print Boarding Pass"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print</span>
            </Button>
          </div>
        </div>

        <h1 className="text-foreground mb-4 text-2xl font-black tracking-tight sm:text-3xl text-center">
          Digital Boarding Pass
        </h1>
        <p className="text-muted-foreground mb-6 text-xs text-center max-w-xs">
          Maldives Transport &amp; Coast Guard approved digital travel document.
        </p>

        {/* Boarding Pass Ticket Container */}
        <div className="border-border/80 dark:bg-card w-full overflow-hidden rounded-3xl border bg-white shadow-xl">
          {/* Top Navy Blue Header Section */}
          <div className="bg-[#002244] p-6 text-white dark:bg-[#00172e]">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-3 py-1 text-[10px] font-bold tracking-widest uppercase">
                {pass.boardingStatus || "CONFIRMED"}
              </span>
              <span className="font-mono text-xs font-semibold text-white/80">
                Ref: {pass.bookingReference}
              </span>
            </div>

            {/* Route Header */}
            <div className="mt-6 flex items-center justify-between">
              <div className="space-y-0.5 text-left max-w-[130px]">
                <div className="text-[10px] uppercase font-bold text-white/70">Origin</div>
                <div className="text-xl font-black tracking-tight truncate">{pass.trip.departurePort}</div>
              </div>

              <div className="flex flex-1 items-center justify-center px-3">
                <div className="relative flex w-full items-center">
                  <div className="h-[2px] w-full border-t border-dashed border-white/40" />
                  <Sailboat className="absolute left-1/2 h-5 w-5 -translate-x-1/2 text-white" />
                  <div className="absolute right-0 h-2 w-2 rounded-full bg-white" />
                </div>
              </div>

              <div className="space-y-0.5 text-right max-w-[130px]">
                <div className="text-[10px] uppercase font-bold text-white/70">Destination</div>
                <div className="text-xl font-black tracking-tight truncate">{pass.trip.destinationPort}</div>
              </div>
            </div>

            {/* Departure Date & Time */}
            <div className="mt-6 flex items-center justify-between text-xs text-white/90 border-t border-white/10 pt-3">
              <div className="flex items-center gap-1.5 font-medium">
                <Calendar className="h-3.5 w-3.5" />
                <span>{formattedDate}</span>
              </div>
              <div className="flex items-center gap-1.5 font-bold">
                <Clock className="h-3.5 w-3.5" />
                <span>{departureTimeDisplay} &rarr; {arrivalTimeDisplay}</span>
              </div>
            </div>
          </div>

          {/* Dashed Tear-Off Separator */}
          <div className="dark:bg-card relative flex items-center justify-between bg-white px-2 py-3">
            <div className="dark:bg-background h-6 w-3 -translate-x-3 rounded-r-full bg-[#F8FAFC]" />
            <div className="border-border h-[1.5px] w-full border-t-2 border-dashed" />
            <div className="dark:bg-background h-6 w-3 translate-x-3 rounded-l-full bg-[#F8FAFC]" />
          </div>

          {/* Ticket Body: Details */}
          <div className="space-y-4 px-6 py-2">
            {/* Passenger & Ticket Number */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-muted-foreground text-[10px] font-bold uppercase">Passenger</div>
                <div className="text-foreground font-bold text-sm truncate">{pass.passengerName}</div>
                <div className="text-muted-foreground text-[11px]">
                  {pass.nationality} &bull; {pass.passportOrId}
                </div>
              </div>

              <div className="space-y-1 text-right">
                <div className="text-muted-foreground text-[10px] font-bold uppercase">Ticket Number</div>
                <div className="text-[#003B95] dark:text-blue-400 font-mono font-bold text-xs">
                  {pass.ticketNumber}
                </div>
                <div className="text-muted-foreground text-[11px]">
                  {pass.cabinClass} &bull; {pass.luggageCount} Bag
                </div>
              </div>
            </div>

            {/* Operator & Vessel */}
            <div className="grid grid-cols-2 gap-4 border-t border-border/60 pt-3">
              <div className="space-y-0.5">
                <div className="text-muted-foreground text-[10px] font-bold uppercase">Ferry Operator</div>
                <div className="text-foreground flex items-center gap-1.5 font-bold text-xs">
                  <Ship className="h-3.5 w-3.5 text-[#003B95]" />
                  <span>{pass.trip.operatorName}</span>
                </div>
              </div>

              <div className="space-y-0.5 text-right">
                <div className="text-muted-foreground text-[10px] font-bold uppercase">Vessel &amp; Gate</div>
                <div className="text-foreground font-bold text-xs">{pass.trip.vesselName}</div>
                <div className="text-muted-foreground text-[11px]">Gate: {pass.trip.gate || "Pier 1"}</div>
              </div>
            </div>
          </div>

          {/* Dashed Separator 2 */}
          <div className="dark:bg-card relative flex items-center justify-between bg-white px-2 py-3">
            <div className="dark:bg-background h-6 w-3 -translate-x-3 rounded-r-full bg-[#F8FAFC]" />
            <div className="border-border h-[1.5px] w-full border-t-2 border-dashed" />
            <div className="dark:bg-background h-6 w-3 translate-x-3 rounded-l-full bg-[#F8FAFC]" />
          </div>

          {/* QR Code Section */}
          <div className="px-6 pt-2 pb-8 text-center space-y-3">
            <div className="text-muted-foreground text-[11px] font-semibold">
              Scan barcode at turnstile or hand to crew
            </div>

            <div className="border-border/60 mx-auto flex w-fit items-center justify-center rounded-2xl border bg-white p-3 shadow-xs">
              <QRCodeSVG
                value={qrPayload}
                size={180}
                level="H"
                includeMargin={false}
              />
            </div>

            <div className="text-foreground font-mono text-xs font-black tracking-widest uppercase">
              {pass.ticketNumber}
            </div>

            <div className="pt-2 flex items-center justify-center gap-2 text-[11px] text-emerald-600 font-semibold">
              <ShieldCheck className="h-4 w-4" />
              <span>Valid for departure on {formattedDate}</span>
            </div>
          </div>
        </div>
      </AnimatedSection>
    </div>
  );
}
`;
fs.writeFileSync(ticketsPagePath, ticketsPageCode, 'utf8');
console.log('✓ Updated tickets/[bookingRef]/page.tsx');

// 2. Booking Management Details: manage-booking/[bookingRef]/page.tsx
const manageDetailsPagePath = path.join(
  frontendDir,
  'src',
  'app',
  '(marketing-and-booking)',
  '(private)',
  'manage-booking',
  '[bookingRef]',
  'page.tsx'
);
const manageDetailsPageCode = `"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Edit,
  HelpCircle,
  Info,
  LifeBuoy,
  Phone,
  QrCode,
  Shield,
  Ship,
  Ticket,
  User,
  XCircle
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { useBookingLookupQuery, useCancelBookingMutation } from "@/hooks/use-bookings";
import {
  AnimatedSection,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/ui";

interface BookingDetailsPageProps {
  params: Promise<{ bookingRef: string }>;
}

export default function BookingDetailsPage({ params }: BookingDetailsPageProps) {
  const { bookingRef } = use(params);

  const { data: booking, isLoading, isError, error, refetch } = useBookingLookupQuery(bookingRef);
  const cancelBookingMutation = useCancelBookingMutation();

  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);

  const handleConfirmCancel = async () => {
    if (!booking) return;
    try {
      await cancelBookingMutation.mutateAsync({
        bookingId: booking.id,
        reason: "Customer cancellation from self-service portal"
      });
      toast.success("Booking cancelled successfully", {
        description: "Your reservation has been released."
      });
      setIsCancelDialogOpen(false);
      void refetch();
    } catch (err: any) {
      toast.error("Cancellation failed", {
        description: err?.message || "Could not cancel booking at this time."
      });
    }
  };

  if (isLoading) {
    return (
      <div className="dark:bg-background min-h-screen bg-[#F8FAFC] pb-24 pt-8">
        <main className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="h-6 w-36 rounded bg-muted animate-pulse" />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="lg:col-span-8 space-y-6">
              <Card className="h-64 rounded-3xl bg-card border border-border animate-pulse" />
            </div>
            <div className="lg:col-span-4 space-y-6">
              <Card className="h-64 rounded-3xl bg-card border border-border animate-pulse" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (isError || !booking) {
    return (
      <div className="dark:bg-background min-h-screen bg-[#F8FAFC] pb-24 pt-16">
        <main className="container mx-auto max-w-xl px-4 text-center">
          <Card className="p-8 rounded-3xl border border-destructive/20 bg-destructive/5 space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <h2 className="text-xl font-bold text-foreground">Booking Not Found</h2>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : \`No booking matching reference "\${bookingRef}" was found.\`}
            </p>
            <div className="pt-2 flex justify-center gap-3">
              <Button asChild className="rounded-xl">
                <Link href="/manage-booking">Search My Bookings</Link>
              </Button>
              <Button variant="outline" asChild className="rounded-xl">
                <Link href="/book">Book a Ferry</Link>
              </Button>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  const depPort = booking.schedule?.route?.departurePort?.name || "Malé Ferry Terminal";
  const arrPort = booking.schedule?.route?.destinationPort?.name || "Maafushi Jetty";
  const operatorName = booking.schedule?.route?.operator?.companyName || "Atoll Ferries";
  const vesselName = booking.schedule?.ferry?.name || "Ocean Express";
  const vesselType = booking.schedule?.ferry?.type || "Highspeed Speedboat";
  const tickets = booking.tickets || [];
  const totalAmount = booking.totalAmount ?? 0;
  const isCancelled = booking.status === "CANCELLED";

  const departureDateDisplay = booking.schedule?.departureTime
    ? new Date(booking.schedule.departureTime).toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
      })
    : "Scheduled";

  const departureTimeDisplay = booking.schedule?.departureTime
    ? new Date(booking.schedule.departureTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";

  const arrivalTimeDisplay = booking.schedule?.arrivalTime
    ? new Date(booking.schedule.arrivalTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })
    : "TBD";

  return (
    <div className="dark:bg-background min-h-screen bg-[#F8FAFC] pb-24">
      <main className="container mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        {/* Back Button */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="text-xs font-semibold">
            <Link href="/manage-booking">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to My Bookings
            </Link>
          </Button>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Main Column (8 cols) */}
          <AnimatedSection
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="space-y-6 lg:col-span-8"
          >
            {/* 1. Trip Information Card */}
            <Card className="border-border/80 dark:bg-card rounded-3xl border bg-white p-6 shadow-sm sm:p-7">
              <CardContent className="space-y-6 p-0">
                {/* Header */}
                <div className="border-border/60 flex items-center justify-between border-b pb-4">
                  <div className="text-foreground flex items-center gap-2 text-sm font-bold">
                    <Ship className="h-4 w-4 text-[#003B95] dark:text-blue-400" />
                    <span>Trip Information</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      isCancelled
                        ? "border-destructive/30 bg-destructive/10 text-destructive text-[10px] font-bold"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-[10px] font-bold"
                    }
                  >
                    {booking.status}
                  </Badge>
                </div>

                {/* Operator Logo & Name */}
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#003B95] text-white shadow-sm">
                    <Ship className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-foreground text-lg font-bold">{operatorName}</h3>
                    <p className="text-muted-foreground text-xs">{vesselName} &bull; {vesselType}</p>
                  </div>
                </div>

                {/* Departure / Arrival Timeline */}
                <div className="bg-muted/30 rounded-2xl p-5">
                  <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-12">
                    {/* Departure */}
                    <div className="sm:col-span-5">
                      <div className="text-muted-foreground text-[10px] font-extrabold tracking-wider uppercase">
                        DEPARTURE
                      </div>
                      <div className="text-muted-foreground text-xs font-semibold">
                        {departureDateDisplay}
                      </div>
                      <div className="mt-1 text-2xl font-black tracking-tight text-[#003B95] dark:text-blue-400">
                        {departureTimeDisplay}
                      </div>
                      <div className="text-foreground text-sm font-bold">{depPort}</div>
                    </div>

                    {/* Duration / Arrow Track */}
                    <div className="flex flex-col items-center justify-center sm:col-span-2">
                      <div className="text-muted-foreground text-[10px] font-bold">
                        {booking.schedule?.route?.durationMinutes || 45}m
                      </div>
                      <div className="relative my-2 flex w-full max-w-[80px] items-center">
                        <div className="bg-primary h-1.5 w-1.5 rounded-full" />
                        <div className="border-border h-[1.5px] flex-1 border-t-2 border-dotted" />
                        <Ship className="text-primary h-3.5 w-3.5" />
                        <div className="border-border h-[1.5px] flex-1 border-t-2 border-dotted" />
                        <div className="bg-primary h-1.5 w-1.5 rounded-full" />
                      </div>
                    </div>

                    {/* Arrival */}
                    <div className="sm:col-span-5 sm:text-right">
                      <div className="text-muted-foreground text-[10px] font-extrabold tracking-wider uppercase">
                        ARRIVAL
                      </div>
                      <div className="text-muted-foreground text-xs font-semibold">
                        {departureDateDisplay}
                      </div>
                      <div className="mt-1 text-2xl font-black tracking-tight text-[#003B95] dark:text-blue-400">
                        {arrivalTimeDisplay}
                      </div>
                      <div className="text-foreground text-sm font-bold">{arrPort}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. Issued Passenger Tickets */}
            <Card className="border-border/80 dark:bg-card rounded-3xl border bg-white p-6 shadow-sm sm:p-7">
              <CardContent className="space-y-4 p-0">
                <div className="border-border/60 text-foreground flex items-center justify-between border-b pb-3 text-sm font-bold">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-[#003B95] dark:text-blue-400" />
                    <span>Passengers &amp; Boarding Passes ({tickets.length || 1})</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-normal">
                    Gate: {booking.schedule?.gate || "Pier 1"}
                  </span>
                </div>

                <div className="space-y-3">
                  {tickets.map((t, idx) => (
                    <div
                      key={t.id || idx}
                      className="flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-xl border border-border/70 bg-card"
                    >
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-extrabold uppercase text-muted-foreground">
                          PASSENGER {idx + 1}
                        </div>
                        <div className="text-sm font-bold text-foreground">{t.passengerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.nationality} &bull; ID: {t.passportOrId} &bull; {t.cabinClass}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-[10px] font-extrabold uppercase text-muted-foreground">TICKET #</div>
                          <div className="font-mono text-xs font-bold text-[#003B95] dark:text-blue-400">
                            {t.ticketNumber}
                          </div>
                        </div>

                        <Button size="sm" variant="outline" asChild className="rounded-xl text-xs gap-1.5">
                          <Link href={\`/tickets/\${t.ticketNumber}\`}>
                            <Ticket className="h-3.5 w-3.5" />
                            <span>Digital Pass</span>
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 3. Master E-Ticket QR */}
            <Card className="border-border/80 dark:bg-card rounded-3xl border bg-white p-6 shadow-sm sm:p-7">
              <CardContent className="space-y-5 p-0">
                <div className="space-y-1">
                  <div className="text-foreground flex items-center gap-2 text-sm font-bold">
                    <QrCode className="h-4 w-4 text-[#003B95] dark:text-blue-400" />
                    <span>Master Boarding Pass QR</span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Scan at the terminal gate for immediate party check-in.
                  </p>
                </div>

                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                  {/* QR Box */}
                  <div className="border-border/80 flex w-fit items-center justify-center rounded-2xl border bg-white p-3 shadow-inner">
                    <QRCodeSVG
                      value={\`https://islandhop.com/tickets/\${booking.reference}\`}
                      size={140}
                      level="H"
                      includeMargin={false}
                    />
                  </div>

                  {/* Reference & Info Box */}
                  <div className="flex-1 space-y-4">
                    <div className="space-y-1">
                      <div className="text-muted-foreground text-[10px] font-extrabold tracking-wider uppercase">
                        BOOKING REFERENCE
                      </div>
                      <div className="text-foreground font-mono text-2xl font-black tracking-tight">
                        {booking.reference}
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 rounded-2xl border border-blue-100 bg-[#F0F7FF] p-3 text-xs text-[#003B95] dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>Carry digital or printed QR pass along with official photo ID.</span>
                    </div>

                    <Button
                      variant="outline"
                      asChild
                      className="dark:hover:bg-card h-10 rounded-xl border-[#003B95]/40 text-xs font-bold text-[#003B95] hover:bg-blue-50 dark:text-blue-300"
                    >
                      <Link href={\`/tickets/\${booking.reference}\`}>
                        <Download className="mr-2 h-4 w-4" /> Download All E-Tickets
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </AnimatedSection>

          {/* Right Sidebar Column (4 cols) */}
          <AnimatedSection delay={0.08} className="space-y-6 lg:col-span-4">
            {/* 1. Payment Summary Card */}
            <Card className="border-border/80 dark:bg-card rounded-3xl border bg-white p-6 shadow-sm sm:p-7">
              <CardContent className="space-y-4 p-0">
                <div className="border-border/60 text-foreground flex items-center gap-2 border-b pb-3 text-sm font-bold">
                  <CreditCard className="h-4 w-4 text-[#003B95] dark:text-blue-400" />
                  <span>Payment Summary</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="text-muted-foreground flex items-center justify-between">
                    <span>Fare ({tickets.length || 1} Passengers)</span>
                    <span className="text-foreground font-semibold">
                      \${totalAmount}
                    </span>
                  </div>

                  <div className="border-border/60 flex items-baseline justify-between border-t pt-3">
                    <span className="text-foreground text-sm font-bold">Total Paid</span>
                    <span className="text-2xl font-black text-[#003B95] dark:text-blue-400">
                      \${totalAmount}
                    </span>
                  </div>
                </div>

                {/* Paid Badge Box */}
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="space-y-0.5">
                    <div className="text-[10px] font-extrabold tracking-wide uppercase">
                      {booking.payment?.status || "PAID & VERIFIED"}
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      {booking.payment?.paymentMethod || "CARD"} &bull; Ref: {booking.reference}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. Actions (Change / Cancel Booking) */}
            <Card className="border-border/80 dark:bg-card rounded-3xl border bg-white p-6 shadow-sm sm:p-7">
              <CardContent className="space-y-3 p-0">
                <h4 className="text-foreground text-sm font-bold">Booking Actions</h4>

                <div className="space-y-2">
                  <Link
                    href="/book"
                    className="border-border/80 text-foreground hover:bg-muted/40 flex items-center justify-between rounded-2xl border p-3.5 text-xs font-bold transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Edit className="text-muted-foreground h-3.5 w-3.5" />
                        <span>Book Additional Transfers</span>
                      </div>
                      <div className="text-muted-foreground text-[10px] font-normal">
                        Browse all scheduled inter-atoll sailings.
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                  </Link>

                  <button
                    type="button"
                    disabled={isCancelled || cancelBookingMutation.isPending}
                    onClick={() => setIsCancelDialogOpen(true)}
                    className="border-border/80 text-destructive hover:bg-destructive/5 flex w-full items-center justify-between rounded-2xl border p-3.5 text-left text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-3.5 w-3.5" />
                        <span>{isCancelled ? "Booking Cancelled" : "Cancel Booking"}</span>
                      </div>
                      <div className="text-muted-foreground text-[10px] font-normal">
                        Release seats and cancel itinerary.
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          </AnimatedSection>
        </div>
      </main>

      {/* Cancellation Confirmation Dialog */}
      <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Booking</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel booking{" "}
              <span className="text-foreground font-mono font-bold">{booking.reference}</span>? Your
              seat reservation will be released back to the vessel schedule.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline" size="sm" className="rounded-xl text-xs font-semibold">
                Keep Booking
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={cancelBookingMutation.isPending}
              onClick={handleConfirmCancel}
              className="rounded-xl text-xs font-bold"
            >
              {cancelBookingMutation.isPending ? "Cancelling..." : "Confirm Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
`;
fs.writeFileSync(manageDetailsPagePath, manageDetailsPageCode, 'utf8');
console.log('✓ Updated manage-booking/[bookingRef]/page.tsx');
