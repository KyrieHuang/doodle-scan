// Stage 1 placeholder: show that the hourly data made it to the site.
// The drawing board comes in stage 3.

const status = document.getElementById('status');

try {
  const meta = await fetch('/data/meta.json', { cache: 'no-store' }).then((r) => r.json());
  const t = new Date(meta.updatedAt).toLocaleString('zh-TW', { hour12: false });
  status.textContent = `建置中。資料更新於 ${t}，共 ${meta.count} 個幣。`;
} catch {
  status.textContent = '建置中。資料尚未產生。';
}
