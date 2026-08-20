/**
 * Shared vocabulary of the two-stage import pipeline (B88).
 *
 * Stage 1 — recognition: `formatDefinitions.ts` holds `IMPORT_FORMATS`, a list
 * of `ImportFormatDefinition` (id / extensions / detect) built from the
 * {@link ImportCandidate} below. It is lightweight on purpose so that merely
 * rendering FileBar does not pull any parser onto the initial route.
 *
 * Stage 2 — parsing: `src/workers/parse.worker.ts` holds `WORKER_PARSERS`,
 * keyed by the same ids, calling the `parseXxx` functions off the main thread.
 *
 * M20 removed the seven pre-B88 `XxxImporter` objects (and the `TextImporter` /
 * `BinaryImporter` / `Importer` types they implemented), which bundled `detect`
 * and `parse` into one object. Nothing shipped used them, yet they carried a
 * verbatim second copy of every `detect` predicate that the tests asserted
 * against — a blind spot in front of the real registry. Do NOT reintroduce that
 * shape: register recognition in `IMPORT_FORMATS` and parsing in
 * `WORKER_PARSERS` (see docs/ARCHITECTURE-FORMATS.md §5).
 */

/** What the registry inspects before committing to a format. */
export interface ImportCandidate {
  /** Lower-cased file name, e.g. 'run01.loga'. */
  readonly fileName: string
  /** First few KB of the file decoded as text, for content sniffing. */
  readonly headText: string
  /** The same first few KB as raw bytes, for binary-format magic sniffing. */
  readonly headBytes: Uint8Array
}

/** Parse progress in [0,1], reported from the worker back to the UI. */
export type ImportProgress = (fraction: number) => void
