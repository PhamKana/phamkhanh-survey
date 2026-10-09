export class SetupError extends Error {
  constructor(code, message) { super(message); this.name = 'SetupError'; this.code = code; }
}

export function setupDiagnostic(error) {
  if (error instanceof SetupError) return { code: error.code, message: error.message };
  if (error?.code === '28P01' || [401, 403].includes(error?.cause?.status)) return { code: 'DATABASE_AUTH_FAILED', message: 'Database từ chối kết nối. Kết nối lại Neon Postgres với project trong Vercel Storage để cập nhật DATABASE_URL, rồi Redeploy.' };
  if (error?.code === '42501' || error?.code === '25006') return { code: 'DATABASE_READ_ONLY', message: 'Kết nối database chưa có quyền ghi. Gắn đúng database với project trong Vercel Storage rồi Redeploy.' };
  // Never expose arbitrary SDK messages: they can contain URLs or credentials.
  return { code: 'DATABASE_CONNECTION_FAILED', message: 'Chưa kết nối được database. Kiểm tra Neon Postgres đã gắn với project và môi trường Production trong Vercel Storage; sau khi sửa cần Redeploy.' };
}
