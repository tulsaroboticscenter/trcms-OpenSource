import { api } from "../../core/api";

export interface InvoiceCredit { amount: number; source: string; }
export interface FamilyInvoiceLine {
  enrollment_id: number; youth: string; program: string;
  fee: number; credits: InvoiceCredit[]; credit_total: number;
  balance: number; paid: number; status: string;
}
export interface FamilyInvoice {
  family_id: number; family_name: string; enrollment_year: number;
  lines: FamilyInvoiceLine[];
  gross_total: number; credits_total: number; balance_total: number;
  paid_total: number; remaining_total: number;
}

export interface SchoolInvoiceLine {
  id: number; youth: string; program: string; year: number | null;
  amount: number; status: string; note?: string | null;
}
export interface SchoolInvoice {
  school_id: number; school_name: string;
  lines: SchoolInvoiceLine[]; total: number; suggested_email?: string | null;
}

export const invoicesApi = {
  family: (familyId: number, year?: number) =>
    api.get(`/api/v1/invoices/family/${familyId}`, { params: { enrollment_year: year } }).then((r) => r.data as FamilyInvoice),
  school: (schoolId: number) =>
    api.get(`/api/v1/invoices/school/${schoolId}`).then((r) => r.data as SchoolInvoice),
  sendSchool: (schoolId: number, toEmail: string, message?: string) =>
    api.post(`/api/v1/invoices/school/${schoolId}/send`, { to_email: toEmail, message }).then((r) => r.data as { ok: boolean; sent_to: string; total: number }),
  recordSchoolPayment: (data: { school_id: number; member_id?: number | null; enrollment_id?: number | null; amount: number; note?: string }) =>
    api.post("/api/v1/school-payments", data).then((r) => r.data),
  reverseSchoolPayment: (id: number) =>
    api.post(`/api/v1/school-payments/${id}/reverse`).then((r) => r.data),
};
