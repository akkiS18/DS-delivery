// Draws <div data-qr="https://..."> as a crisp vector QR (level H, so the small logo in the middle stays readable).
// Needs qrcode-generator (loaded from cdnjs in each page).
function mountQR() {
  document.querySelectorAll('[data-qr]').forEach(el => {
    const qr = qrcode(0, 'H');
    qr.addData(el.dataset.qr);
    qr.make();
    const n = qr.getModuleCount(), q = 2, size = n + q * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) { c++; continue; }
        let s = c; while (c < n && qr.isDark(r, c)) c++;
        d += `M${s + q} ${r + q}h${c - s}v1h-${c - s}z`;
      }
    }
    const bw = size * 0.34, bh = size * 0.17, bx = (size - bw) / 2, by = (size - bh) / 2;
    const logo = el.dataset.logo
      ? `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bh * 0.22}" fill="#fff"/>` +
        `<image href="${el.dataset.logo}" x="${bx + bw * 0.08}" y="${by + bh * 0.1}" width="${bw * 0.84}" height="${bh * 0.8}" preserveAspectRatio="xMidYMid meet"/>`
      : '';
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" style="width:100%;height:100%;display:block">` +
      `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="${el.dataset.color || '#063F2E'}"/>${logo}</svg>`;
  });
}
