import type { TextImporter } from '@/domain/import/Importer'
import { parseVbo } from './parseVbo'

export const vboImporter: TextImporter = {
  id: 'vbo',
  extensions: ['vbo'],
  detect: ({ fileName, headText }) => fileName.endsWith('.vbo') || /\[header\]/i.test(headText),
  parse: (text) => parseVbo(text),
}
