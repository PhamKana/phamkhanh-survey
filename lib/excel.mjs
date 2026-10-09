import ExcelJS from 'exceljs';

export async function exportWorkbook(survey, columns, records, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Survey Studio';
  const eligible = rows.filter(row => row.outcome === 'eligible').length;
  const summary = workbook.addWorksheet('Tổng quan');
  summary.addRows([
    ['Chỉ số', 'Giá trị'], ['Khảo sát', survey.title],
    ['Tổng câu trả lời', rows.length], ['Đủ điều kiện', eligible],
    ['Ngoài phạm vi', rows.length - eligible],
    ['Tỷ lệ đủ điều kiện', rows.length ? eligible / rows.length : 0],
    ['Thời điểm xuất (UTC)', new Date().toISOString()],
  ]);
  summary.getCell('B6').numFmt = '0.0%';
  summary.columns = [{ width: 28 }, { width: 70 }];
  const answers = workbook.addWorksheet('Câu trả lời');
  answers.addRow(columns);
  answers.addRows(records);
  answers.columns.forEach(column => { column.width = 24; });
  answers.autoFilter = { from: { row: 1, column: 1 }, to: { row: records.length + 1, column: columns.length } };
  for (const sheet of [summary, answers]) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1342B5' } };
    sheet.getRow(1).height = 26;
  }
  return workbook.xlsx.writeBuffer();
}
