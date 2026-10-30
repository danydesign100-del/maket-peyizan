// Spreadsheet reading and templates. SheetJS is loaded on demand so that it
// only weighs on the pages where someone actually imports a file.
export type SheetCell = string | number | boolean | Date | null
export type SheetData = { headers: string[]; rows: SheetCell[][]; sheetName: string }

export const ACCEPTED_FILES = '.xlsx,.xls,.csv,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const MAX_FILE_SIZE = 10 * 1024 * 1024

/** Reads the first sheet; the first non-empty row is taken as the header row. */
export async function readSpreadsheet(file: File): Promise<SheetData> {
  if (file.size > MAX_FILE_SIZE) throw new Error('Le fichier dépasse 10 Mo.')
  const XLSX = await import('xlsx')
  // In CSV text SheetJS would read 05/08/2026 as US month/day; keep the text and let
  // parseDate read it as day/month, the format used in Haiti.
  const isText = /\.(csv|txt)$/i.test(file.name) || file.type.startsWith('text/')
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, dense: true, raw: isText })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Le fichier ne contient aucune feuille.')
  const matrix = XLSX.utils.sheet_to_json<SheetCell[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: false })
  const headerIndex = matrix.findIndex((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
  if (headerIndex < 0) throw new Error('La feuille est vide.')
  const headers = matrix[headerIndex].map((cell, index) => String(cell ?? '').trim() || `Colonne ${index + 1}`)
  const rows = matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
  return { headers, rows, sheetName }
}

/** Downloads an .xlsx template with a header row and one example row. */
export async function downloadTemplate(fileName: string, headers: string[], example: SheetCell[]) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([headers, example])
  sheet['!cols'] = headers.map((header) => ({ wch: Math.max(14, header.length + 4) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Import')
  XLSX.writeFile(workbook, fileName)
}

export const normalizeHeader = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Accepts 1250.5, "1 250,50", "1,250.50" or "HTG 450". */
export function parseNumber(value: SheetCell): number | null {
  if (value === null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let text = String(value).replace(/[^\d,.-]/g, '')
  if (!text) return null
  const comma = text.lastIndexOf(','), dot = text.lastIndexOf('.')
  if (comma > -1 && dot > -1) text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '')
  else if (comma > -1) text = /,\d{1,2}$/.test(text) && text.split(',').length === 2 ? text.replace(',', '.') : text.replace(/,/g, '')
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

/** Returns YYYY-MM-DD from a date cell, an ISO string or a dd/mm/yyyy string. */
export function parseDate(value: SheetCell): string | null {
  if (value === null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const text = String(value).trim()
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const local = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (local) {
    const year = local[3].length === 2 ? `20${local[3]}` : local[3]
    const date = new Date(Number(year), Number(local[2]) - 1, Number(local[1]))
    if (date.getMonth() === Number(local[2]) - 1) return `${year}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
  }
  return null
}
