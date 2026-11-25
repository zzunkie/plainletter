// Turns what the person chose (photos, scans, a PDF) into page images, in the browser.
// Nothing here uploads anything.

const LONG_SIDE = 1800;
const MAX_PAGES = 6;

function toPage(source, width, height) {
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const c = document.createElement('canvas'); c.width = Math.round(width * scale); c.height = Math.round(height * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { url, base64: url.split(',')[1], width: c.width, height: c.height };
}

async function pdfPages(blob) {
  // Loaded only when a PDF is chosen. pdf.js renders each page to a canvas on this device.
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: LONG_SIDE / Math.max(...page.getViewport({ scale: 1 }).viewBox.slice(2)) });
    const c = document.createElement('canvas'); c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    pages.push(toPage(c, c.width, c.height));
  }
  return pages;
}

export async function filesToPages(files) {
  const pages = [];
  for (const file of files) {
    if (pages.length >= MAX_PAGES) break;
    if (file.type === 'application/pdf') pages.push(...await pdfPages(file));
    else { const bmp = await createImageBitmap(file); pages.push(toPage(bmp, bmp.width, bmp.height)); }
  }
  return pages.slice(0, MAX_PAGES);
}

// The on-device model reads small print better in horizontal strips than as a whole page.
// A taller page gets more strips. Neighbouring strips overlap so no line is cut in both.
export const stripCount = (page) => Math.max(1, Math.min(5, Math.round((page.height / page.width) * 3)));

export async function strips(page, count) {
  if (count <= 1) return [{ base64: page.base64, y0: 0, y1: 1 }];
  const bmp = await createImageBitmap(await (await fetch(page.url)).blob());
  const h = bmp.height / count, pad = h * 0.12;
  return Array.from({ length: count }, (_, i) => {
    const top = Math.max(0, i * h - pad), bottom = Math.min(bmp.height, (i + 1) * h + pad);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = Math.round(bottom - top);
    c.getContext('2d').drawImage(bmp, 0, -top);
    return { base64: c.toDataURL('image/jpeg', 0.9).split(',')[1], y0: top / bmp.height, y1: bottom / bmp.height };
  });
}
