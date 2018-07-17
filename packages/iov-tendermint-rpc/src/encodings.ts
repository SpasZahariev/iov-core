import { Buffer } from "buffer";
import { ReadonlyDate } from "readonly-date";
import { isNumber } from "util";

import { Int53 } from "@iov/encoding";
import { As } from "@iov/types";

export type Base64String = string & As<"base64">;
export type HexString = string & As<"hex">;
export type IntegerString = string & As<"integer">;
export type IpPortString = string & As<"ipport">;
export type DateTimeString = string & As<"datetime">;
export type QueryString = string & As<"query">;

interface Lengther {
  readonly length: number;
}

// notEmpty throws an error if this matches the empty type for the
// given value (array/string of length 0, number of value 0, ...)
export function notEmpty<T>(value: T): T {
  if (isNumber(value) && value === 0) {
    throw new Error("must provide a non-zero value");
  } else if (((value as any) as Lengther).length === 0) {
    throw new Error("must provide a non-empty value");
  }
  return value;
}

// required can be used to anywhere to throw errors if missing before
// encoding/decoding. Works with anything with strings, arrays, or numbers
export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) {
    throw new Error("must provide a value");
  }
  return value;
}

// optional uses the value or provides a default
export function optional<T>(value: T | null | undefined, fallback: T): T {
  return value === undefined || value === null ? fallback : value;
}

// may will run the transform if value is defined, otherwise returns undefined
export function may<T, U>(transform: (val: T) => U, value: T | null | undefined): U | undefined {
  return value === undefined || value === null ? undefined : transform(value);
}

export function parseInteger(str: IntegerString): number {
  return Int53.fromString(str).asNumber();
}

export class Base64 {
  public static encode(data: Uint8Array): Base64String {
    const buf = Buffer.from(data);
    return buf.toString("base64") as Base64String;
  }

  public static decode(base64String: Base64String): Uint8Array {
    return Uint8Array.from(Buffer.from(base64String, "base64"));
  }
}

export class DateTime {
  public static encode(date: ReadonlyDate): DateTimeString {
    return date.toISOString() as DateTimeString;
  }

  public static decode(dateTimeString: DateTimeString): ReadonlyDate {
    return new ReadonlyDate(dateTimeString);
  }
}