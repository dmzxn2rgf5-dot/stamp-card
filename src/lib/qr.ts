import qrcode from "qrcode-generator";

/** Render a QR code as a crisp black-on-white SVG (best for scanning). */
export function qrSvg(text: string, opts: { title?: string } = {}): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        // merge horizontal runs into one rect-path to keep the SVG small
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
        c += run - 1;
      }
    }
  }
  const title = opts.title ? `<title>${opts.title.replace(/[<&>]/g, "")}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">${title}<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
