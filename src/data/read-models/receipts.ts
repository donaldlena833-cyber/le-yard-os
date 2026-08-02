import "server-only";

import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { createClient } from "@/lib/supabase/server";

export interface LiveReceiptFile {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
}

export interface LiveReceiptExtraction {
  fieldName: string;
  value: string;
  confidence: number | null;
  reviewStatus: string;
}

export interface LiveReceiptDuplicateMatch {
  id: string;
  possibleDuplicateId: string;
  score: number;
  reasons: string[];
  resolution: string | null;
}

export interface LiveReceiptRow {
  id: string;
  vendorId: string | null;
  expenseCategoryId: string | null;
  documentKind: string;
  documentNumber: string | null;
  documentDate: string | null;
  totalCents: number | null;
  taxCents: number | null;
  reviewStatus: string;
  source: string;
  notes: string | null;
  createdAt: string;
  duplicateCount: number;
  duplicateMatches: LiveReceiptDuplicateMatch[];
  files: LiveReceiptFile[];
  extractions: LiveReceiptExtraction[];
}

export interface LiveReceiptOption {
  id: string;
  name: string;
}

export interface LiveReceiptReferenceOption {
  id: string;
  label: string;
  receiptId: string | null;
}

export const RECEIPTS_PAGE_SIZE = 50;
export const RECEIPT_REFERENCE_WINDOW_SIZE = 150;

export type LiveReceiptsModel =
  | {
      status: "ready";
      currencyCode: string;
      timeZone: string;
      receipts: LiveReceiptRow[];
      vendors: LiveReceiptOption[];
      categories: LiveReceiptOption[];
      expenses: LiveReceiptReferenceOption[];
      deliveries: LiveReceiptReferenceOption[];
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      hasPreviousPage: boolean;
      hasNextPage: boolean;
      referenceWindowSize: number;
    }
  | { status: "forbidden" | "error" };

interface DbReceipt {
  id: string;
  vendor_id: string | null;
  expense_category_id: string | null;
  document_kind: string;
  document_number: string | null;
  document_date: string | null;
  total_cents: number | null;
  tax_cents: number | null;
  review_status: string;
  source: string;
  notes: string | null;
  created_at: string;
}

interface DbReceiptFile {
  id: string;
  receipt_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
}

interface DbExtraction {
  receipt_id: string;
  field_name: string;
  extracted_value: unknown;
  normalized_value: unknown;
  confidence: number | null;
  review_status: string;
}

interface DbDuplicateMatch {
  id: string;
  receipt_id: string;
  possible_duplicate_id: string;
  score: number;
  reasons: unknown;
  resolution: string | null;
}

function displayExtractionValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value == null) return "Not detected";
  return JSON.stringify(value).slice(0, 240);
}

export async function loadLiveReceipts(
  search = "",
  requestedPage = 1,
): Promise<LiveReceiptsModel> {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") {
    return { status: "error" };
  }
  if (resolution.context.role === "employee") return { status: "forbidden" };

  const workspace = resolution.context;
  const supabase = await createClient();
  const normalizedSearch = search.trim().slice(0, 120);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  const offset = (page - 1) * RECEIPTS_PAGE_SIZE;
  let receiptsQuery = supabase
    .from("receipts")
    .select(
      "id, vendor_id, expense_category_id, document_kind, document_number, document_date, total_cents, tax_cents, review_status, source, notes, created_at",
      { count: "exact" },
    )
    .eq("organization_id", workspace.organization.id)
    .eq("location_id", workspace.activeLocation.id)
    .order("created_at", { ascending: false });
  if (normalizedSearch) {
    receiptsQuery = receiptsQuery.textSearch("search_vector", normalizedSearch, {
      config: "english",
      type: "websearch",
    });
  }
  const [
    receiptResult,
    vendorResult,
    categoryResult,
    expenseResult,
    deliveryResult,
    organizationResult,
    locationResult,
  ] = await Promise.all([
    receiptsQuery.range(offset, offset + RECEIPTS_PAGE_SIZE - 1),
    supabase
      .from("vendors")
      .select("id, name")
      .eq("organization_id", workspace.organization.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("expense_categories")
      .select("id, name")
      .eq("organization_id", workspace.organization.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("expenses")
      .select("id, receipt_id, expense_date, description, total_cents")
      .eq("organization_id", workspace.organization.id)
      .eq("location_id", workspace.activeLocation.id)
      .is("receipt_id", null)
      .order("expense_date", { ascending: false })
      .limit(RECEIPT_REFERENCE_WINDOW_SIZE),
    supabase
      .from("deliveries")
      .select("id, receipt_id, invoice_number, delivered_at")
      .eq("organization_id", workspace.organization.id)
      .eq("location_id", workspace.activeLocation.id)
      .is("receipt_id", null)
      .order("delivered_at", { ascending: false })
      .limit(RECEIPT_REFERENCE_WINDOW_SIZE),
    supabase
      .from("organizations")
      .select("currency_code")
      .eq("id", workspace.organization.id)
      .single(),
    supabase
      .from("locations")
      .select("timezone")
      .eq("organization_id", workspace.organization.id)
      .eq("id", workspace.activeLocation.id)
      .single(),
  ]);

  if (
    receiptResult.error ||
    vendorResult.error ||
    categoryResult.error ||
    expenseResult.error ||
    deliveryResult.error ||
    organizationResult.error ||
    locationResult.error
  ) {
    return { status: "error" };
  }

  const receipts = (receiptResult.data ?? []) as unknown as DbReceipt[];
  const receiptIds = receipts.map((receipt) => receipt.id);
  const [
    fileResult,
    extractionResult,
    duplicateResult,
    linkedExpenseResult,
    linkedDeliveryResult,
  ] = receiptIds.length
    ? await Promise.all([
        supabase
          .from("receipt_files")
          .select("id, receipt_id, storage_path, file_name, mime_type, size_bytes")
          .in("receipt_id", receiptIds),
        supabase
          .from("receipt_extractions")
          .select(
            "receipt_id, field_name, extracted_value, normalized_value, confidence, review_status",
          )
          .in("receipt_id", receiptIds),
        supabase
          .from("receipt_duplicate_matches")
          .select("id, receipt_id, possible_duplicate_id, score, reasons, resolution")
          .in("receipt_id", receiptIds)
          .order("score", { ascending: false }),
        supabase
          .from("expenses")
          .select("id, receipt_id, expense_date, description, total_cents")
          .eq("organization_id", workspace.organization.id)
          .eq("location_id", workspace.activeLocation.id)
          .in("receipt_id", receiptIds),
        supabase
          .from("deliveries")
          .select("id, receipt_id, invoice_number, delivered_at")
          .eq("organization_id", workspace.organization.id)
          .eq("location_id", workspace.activeLocation.id)
          .in("receipt_id", receiptIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (
    fileResult.error ||
    extractionResult.error ||
    duplicateResult.error ||
    linkedExpenseResult.error ||
    linkedDeliveryResult.error
  ) {
    return { status: "error" };
  }

  const files = (fileResult.data ?? []) as unknown as DbReceiptFile[];
  const extractions = (extractionResult.data ?? []) as unknown as DbExtraction[];
  const duplicateMatches = (duplicateResult.data ?? []) as unknown as DbDuplicateMatch[];
  const duplicateCounts = new Map<string, number>();
  for (const duplicate of duplicateMatches.filter((match) => match.resolution === null)) {
    duplicateCounts.set(
      duplicate.receipt_id,
      (duplicateCounts.get(duplicate.receipt_id) ?? 0) + 1,
    );
  }

  return {
    status: "ready",
    currencyCode: organizationResult.data.currency_code,
    timeZone: locationResult.data.timezone,
    page,
    pageSize: RECEIPTS_PAGE_SIZE,
    totalCount: receiptResult.count ?? receipts.length,
    totalPages: Math.max(
      1,
      Math.ceil((receiptResult.count ?? receipts.length) / RECEIPTS_PAGE_SIZE),
    ),
    hasPreviousPage: page > 1,
    hasNextPage: offset + receipts.length < (receiptResult.count ?? receipts.length),
    referenceWindowSize: RECEIPT_REFERENCE_WINDOW_SIZE,
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      vendorId: receipt.vendor_id,
      expenseCategoryId: receipt.expense_category_id,
      documentKind: receipt.document_kind,
      documentNumber: receipt.document_number,
      documentDate: receipt.document_date,
      totalCents: receipt.total_cents == null ? null : Number(receipt.total_cents),
      taxCents: receipt.tax_cents == null ? null : Number(receipt.tax_cents),
      reviewStatus: receipt.review_status,
      source: receipt.source,
      notes: receipt.notes,
      createdAt: receipt.created_at,
      duplicateCount: duplicateCounts.get(receipt.id) ?? 0,
      duplicateMatches: duplicateMatches
        .filter((match) => match.receipt_id === receipt.id)
        .map((match) => ({
          id: match.id,
          possibleDuplicateId: match.possible_duplicate_id,
          score: Number(match.score),
          reasons: Array.isArray(match.reasons)
            ? match.reasons.filter((reason): reason is string => typeof reason === "string")
            : [],
          resolution: match.resolution,
        })),
      files: files
        .filter((file) => file.receipt_id === receipt.id)
        .map((file) => ({
          id: file.id,
          storagePath: file.storage_path,
          fileName: file.file_name,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes == null ? null : Number(file.size_bytes),
        })),
      extractions: extractions
        .filter((extraction) => extraction.receipt_id === receipt.id)
        .map((extraction) => ({
          fieldName: extraction.field_name,
          value: displayExtractionValue(
            extraction.normalized_value ?? extraction.extracted_value,
          ),
          confidence:
            extraction.confidence == null ? null : Number(extraction.confidence),
          reviewStatus: extraction.review_status,
        })),
    })),
    vendors: ((vendorResult.data ?? []) as unknown as Array<{ id: string; name: string }>).map(
      (vendor) => ({ id: vendor.id, name: vendor.name }),
    ),
    categories: ((categoryResult.data ?? []) as unknown as Array<{
      id: string;
      name: string;
    }>).map((category) => ({ id: category.id, name: category.name })),
    expenses: ([
      ...(expenseResult.data ?? []),
      ...(linkedExpenseResult.data ?? []),
    ] as unknown as Array<{
      id: string;
      receipt_id: string | null;
      expense_date: string;
      description: string | null;
      total_cents: number;
    }>).map((expense) => ({
      id: expense.id,
      receiptId: expense.receipt_id,
      label: `${expense.expense_date} · ${expense.description?.trim() || "Expense"} · ${new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: organizationResult.data.currency_code,
      }).format(Number(expense.total_cents) / 100)}`,
    })),
    deliveries: ([
      ...(deliveryResult.data ?? []),
      ...(linkedDeliveryResult.data ?? []),
    ] as unknown as Array<{
      id: string;
      receipt_id: string | null;
      invoice_number: string | null;
      delivered_at: string;
    }>).map((delivery) => ({
      id: delivery.id,
      receiptId: delivery.receipt_id,
      label: `${delivery.invoice_number?.trim() || "Delivery"} · ${new Date(delivery.delivered_at).toLocaleDateString("en-US", { timeZone: locationResult.data.timezone })}`,
    })),
  };
}
