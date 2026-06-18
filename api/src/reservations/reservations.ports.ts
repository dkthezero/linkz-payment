export interface ReservationRow {
  id: string;
  userId: string;
  status: 'held' | 'confirmed' | 'released' | 'expired';
  sagaStep: string;
  holdExpiresAt: Date | null;
  version: number;
  createdAt: Date;
}

export interface NewReservation {
  userId: string;
  status: 'held' | 'confirmed' | 'released' | 'expired';
  sagaStep: string;
  holdExpiresAt: Date;
}

export interface RawSeat {
  id: string;
  label: string;
  price: number;
}

export interface ReservationWithSeats {
  reservation: ReservationRow;
  seats: RawSeat[];
}

export interface ReservationsRepository {
  insert(input: NewReservation, seatIds: string[]): Promise<ReservationRow>;
  findById(id: string): Promise<ReservationRow | null>;
  findWithSeats(id: string): Promise<ReservationWithSeats | null>;
  listByUser(userId: string): Promise<ReservationRow[]>;
  findSeatIds(reservationId: string): Promise<string[]>;
  confirm(id: string): Promise<void>;
  release(id: string, version: number): Promise<boolean>;
  /**
   * Free the partial-unique seat slots of any *confirmed* (paid) reservation
   * rows for the given seats so the seat can be re-held. DEMO ONLY: in
   * production a paid seat stays reserved and is shown as booked on the seat
   * map — this must not run there. Held (other-user) conflicts are intentionally
   * left alone so they still surface as a 409.
   */
  releaseConfirmedSeats(seatIds: string[]): Promise<void>;
}

export const RESERVATIONS_REPOSITORY = Symbol('RESERVATIONS_REPOSITORY');
