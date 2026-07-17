import type { TextImporter } from '@/domain/import/Importer'
import { parsePlainCsv } from './parsePlainCsv'

export const csvImporter: TextImporter = {
  id: 'csv',
  extensions: ['csv'],
  detect: ({ fileName }) => fileName.endsWith('.csv'),
  parse: (text) => parsePlainCsv(text),
}
