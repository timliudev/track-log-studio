/**
 * Backwards-compatible entry point for format recognition metadata.
 *
 * Parser implementations live with their worker-only counterparts instead;
 * keeping this module lightweight lets FileBar render without loading
 * decompression and parser code before the user chooses a file.
 */
export {
  IMPORT_FORMATS,
  allImportExtensions,
  detectImporter,
  extensionsForImporter,
  sniff,
  type ImportFormatDefinition,
} from './formatDefinitions'
