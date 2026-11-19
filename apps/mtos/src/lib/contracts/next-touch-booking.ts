export interface NextTouchBooking {
  status: "creating" | "booked" | "unknown" | "failed";
  eventId: string;
  ownerUserId: string;
  scheduledAt: string;
  endAt: string;
  title: string;
  attendees: string[];
  description?: string;
  htmlLink?: string;
  meetLink?: string;
  bookedAt?: string;
  updatedAt?: string;
}
export interface NextTouchBookingRequest {
  action: "book" | "update";
  scheduledAt: string;
  durationMinutes: number;
  title: string;
  attendees: string[];
  description: string;
  confirmed: true;
}
export interface SharedCalendarView { day?: string; month?: string; selected?: string; fullDay?: boolean; }
