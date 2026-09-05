/** Log gọn một dòng cho mỗi yêu cầu: thời gian, method, path, status, ms. */
export function requestLogger() {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const ts = new Date().toISOString();
      console.log(`${ts} ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  };
}
