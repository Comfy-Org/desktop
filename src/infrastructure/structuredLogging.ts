import type { FileTransport, MainTransports, TransformFn } from 'electron-log';
import { formatWithOptions } from 'node:util';

import { ansiCodes } from '@/utils';

export function removeAnsiCodes(x: unknown) {
  return typeof x === 'string' ? x.replaceAll(ansiCodes, '') : x;
}

export function removeAnsiCodesTransform({ data }: Parameters<TransformFn>[0]): unknown[] {
  return data.map((x) => removeAnsiCodes(x));
}

/**
 * Implements structured logging of generic objects, errors, and dates.
 * Uses compact, single-line formatting; suitable for file logging.
 *
 * Replaces the final transform on the file transport of an electron-log instance.
 * @param transport - The transport to use.
 */
export function replaceFileLoggingTransform(transports: MainTransports) {
  const { transforms } = transports.file;
  transforms.pop();
  // electron-log is poorly typed. The final transform must return a string, or the output will be wrapped in quotes.
  transforms.push(formatForFileLogging as unknown as TransformFn);
}

/**
 * Converts an array of structured data objects to a single, formatted string.
 *
 * Allows the use of `printf`-like string formatting.
 * @param data Array of data objects to stringify.
 * @param transport Electron log file transport.
 * @returns The final formatted log string.
 */
function formatForFileLogging({ data, transport }: { data: unknown[]; transport: FileTransport }) {
  const inspectOptions = transport.inspectOptions ?? {};
  const formattableData = data.map((item) => toFormattable(item));
  return formatWithOptions(inspectOptions, ...formattableData);
}

/** Convert an object that lacks a log-friendly string conversion. */
function toFormattable(item: unknown) {
  try {
    if (typeof item === 'object' && item !== null) {
      if (item instanceof Error) return item.stack;
      if (item instanceof Date) return item.toISOString();

      return JSON.stringify(item, toStringifiable);
    }
  } catch {
    // Disregard, use default.
  }

  return item;
}

/** Shallow conversion of {@link Map} and {@link Set} to objects compatible with {@link JSON.stringify}. */
function toStringifiable(_key: unknown, value: unknown) {
  if (value instanceof Map) return Object.fromEntries<Map<unknown, unknown>>(value);
  if (value instanceof Set) return [...(value as Set<unknown>)];

  return value;
}
