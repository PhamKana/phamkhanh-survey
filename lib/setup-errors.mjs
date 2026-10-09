export class SetupError extends Error {
  constructor(code, message) { super(message); this.name = 'SetupError'; this.code = code; }
}

export function setupDiagnostic(error) {
  if (error instanceof SetupError) return { code: error.code, message: error.message };
  if ([401, 403].includes(error?.cause?.status)) return { code: 'DATABASE_AUTH_FAILED', message: 'Turso từ chối kết nối. Kiểm tra TURSO_AUTH_TOKEN còn hiệu lực và thuộc đúng database; lưu lại rồi Redeploy trên Vercel.' };
  if (String(error?.code).startsWith('SQLITE_READONLY')) return { code: 'DATABASE_READ_ONLY', message: 'Token Turso chưa có quyền ghi. Tạo token đọc/ghi cho database, cập nhật TURSO_AUTH_TOKEN rồi Redeploy.' };
  // Never expose arbitrary SDK messages: they can contain URLs or credentials.
  return { code: 'DATABASE_CONNECTION_FAILED', message: 'Chưa kết nối được Turso. Kiểm tra URL, token và trạng thái database; sau khi sửa Environment Variables cần Redeploy trên Vercel.' };
}
