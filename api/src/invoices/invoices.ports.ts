export interface InvoiceRow {
  id: string;
  reservationId: string;
  number: string;
  amount: number;
  currency: string;
  pdfUrl: string | null;
  issuedAt: Date;
}

export interface NewInvoice {
  reservationId: string;
  number: string;
  amount: number;
  currency: string;
  pdfUrl: string | null;
}

export interface InvoicesRepository {
  insert(input: NewInvoice): Promise<InvoiceRow>;
  findByReservationId(reservationId: string): Promise<InvoiceRow | null>;
}

export const INVOICES_REPOSITORY = Symbol('INVOICES_REPOSITORY');
