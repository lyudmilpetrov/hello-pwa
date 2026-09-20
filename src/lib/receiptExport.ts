import ExcelJS from 'exceljs'
import type { Column, Worksheet } from 'exceljs'
import type { Receipt } from '../types/receipt'

const moneyFormat = '#,##0.00'
const dateFormat = 'dd.mm.yyyy'
const bishkekDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit',
})

// Excel dates have no time zone. Store the Bishkek calendar date at midnight.
function excelDate(value: string): Date {
  const parts = bishkekDate.formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)!.value)
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')))
}

function formatSheet(sheet: Worksheet, columns: Partial<Column>[]) {
  sheet.columns = columns
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.properties.defaultRowHeight = 42
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}

function finishSheet(sheet: Worksheet) {
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } }
  sheet.eachRow((row, index) => {
    row.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF20202A' } }
      cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true }
      if (index > 1 && index % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F1FA' } }
      }
    })
  })
  const header = sheet.getRow(1)
  header.height = 32
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B21B6' } }
  })
}

export function createReceiptWorkbook(receipts: readonly Receipt[]) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Receipt collector'
  const summary = workbook.addWorksheet('Receipts')
  formatSheet(summary, [
    { header: 'Date (Bishkek)', key: 'date', width: 18, style: { numFmt: dateFormat } },
    { header: 'Чек №', key: 'ticketNumber', width: 18, style: { numFmt: '@' } },
    { header: 'Merchant', key: 'merchant', width: 34 },
    { header: 'Address', key: 'address', width: 44 },
    { header: 'Total amount (сом)', key: 'total', width: 20, style: { numFmt: moneyFormat } },
    { header: 'НДС amount (сом)', key: 'vat', width: 20, style: { numFmt: moneyFormat } },
    ...[
      ['ИНН', 'tin'], ['ККМ №', 'kkm'], ['ФМ №', 'fm'], ['ФПД', 'fpd'], ['ФД №', 'fd'],
    ].map(([header, key]) => ({ header, key, width: 24, style: { numFmt: '@' } })),
    { header: 'Source', key: 'source', width: 20 },
    { header: 'Receipt ID', key: 'id', width: 38, style: { numFmt: '@' } },
  ])
  const items = workbook.addWorksheet('Purchased items')
  formatSheet(items, [
    { header: 'Receipt ID', key: 'id', width: 38, style: { numFmt: '@' } },
    { header: 'Date (Bishkek)', key: 'date', width: 18, style: { numFmt: dateFormat } },
    { header: 'Чек №', key: 'ticketNumber', width: 18, style: { numFmt: '@' } },
    { header: 'Merchant', key: 'merchant', width: 34 },
    { header: 'Item', key: 'item', width: 54 },
    { header: 'Quantity', key: 'quantity', width: 14, style: { numFmt: '0.########' } },
    { header: 'Unit price (сом)', key: 'price', width: 20, style: { numFmt: moneyFormat } },
    { header: 'Amount (сом)', key: 'total', width: 20, style: { numFmt: moneyFormat } },
  ])
  for (const receipt of receipts) {
    const date = excelDate(receipt.dateTime)
    summary.addRow({
      date, ticketNumber: receipt.ticketNumber, merchant: receipt.merchant, address: receipt.merchantAddress,
      total: receipt.totalAmountMinor / 100,
      vat: receipt.vatAmountMinor === null ? null : receipt.vatAmountMinor / 100,
      tin: receipt.tin, kkm: receipt.kkmNumber, fm: receipt.fmNumber,
      fpd: receipt.fpd, fd: receipt.fdNumber, id: receipt.id,
      source: { text: 'View receipt', hyperlink: receipt.sourceUrl },
    })
    for (const item of receipt.items) {
      items.addRow({
        id: receipt.id, date, ticketNumber: receipt.ticketNumber, merchant: receipt.merchant, item: item.name,
        quantity: item.quantity, price: item.unitPriceMinor / 100, total: item.totalAmountMinor / 100,
      })
    }
  }
  finishSheet(summary)
  finishSheet(items)
  return workbook
}

export async function downloadReceipts(receipts: readonly Receipt[]) {
  if (!receipts.length) return
  const workbook = createReceiptWorkbook(receipts)
  const data = await workbook.xlsx.writeBuffer()
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `receipts-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    // Leave time for browsers to start reading the download before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
