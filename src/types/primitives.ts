/** Serializable primitives shared by the app and its server boundary. */
export type EntityId = string;
export type ISODate = string;
export type ISODateTime = string;
export type CurrencyCode = "USD";
export type MoneyCents = number;
export type Percentage = number;

export interface RecordIdentity {
  id: EntityId;
  organizationId: EntityId;
}

export interface LocationScoped {
  locationId: EntityId;
}

export interface Timestamped {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SoftDeletable {
  archivedAt: ISODateTime | null;
}

export interface DateRange {
  startsOn: ISODate;
  endsOn: ISODate;
}

export interface TimeRange {
  startsAt: ISODateTime;
  endsAt: ISODateTime;
}

export interface PostalAddress {
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  countryCode: "US";
}

export interface FileReference {
  id: EntityId;
  bucket: string;
  objectPath: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  uploadedBy: EntityId;
  uploadedAt: ISODateTime;
  /** Private objects are resolved to short-lived signed URLs at request time. */
  access: "private";
}

export interface MoneyAmount {
  amountCents: MoneyCents;
  currency: CurrencyCode;
}
