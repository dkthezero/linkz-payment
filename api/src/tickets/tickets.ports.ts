export interface TicketRow {
  id: string;
  reservationId: string;
  seatId: string;
  serial: string;
  qrCode: string | null;
  issuedAt: Date;
}

export interface NewTicket {
  reservationId: string;
  seatId: string;
  serial: string;
  qrCode: string | null;
}

export interface TicketsRepository {
  insert(input: NewTicket): Promise<TicketRow>;
  findByReservationId(reservationId: string): Promise<TicketRow[]>;
}

export const TICKETS_REPOSITORY = Symbol('TICKETS_REPOSITORY');
