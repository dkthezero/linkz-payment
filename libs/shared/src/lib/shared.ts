import { z } from 'zod';

export const HealthResponseSchema = z.object({ status: z.literal('ok') });

export const PricingResponseSchema = z.object({
  serviceFee: z.number().int().nonnegative(),
  currency: z.string(),
});
export type PricingResponse = z.infer<typeof PricingResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const AppUserSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().min(1),
  email: z.string().min(1),
  name: z.string().min(1),
});
export type AppUser = z.infer<typeof AppUserSchema>;

export const MeResponseSchema = z.object({
  appUserId: z.string().uuid(),
  clerkUserId: z.string().min(1),
  email: z.string().min(1),
  name: z.string().min(1),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const CreatePaymentRequestSchema = z.object({
  reservationId: z.string().uuid(),
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

export const CreatePaymentResponseSchema = z.object({
  paymentId: z.string().min(1),
  checkoutUrl: z.string().min(1),
});
export type CreatePaymentResponse = z.infer<typeof CreatePaymentResponseSchema>;

export const SeatStatusSchema = z.enum(['available', 'held', 'confirmed']);
export type SeatStatus = z.infer<typeof SeatStatusSchema>;

export const SeatResponseSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  price: z.number().int().nonnegative(),
  status: SeatStatusSchema,
});
export type SeatResponse = z.infer<typeof SeatResponseSchema>;

export const SeatListResponseSchema = z.array(SeatResponseSchema);
export type SeatListResponse = z.infer<typeof SeatListResponseSchema>;

export const CreateReservationRequestSchema = z.object({
  seatIds: z.array(z.string().uuid()).min(1),
});
export type CreateReservationRequest = z.infer<typeof CreateReservationRequestSchema>;

export const CreateReservationResponseSchema = z.object({
  reservationId: z.string().uuid(),
});
export type CreateReservationResponse = z.infer<typeof CreateReservationResponseSchema>;

export const HoldSeatRequestSchema = z.object({
  seatIds: z.array(z.string().uuid()).min(1),
});
export type HoldSeatRequest = z.infer<typeof HoldSeatRequestSchema>;

export const ReservationStatusSchema = z.enum(['held', 'confirmed', 'released', 'expired', 'refunded']);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const ReservationResponseSchema = z.object({
  id: z.string().uuid(),
  seatIds: z.array(z.string().uuid()),
  status: ReservationStatusSchema,
  expiresAt: z.string().datetime().nullable(),
});
export type ReservationResponse = z.infer<typeof ReservationResponseSchema>;

export const ReservationListResponseSchema = z.array(ReservationResponseSchema);
export type ReservationListResponse = z.infer<typeof ReservationListResponseSchema>;

export const TicketResponseSchema = z.object({
  id: z.string().uuid(),
  reservationId: z.string().uuid(),
  seatId: z.string().uuid(),
  serial: z.string().min(1),
  qrCode: z.string().nullable(),
});
export type TicketResponse = z.infer<typeof TicketResponseSchema>;

export const InvoiceResponseSchema = z.object({
  id: z.string().uuid(),
  reservationId: z.string().uuid(),
  number: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  pdfUrl: z.string().nullable(),
});
export type InvoiceResponse = z.infer<typeof InvoiceResponseSchema>;

export const PaymentSuccessRequestSchema = z.object({
  paymentId: z.string().min(1),
  reservationId: z.string().uuid(),
});
export type PaymentSuccessRequest = z.infer<typeof PaymentSuccessRequestSchema>;

export const CheckoutReviewResponseSchema = z.object({
  reservation: ReservationResponseSchema,
  seats: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string().min(1),
      descriptor: z.string(),
      price: z.number().int().nonnegative(),
    }),
  ),
  pricing: z.object({
    seatPrice: z.number().int().nonnegative(),
    serviceFee: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currency: z.string().min(1),
  }),
  contact: z.object({ email: z.string().min(1) }),
  status: ReservationStatusSchema,
});
export type CheckoutReviewResponse = z.infer<typeof CheckoutReviewResponseSchema>;

export const PaymentStatusSchema = z.enum(['pending', 'succeeded', 'failed', 'refunded']);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentResponseSchema = z.object({
  id: z.string().min(1),
  reservationId: z.string().uuid(),
  status: PaymentStatusSchema,
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
});
export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;
