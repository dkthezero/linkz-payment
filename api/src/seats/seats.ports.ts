export interface SeatWithStatus {
  id: string;
  label: string;
  price: number;
  createdAt: Date;
  reservationStatus: 'held' | 'confirmed' | null;
  /**
   * Hold expiry of the active reservation joined to this seat. `null` when the
   * seat is free, when the active row is `confirmed` (no expiry), or when the
   * held row has no TTL set. Drives the lazy read-time reaping in SeatsService.
   */
  holdExpiresAt: Date | null;
}

export interface SeatsRepository {
  findAll(): Promise<SeatWithStatus[]>;
  findById(id: string): Promise<SeatWithStatus | undefined>;
}

export const SEATS_REPOSITORY = Symbol('SEATS_REPOSITORY');
